/**
 * End-to-end pipeline test against a real Postgres (from docker compose) and the
 * local providers. Covers: publish → idempotent re-publish → full verification →
 * tamper detection → new immutable version.
 *
 * Skips itself when DATABASE_URL is not reachable so `pnpm test` still runs
 * without the compose stack.
 */
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@okf-anchor/db";
import { createProviders, type Providers } from "@okf-anchor/providers";
import { publishBundle, verifyAgainstUpload, verifyStoredVersion } from "../src/index.js";

const FIXTURES = fileURLToPath(new URL("../../../tests/fixtures/", import.meta.url));
const RUN = `test-${Date.now()}`;

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

let providers: Providers;
let dbUp = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    dbUp = false;
    return;
  }
  const org = await prisma.organization.upsert({
    where: { slug: "pipeline-test" },
    update: {},
    create: { slug: "pipeline-test", name: "Pipeline Test Org" },
  });
  await prisma.buildServer.upsert({
    where: { publisherId: `build-server:${RUN}` },
    update: {},
    create: { name: RUN, publisherId: `build-server:${RUN}`, organizationId: org.id },
  });
  providers = createProviders({
    STORAGE_PROVIDER: "local",
    ANCHOR_PROVIDER: "local",
    GRAPH_PROVIDER: "local",
    SIGNER: "local",
    OKF_DATA_DIR: mkdtempSync(join(tmpdir(), "okf-pipeline-")),
  });
});

afterAll(async () => {
  if (dbUp) await prisma.$disconnect();
});

describe.runIf(process.env["RUN_DB_TESTS"] !== "0")("publish → verify → tamper", () => {
  it("publishes a bundle and produces every commitment", async () => {
    if (!dbUp) return;
    const server = await prisma.buildServer.findUniqueOrThrow({
      where: { publisherId: `build-server:${RUN}` },
    });
    const zip = zipOf(fixtureFiles("ref-acme_retail"));

    const result = await publishBundle(
      {
        archive: zip,
        originalFilename: "acme.zip",
        buildServerId: server.id,
        publisherId: server.publisherId,
        assetSlug: `acme-${RUN}`,
        name: "Acme Retail",
      },
      { prisma, providers, publicBaseUrl: "http://localhost:3000" },
    );

    expect(result.deduplicated).toBe(false);
    expect(result.canonicalHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(result.graphHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.anchor.state).toBe("CONFIRMED");
    expect(result.signature?.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(result.verificationUrl).toContain(`/verify/${result.assetId}`);
  });

  it("is idempotent: re-publishing identical bytes returns the same version, no new anchor", async () => {
    if (!dbUp) return;
    const server = await prisma.buildServer.findUniqueOrThrow({
      where: { publisherId: `build-server:${RUN}` },
    });
    const zip = zipOf(fixtureFiles("ref-acme_retail"));
    const a = await publishBundle(
      { archive: zip, buildServerId: server.id, publisherId: server.publisherId, assetSlug: `acme-${RUN}`, name: "Acme Retail" },
      { prisma, providers },
    );
    const b = await publishBundle(
      { archive: zip, buildServerId: server.id, publisherId: server.publisherId, assetSlug: `acme-${RUN}`, name: "Acme Retail" },
      { prisma, providers },
    );
    expect(b.deduplicated).toBe(true);
    expect(b.assetVersionId).toBe(a.assetVersionId);
    expect(b.versionNumber).toBe(1);
  });

  it("verifies the stored version — all six checks pass", async () => {
    if (!dbUp) return;
    const server = await prisma.buildServer.findUniqueOrThrow({
      where: { publisherId: `build-server:${RUN}` },
    });
    const a = await publishBundle(
      { archive: zipOf(fixtureFiles("ref-acme_retail")), buildServerId: server.id, publisherId: server.publisherId, assetSlug: `acme-${RUN}`, name: "Acme Retail" },
      { prisma, providers },
    );
    const report = await verifyStoredVersion({ assetVersionId: a.assetVersionId }, { prisma, providers });
    expect(report.passed).toBe(true);
    expect(report.contentIntegrity).toBe(true);
    expect(report.manifestIntegrity).toBe(true);
    expect(report.graphIntegrity).toBe(true);
    expect(report.signatureIntegrity).toBe(true);
    expect(report.anchorIntegrity).toBe(true);
    expect(report.storageIntegrity).toBe(true);
    expect(report.changedFiles).toEqual([]);
  });

  it("detects a tampered upload and names the changed file", async () => {
    if (!dbUp) return;
    const server = await prisma.buildServer.findUniqueOrThrow({
      where: { publisherId: `build-server:${RUN}` },
    });
    const a = await publishBundle(
      { archive: zipOf(fixtureFiles("ref-acme_retail")), buildServerId: server.id, publisherId: server.publisherId, assetSlug: `acme-${RUN}`, name: "Acme Retail" },
      { prisma, providers },
    );

    const files = fixtureFiles("ref-acme_retail");
    files["metrics/revenue.md"] = strToU8(
      new TextDecoder().decode(files["metrics/revenue.md"]) + "\n<!-- tampered -->\n",
    );
    const report = await verifyAgainstUpload(a.assetId, zipOf(files), "tampered.zip", { prisma, providers });

    expect(report.passed).toBe(false);
    expect(report.contentIntegrity).toBe(false);
    expect(report.anchorIntegrity).toBe(false);
    expect(report.changedFiles).toContain("metrics/revenue.md");
    expect(report.actual.merkleRoot).not.toBe(report.expected.merkleRoot);
  });

  it("publishing changed content creates v2 while v1 stays immutable", async () => {
    if (!dbUp) return;
    const server = await prisma.buildServer.findUniqueOrThrow({
      where: { publisherId: `build-server:${RUN}` },
    });
    const slug = `acme-v2-${RUN}`;
    const v1 = await publishBundle(
      { archive: zipOf(fixtureFiles("ref-acme_retail")), buildServerId: server.id, publisherId: server.publisherId, assetSlug: slug, name: "Acme" },
      { prisma, providers },
    );
    const files = fixtureFiles("ref-acme_retail");
    files["policies/margin-standard.md"] = strToU8(
      new TextDecoder().decode(files["policies/margin-standard.md"]) + "\nrevised\n",
    );
    const v2 = await publishBundle(
      { archive: zipOf(files), buildServerId: server.id, publisherId: server.publisherId, assetSlug: slug, name: "Acme" },
      { prisma, providers },
    );

    expect(v2.deduplicated).toBe(false);
    expect(v2.versionNumber).toBe(2);
    expect(v2.canonicalHash).not.toBe(v1.canonicalHash);

    const versions = await prisma.assetVersion.findMany({
      where: { assetId: v1.assetId },
      orderBy: { versionNumber: "asc" },
    });
    expect(versions.map((x) => x.versionNumber)).toEqual([1, 2]);
    expect(versions[0]!.canonicalHash).toBe(v1.canonicalHash);
  });
});
