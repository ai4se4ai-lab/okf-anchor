/**
 * IPFS-backed storage tests (CLAUDE.md plan §13, §14). Two concerns the local
 * provider can't exercise on its own:
 *   1. The pipeline is unchanged when `StorageProvider` is swapped to a real
 *      Kubo node — publish → verify still passes every check.
 *   2. A storage failure happens *before* signing/anchoring, so it never
 *      produces a blockchain commitment for content that isn't durably stored.
 *
 * Needs Postgres for (1) and (2); (1) additionally needs Kubo
 * (`docker compose --profile ipfs up -d ipfs`). Each returns early when its
 * dependency is unreachable, matching `publish-verify.test.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@okf-anchor/db";
import { createProviders, type Providers } from "@okf-anchor/providers";
import { publishBundle, verifyStoredVersion } from "../src/index.js";

const FIXTURES = fileURLToPath(new URL("../../../tests/fixtures/", import.meta.url));
const RUN = `ipfs-test-${Date.now()}`;
const IPFS_API_URL = process.env["IPFS_API_URL"] ?? "http://localhost:55001";

function fixtureFiles(name: string): Record<string, Uint8Array> {
  const root = join(FIXTURES, name);
  const out: Record<string, Uint8Array> = {};
  const walk = (dir: string): void => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, d.name);
      if (d.isDirectory()) walk(abs);
      else out[relative(root, abs).split(sep).join("/")] = new Uint8Array(readFileSync(abs));
    }
  };
  walk(root);
  return out;
}

const FIXED_MTIME = new Date("2020-01-02T12:00:00Z");
function zipOf(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files, { level: 0, mtime: FIXED_MTIME });
}

let dbUp = false;
let ipfsUp = false;
let localProviders: Providers;
let ipfsProviders: Providers;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    dbUp = false;
    return;
  }
  const org = await prisma.organization.upsert({
    where: { slug: "pipeline-ipfs-test" },
    update: {},
    create: { slug: "pipeline-ipfs-test", name: "Pipeline IPFS Test Org" },
  });
  await prisma.buildServer.upsert({
    where: { publisherId: `build-server:${RUN}` },
    update: {},
    create: { name: RUN, publisherId: `build-server:${RUN}`, organizationId: org.id },
  });
  localProviders = createProviders({
    STORAGE_PROVIDER: "local",
    ANCHOR_PROVIDER: "local",
    GRAPH_PROVIDER: "local",
    SIGNER: "local",
    OKF_DATA_DIR: `.data/okf-pipeline-ipfs-test-${RUN}`,
  });
  ipfsProviders = createProviders({
    STORAGE_PROVIDER: "ipfs",
    IPFS_API_URL,
    ANCHOR_PROVIDER: "local",
    GRAPH_PROVIDER: "local",
    SIGNER: "local",
    OKF_DATA_DIR: `.data/okf-pipeline-ipfs-test-${RUN}`,
  });
  const health = await ipfsProviders.storage.health?.();
  ipfsUp = health?.healthy ?? false;
});

afterAll(async () => {
  if (dbUp) await prisma.$disconnect();
});

describe.runIf(process.env["RUN_DB_TESTS"] !== "0")("publish over IpfsStorageProvider", () => {
  it("publishes to a real Kubo node and verifies end-to-end", async () => {
    if (!dbUp || !ipfsUp) return;
    const server = await prisma.buildServer.findUniqueOrThrow({ where: { publisherId: `build-server:${RUN}` } });
    const result = await publishBundle(
      {
        archive: zipOf(fixtureFiles("ref-acme_retail")),
        buildServerId: server.id,
        publisherId: server.publisherId,
        assetSlug: `acme-ipfs-${RUN}`,
        name: "Acme Retail (IPFS)",
      },
      { prisma, providers: ipfsProviders },
    );

    expect(result.deduplicated).toBe(false);
    // Real Kubo CIDs (CIDv1, base32) — never the local "okf1:<sha256>" form.
    expect(result.storageCids.source).toMatch(/^(bafy|bafk)/);
    expect(result.storageCids.canonical).toMatch(/^(bafy|bafk)/);
    expect(result.storageCids.graph).toMatch(/^(bafy|bafk)/);
    expect(result.storageCids.manifest).toMatch(/^(bafy|bafk)/);

    const stored = await prisma.storageObject.findMany({ where: { assetVersionId: result.assetVersionId } });
    expect(stored.length).toBe(4);
    for (const s of stored) expect(s.provider).toBe("ipfs");

    const report = await verifyStoredVersion({ assetVersionId: result.assetVersionId }, { prisma, providers: ipfsProviders });
    expect(report.passed).toBe(true);
    expect(report.storageIntegrity).toBe(true);
    expect(report.contentIntegrity).toBe(true);
  });
});

describe.runIf(process.env["RUN_DB_TESTS"] !== "0")("storage failure blocks anchoring", () => {
  it("never signs or anchors when the storage layer fails (CLAUDE.md plan §13, §14)", async () => {
    if (!dbUp) return;
    const server = await prisma.buildServer.findUniqueOrThrow({ where: { publisherId: `build-server:${RUN}` } });

    let anchorCalls = 0;
    const brokenProviders: Providers = {
      ...localProviders,
      storage: {
        kind: "broken",
        put: async () => {
          throw new Error("simulated Kubo outage");
        },
        get: localProviders.storage.get.bind(localProviders.storage),
        has: localProviders.storage.has.bind(localProviders.storage),
        pin: localProviders.storage.pin.bind(localProviders.storage),
      },
      anchor: {
        ...localProviders.anchor,
        anchor: async (commitment) => {
          anchorCalls++;
          return localProviders.anchor.anchor(commitment);
        },
      },
    };

    const slug = `acme-storage-failed-${RUN}`;
    await expect(
      publishBundle(
        {
          archive: zipOf(fixtureFiles("ref-acme_retail")),
          buildServerId: server.id,
          publisherId: server.publisherId,
          assetSlug: slug,
          name: "Acme (storage failure)",
        },
        { prisma, providers: brokenProviders },
      ),
    ).rejects.toThrow(/simulated Kubo outage/);

    expect(anchorCalls).toBe(0);
    const asset = await prisma.asset.findUnique({ where: { publisherId_slug: { publisherId: server.publisherId, slug } } });
    // The logical Asset row may exist (upserted before storage runs), but it
    // must have no published version and no anchor.
    if (asset) {
      const versions = await prisma.assetVersion.findMany({ where: { assetId: asset.id } });
      expect(versions).toEqual([]);
      expect(asset.currentVersionId).toBeNull();
    }
  });
});
