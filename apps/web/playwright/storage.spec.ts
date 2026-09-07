/**
 * IPFS/StorageProvider UI + API coverage (CLAUDE.md §7, dev plan §12-§20). Runs
 * against whichever `STORAGE_PROVIDER` the webServer was started with — most
 * assertions hold for either provider; a few assert IPFS-specific shapes (real
 * `bafy...`/`bafk...` CIDs, the gateway link) and skip themselves when the
 * server is running with the local provider.
 */
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";

const DEV_TOKEN = "okf_dev_local_0000000000000000000000000000";
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "../../../tests/fixtures/valid-mindportalix");

function buildTgz(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "okf-storage-e2e-"));
  const out = join(dir, "bundle.tgz");
  execSync(`tar -czf ${out} -C ${FIXTURE} .`);
  return execSync(`cat ${out}`);
}

async function publishAndWait(request: APIRequestContext, slug: string, tgz: Buffer): Promise<string> {
  const pub = await request.post("/api/v1/bundles", {
    headers: {
      authorization: `Bearer ${DEV_TOKEN}`,
      "x-okf-asset-slug": slug,
      "x-okf-filename": "bundle.tgz",
      "content-type": "application/gzip",
    },
    data: tgz,
  });
  expect([201, 202]).toContain(pub.status());
  const { jobId } = await pub.json();

  for (let i = 0; i < 60; i++) {
    const s = await request.get(`/api/v1/mint-jobs/${jobId}`, {
      headers: { authorization: `Bearer ${DEV_TOKEN}` },
    });
    const body = await s.json();
    if (body.state === "MINTED") return body.asset.assetId as string;
    expect(body.state).not.toBe("FAILED");
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("mint job never reached MINTED");
}

test.describe("Storage health", () => {
  test("GET /api/v1/storage/health reports the configured provider without fetching content", async ({ request }) => {
    const res = await request.get("/api/v1/storage/health");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(["local", "ipfs"]).toContain(body.provider);
    expect(body.healthy).toBe(true);
    expect(typeof body.latencyMs).toBe("number");
  });
});

test.describe("Bundle retrieval", () => {
  test("public bundle route returns the exact bytes that were published", async ({ request }) => {
    const slug = `storage-e2e-${Date.now()}`;
    const tgz = buildTgz();
    const assetId = await publishAndWait(request, slug, tgz);

    const res = await request.get(`/api/public/assets/${assetId}/bundle`);
    expect(res.ok()).toBe(true);
    const body = Buffer.from(await res.body());
    expect(body.equals(tgz)).toBe(true);
    expect(res.headers()["content-disposition"]).toContain("attachment");
    expect(res.headers()["x-okf-cid"]).toBeTruthy();
    expect(res.headers()["x-okf-storage-provider"]).toBeTruthy();
  });

  test("authenticated bundle route requires a bearer token", async ({ request }) => {
    const slug = `storage-e2e-auth-${Date.now()}`;
    const assetId = await publishAndWait(request, slug, buildTgz());
    const res = await request.get(`/api/v1/assets/${assetId}/bundle`);
    expect(res.status()).toBe(401);
  });

  test("rejects a non-numeric version and a version that doesn't exist", async ({ request }) => {
    const slug = `storage-e2e-ver-${Date.now()}`;
    const assetId = await publishAndWait(request, slug, buildTgz());

    const badFormat = await request.get(`/api/public/assets/${assetId}/bundle?version=abc`);
    expect(badFormat.status()).toBe(422);

    const missing = await request.get(`/api/public/assets/${assetId}/bundle?version=999`);
    expect(missing.status()).toBe(404);

    const v1 = await request.get(`/api/public/assets/${assetId}/bundle?version=1`);
    expect(v1.ok()).toBe(true);
  });

  test("an unknown asset id returns 404, not an internal error", async ({ request }) => {
    const res = await request.get(`/api/public/assets/does-not-exist/bundle`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

test.describe("Asset page — storage section", () => {
  test("shows provider, all four CIDs, and a working retrieve link", async ({ page, request }) => {
    const slug = `storage-e2e-page-${Date.now()}`;
    const assetId = await publishAndWait(request, slug, buildTgz());

    await page.goto(`/assets/${assetId}`);
    await expect(page.getByRole("heading", { name: "Storage", exact: true })).toBeVisible();
    await expect(page.getByText(/^Provider:/)).toBeVisible();
    await expect(page.getByText("Source CID")).toBeVisible();
    await expect(page.getByText("Canonical CID")).toBeVisible();
    await expect(page.getByText("Graph CID")).toBeVisible();
    await expect(page.getByText("Manifest CID")).toBeVisible();

    const retrieveLink = page.getByRole("link", { name: "Retrieve bundle" });
    await expect(retrieveLink).toBeVisible();
    await expect(retrieveLink).toHaveAttribute("href", `/api/v1/assets/${assetId}/bundle`);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("provider health is reflected consistently between the API and the page", async ({ page, request }) => {
    const health = await (await request.get("/api/v1/storage/health")).json();
    const slug = `storage-e2e-consistency-${Date.now()}`;
    const assetId = await publishAndWait(request, slug, buildTgz());
    await page.goto(`/assets/${assetId}`);
    await expect(page.getByText(`Provider: ${health.provider}`)).toBeVisible();

    if (health.provider === "ipfs") {
      // Real Kubo CIDs are CIDv1 base32 (bafy.../bafk...), never the local "okf1:" form.
      const sourceCid = await page.locator("text=Source CID").locator("..").locator(".hash").innerText();
      expect(sourceCid).toMatch(/^(bafy|bafk)/);
    }
  });
});

test.describe("Verify page — storage section", () => {
  test("shows the authenticity disclaimer and a retrieve link", async ({ page, request }) => {
    const slug = `storage-e2e-verify-${Date.now()}`;
    const assetId = await publishAndWait(request, slug, buildTgz());

    await page.goto(`/verify/${assetId}`);
    await expect(page.getByText("✓ VERIFIED")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Storage", exact: true })).toBeVisible();
    await expect(page.getByText(/IPFS availability does not itself prove authenticity/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Retrieve bundle" })).toHaveAttribute(
      "href",
      `/api/public/assets/${assetId}/bundle`,
    );

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
