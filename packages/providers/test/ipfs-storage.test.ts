/**
 * Integration tests against a real Kubo node (`docker compose --profile ipfs up
 * -d ipfs`, API on `IPFS_API_URL` / default `http://localhost:55001`). Each test
 * returns early when unreachable so `pnpm test` still runs without the compose
 * stack (same convention as `packages/pipeline/test/publish-verify.test.ts`).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createProviders, InvalidCidError, type Providers } from "../src/index.js";

const IPFS_API_URL = process.env["IPFS_API_URL"] ?? "http://localhost:55001";

const enc = new TextEncoder();
const dec = new TextDecoder();

let providers: Providers;
let ipfsUp = false;

beforeAll(async () => {
  providers = createProviders({ STORAGE_PROVIDER: "ipfs", IPFS_API_URL });
  const health = await providers.storage.health?.();
  ipfsUp = health?.healthy ?? false;
  if (!ipfsUp) {
    console.warn(`skipping IpfsStorageProvider tests: Kubo not reachable at ${IPFS_API_URL}`);
  }
});

describe("IpfsStorageProvider (real Kubo)", () => {
  it("put is content-addressed and idempotent (same bytes -> same CID)", async () => {
    if (!ipfsUp) return;
    const content = enc.encode("okf canonical bundle bytes " + Math.random());
    const a = await providers.storage.put(content);
    const b = await providers.storage.put(content);
    expect(a).toBe(b);
    expect(a).toMatch(/^bafy|^bafk/);
  });

  it("different bytes produce a different CID", async () => {
    if (!ipfsUp) return;
    const a = await providers.storage.put(enc.encode("one"));
    const b = await providers.storage.put(enc.encode("two"));
    expect(a).not.toBe(b);
  });

  it("round-trips arbitrary bytes byte-for-byte, including multi-block content", async () => {
    if (!ipfsUp) return;
    const big = new Uint8Array(600_000).map((_, i) => i % 256);
    const cid = await providers.storage.put(big);
    const got = await providers.storage.get(cid);
    expect(Buffer.from(got).equals(Buffer.from(big))).toBe(true);
  });

  it("has() reports presence before and after pin, pin() is idempotent", async () => {
    if (!ipfsUp) return;
    const cid = await providers.storage.put(enc.encode("pin me " + Math.random()));
    expect(await providers.storage.has(cid)).toBe(true);
    await providers.storage.pin(cid);
    await providers.storage.pin(cid); // must not throw on a second pin
    expect(await providers.storage.has(cid)).toBe(true);
  });

  it("rejects a malformed CID instead of forwarding it to Kubo", async () => {
    if (!ipfsUp) return;
    await expect(providers.storage.get("not-a-cid")).rejects.toThrow(InvalidCidError);
    await expect(providers.storage.has("not-a-cid")).resolves.toBe(false);
  });

  it("rejects content over IPFS_MAX_BUNDLE_SIZE_MB before uploading", async () => {
    if (!ipfsUp) return;
    const small = createProviders({
      STORAGE_PROVIDER: "ipfs",
      IPFS_API_URL,
      IPFS_MAX_BUNDLE_SIZE_MB: "1",
    });
    await expect(small.storage.put(new Uint8Array(2_000_000))).rejects.toThrow(/exceeding/);
  });

  it("IPFS_PIN_ON_PUBLISH=false makes pin() a no-op", async () => {
    if (!ipfsUp) return;
    const unpinned = createProviders({
      STORAGE_PROVIDER: "ipfs",
      IPFS_API_URL,
      IPFS_PIN_ON_PUBLISH: "false",
    });
    const cid = await unpinned.storage.put(enc.encode("never pinned " + Math.random()));
    await expect(unpinned.storage.pin(cid)).resolves.toBeUndefined();
  });

  it("health() reports reachability quickly without a content fetch", async () => {
    if (!ipfsUp) return;
    const health = await providers.storage.health?.();
    expect(health?.healthy).toBe(true);
    expect(health?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("verify text decodes back to the original string", async () => {
    if (!ipfsUp) return;
    const text = "roundtrip check";
    const cid = await providers.storage.put(enc.encode(text));
    expect(dec.decode(await providers.storage.get(cid))).toBe(text);
  });
});

describe("IpfsStorageProvider (unreachable endpoint)", () => {
  it("reports unhealthy rather than throwing when nothing is listening", async () => {
    const down = createProviders({
      STORAGE_PROVIDER: "ipfs",
      IPFS_API_URL: "http://127.0.0.1:1", // nothing listens here
      IPFS_CONNECT_TIMEOUT_MS: "500",
    });
    const health = await down.storage.health?.();
    expect(health?.healthy).toBe(false);
  });
});
