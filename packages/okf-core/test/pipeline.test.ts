import { describe, expect, it } from "vitest";
import {
  processBundle,
  commitmentHash,
  loadBundle,
  validateBundle,
  OkfError,
} from "../src/index.js";
import { loadFixture } from "./helpers.js";

const VALID_FIXTURES = [
  "valid-mindportalix",
  "ref-acme_retail",
  "ref-stackoverflow",
  "ref-crypto_bitcoin",
  "ref-ga4",
  "unknown-fields",
  "broken-links",
  "missing-source-file",
];

describe("processBundle on every valid fixture", () => {
  it.each(VALID_FIXTURES)("%s: conformant, all hashes present and deterministic", async (name) => {
    const a = await processBundle(loadFixture(name));
    expect(a.validation.conformant).toBe(true);
    expect(a.canonical.canonicalHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.canonical.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(a.graph.graphHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.manifest.manifestHash).toMatch(/^[0-9a-f]{64}$/);

    const b = await processBundle(loadFixture(name));
    expect(b.canonical.canonicalHash).toBe(a.canonical.canonicalHash);
    expect(b.canonical.merkleRoot).toBe(a.canonical.merkleRoot);
    expect(b.graph.graphHash).toBe(a.graph.graphHash);
    expect(b.manifest.manifestHash).toBe(a.manifest.manifestHash);
  });
});

describe("processBundle rejects non-conformant bundles", () => {
  it("invalid-no-type", async () => {
    await expect(processBundle(loadFixture("invalid-no-type"))).rejects.toBeInstanceOf(OkfError);
  });
  it("invalid-yaml", async () => {
    await expect(processBundle(loadFixture("invalid-yaml"))).rejects.toBeInstanceOf(OkfError);
  });
  it("still canonicalizes when requireConformant=false", async () => {
    const r = await processBundle(loadFixture("invalid-no-type"), { requireConformant: false });
    expect(r.validation.conformant).toBe(false);
    expect(r.canonical.canonicalHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("permissive validation (OKF §11)", () => {
  it("tolerates broken links and missing index.md, reporting them as info", () => {
    const v = validateBundle(loadBundle(loadFixture("broken-links")));
    expect(v.conformant).toBe(true);
    expect(v.stats.brokenLinkCount).toBeGreaterThan(0);
    expect(v.info.some((f) => f.code === "OKF-INFO-002")).toBe(true);
  });
  it("tolerates unknown frontmatter keys", () => {
    const v = validateBundle(loadBundle(loadFixture("unknown-fields")));
    expect(v.conformant).toBe(true);
  });
});

describe("commitmentHash", () => {
  it("binds every pipeline hash and is deterministic", async () => {
    const p = await processBundle(loadFixture("ref-acme_retail"));
    const base = {
      assetId: "asset_1",
      versionNumber: 1,
      okfVersion: "0.2",
      canonicalHash: p.canonical.canonicalHash,
      merkleRoot: p.canonical.merkleRoot,
      graphHash: p.graph.graphHash,
      manifestHash: p.manifest.manifestHash,
      storageCid: "bafyfake",
      publisher: "build-server:demo",
    };
    expect(commitmentHash(base)).toBe(commitmentHash({ ...base }));
    expect(commitmentHash({ ...base, versionNumber: 2 })).not.toBe(commitmentHash(base));
  });
});
