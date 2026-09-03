import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  LocalStorageProvider,
  LocalAnchorProvider,
  LocalGraphProvider,
  EnvSigner,
  verifySignature,
  guardSparql,
  checkUrlSyntax,
  localCidFor,
  type Commitment,
} from "../src/index.js";

const tmp = mkdtempSync(join(tmpdir(), "okf-providers-"));
afterAll(() => {
  /* leave tmp for inspection; OS cleans it */
});

const enc = (s: string) => new TextEncoder().encode(s);

describe("LocalStorageProvider", () => {
  it("round-trips and re-verifies content by hash", async () => {
    const store = new LocalStorageProvider(join(tmp, "storage"));
    const content = enc("canonical bundle bytes");
    const cid = await store.put(content);
    expect(cid).toBe(localCidFor(content));
    expect(await store.has(cid)).toBe(true);
    expect(new TextDecoder().decode(await store.get(cid))).toBe("canonical bundle bytes");
  });

  it("put is idempotent", async () => {
    const store = new LocalStorageProvider(join(tmp, "storage"));
    const a = await store.put(enc("x"));
    const b = await store.put(enc("x"));
    expect(a).toBe(b);
  });
});

const COMMITMENT: Commitment = {
  assetId: "asset_1",
  versionNumber: 1,
  okfVersion: "0.2",
  canonicalHash: "a".repeat(64),
  merkleRoot: "b".repeat(64),
  graphHash: "c".repeat(64),
  manifestHash: "d".repeat(64),
  storageCid: "okf1:" + "e".repeat(64),
  publisher: "build-server:demo",
};

describe("LocalAnchorProvider", () => {
  it("anchors, verifies matching content, and rejects tampered content", async () => {
    const anchor = new LocalAnchorProvider(join(tmp, "anchor", "ledger.json"));
    const ref = await anchor.anchor(COMMITMENT);
    expect((await anchor.status(ref)).state).toBe("confirmed");

    const good = await anchor.verify(ref, COMMITMENT);
    expect(good.ok).toBe(true);

    const bad = await anchor.verify(ref, { ...COMMITMENT, canonicalHash: "f".repeat(64) });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/does not match/);
  });

  it("re-anchoring identical content returns the same ref (idempotent, no new tx)", async () => {
    const anchor = new LocalAnchorProvider(join(tmp, "anchor", "ledger.json"));
    const a = await anchor.anchor(COMMITMENT);
    const b = await anchor.anchor(COMMITMENT);
    expect(b.ref).toBe(a.ref);
  });
});

describe("LocalGraphProvider + SPARQL guard", () => {
  const NQUADS = [
    '<urn:okf:concept:a> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2004/02/skos/core#Concept> <urn:okf:av:v1> .',
    '<urn:okf:concept:a> <https://okf.dev/ns#title> "Alpha" <urn:okf:av:v1> .',
    '<urn:okf:concept:a> <https://okf.dev/ns#trustTier> "unverified" <urn:okf:av:v1> .',
  ].join("\n");

  it("answers a SELECT over the upserted graph", async () => {
    const graph = new LocalGraphProvider();
    await graph.upsert("v1", NQUADS);
    const res = await graph.query(
      `PREFIX okf: <https://okf.dev/ns#> SELECT ?t WHERE { ?c okf:title ?t }`,
    );
    expect(res.type).toBe("bindings");
    if (res.type === "bindings") {
      expect(res.bindings[0]?.["t"]?.value).toBe("Alpha");
    }
  });

  it("answers ASK", async () => {
    const graph = new LocalGraphProvider();
    await graph.upsert("v1", NQUADS);
    const res = await graph.query(`ASK { ?s ?p ?o }`);
    expect(res).toEqual({ type: "boolean", boolean: true });
  });

  it("rejects UPDATE / INSERT / SERVICE", async () => {
    const graph = new LocalGraphProvider();
    await expect(graph.query(`INSERT DATA { <a:b> <a:c> <a:d> }`)).rejects.toThrow(/not permitted/i);
    expect(guardSparql("DELETE WHERE { ?s ?p ?o }", { maxResults: 10 }).ok).toBe(false);
    expect(
      guardSparql("SELECT * WHERE { SERVICE <http://evil/> { ?s ?p ?o } }", { maxResults: 10 }).ok,
    ).toBe(false);
    expect(guardSparql("SELECT * WHERE { ?s ?p ?o }", { maxResults: 10 }).ok).toBe(true);
  });

  it("scopes a query to one asset version", async () => {
    const graph = new LocalGraphProvider();
    await graph.upsert("v1", NQUADS);
    await graph.upsert("v2", NQUADS.replace(/v1/g, "v2").replace("Alpha", "Beta"));
    const res = await graph.query(`PREFIX okf: <https://okf.dev/ns#> SELECT ?t WHERE { ?c okf:title ?t }`, {
      assetVersionId: "v2",
    });
    if (res.type === "bindings") {
      expect(res.bindings.map((b) => b["t"]?.value)).toEqual(["Beta"]);
    }
  });
});

describe("EnvSigner", () => {
  it("signs bytes and the signature verifies against the raw public key", async () => {
    const signer = EnvSigner.ephemeral();
    const { publicKeyHex } = await signer.publicKey();
    const msg = enc("commitment-hash");
    const sig = await signer.sign(msg);
    expect(sig.publicKeyHex).toBe(publicKeyHex);
    expect(verifySignature(msg, sig.signatureHex, publicKeyHex)).toBe(true);
    expect(verifySignature(enc("tampered"), sig.signatureHex, publicKeyHex)).toBe(false);
  });
});

describe("SSRF guard", () => {
  it("blocks localhost, private IPs and non-https schemes by default", () => {
    expect(checkUrlSyntax("http://example.com").ok).toBe(false);
    expect(checkUrlSyntax("https://localhost/x").ok).toBe(false);
    expect(checkUrlSyntax("https://127.0.0.1/x").ok).toBe(false);
    expect(checkUrlSyntax("https://169.254.169.254/latest/meta-data").ok).toBe(false);
    expect(checkUrlSyntax("https://10.0.0.5/x").ok).toBe(false);
    expect(checkUrlSyntax("https://example.com/export").ok).toBe(true);
  });
  it("can restrict to an explicit host allow-list", () => {
    const policy = {
      allowedSchemes: new Set(["https:"]),
      allowedHosts: new Set(["mp.internal.example"]),
      allowPrivate: false,
    };
    expect(checkUrlSyntax("https://other.example/x", policy).ok).toBe(false);
    expect(checkUrlSyntax("https://mp.internal.example/x", policy).ok).toBe(true);
  });
});
