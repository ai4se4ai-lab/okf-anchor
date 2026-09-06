import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const DEV_TOKEN = "okf_dev_local_0000000000000000000000000000";
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "../../../tests/fixtures/valid-mindportalix");

function buildTgz(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "okf-e2e-"));
  const out = join(dir, "bundle.tgz");
  execSync(`tar -czf ${out} -C ${FIXTURE} .`);
  return execSync(`cat ${out}`);
}

test.describe("OKF Anchor end-to-end", () => {
  test("dashboard renders and is accessible", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("theme toggle switches light/dark/system and persists across pages", async ({ page }) => {
    await page.goto("/dashboard");
    const group = page.getByRole("radiogroup", { name: "Colour theme" });
    await expect(group).toBeVisible();

    const html = page.locator("html");
    const dark = page.getByRole("radio", { name: "Dark theme" });
    const light = page.getByRole("radio", { name: "Light theme" });

    await dark.click();
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
    await expect(dark).toHaveAttribute("aria-checked", "true");

    await light.click();
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
    await expect(light).toHaveAttribute("aria-checked", "true");

    // Choice survives a navigation (localStorage + pre-paint script).
    await dark.click();
    await page.goto("/query");
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
    await expect(page.getByRole("radio", { name: "Dark theme" })).toHaveAttribute("aria-checked", "true");

    // "System" follows the emulated OS preference.
    await page.emulateMedia({ colorScheme: "light" });
    await page.getByRole("radio", { name: "System theme" }).click();
    await expect(page.locator("html")).not.toHaveClass(/(^|\s)dark(\s|$)/);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
    await page.emulateMedia({ colorScheme: null });

    await page.getByRole("radio", { name: "Light theme" }).click();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("query page rejects a write query and runs a read query", async ({ page }) => {
    await page.goto("/query");
    await page.getByRole("button", { name: "Run query" }).click();
    await expect(page.getByText(/rows/)).toBeVisible({ timeout: 15_000 });
  });

  test("publish → verify PASS → tamper FAIL", async ({ request }) => {
    const slug = `e2e-${Date.now()}`;
    const tgz = buildTgz();

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

    // Inline mint returns MINTED immediately; otherwise poll.
    let asset: { assetId: string } | null = null;
    for (let i = 0; i < 60; i++) {
      const s = await request.get(`/api/v1/mint-jobs/${jobId}`, {
        headers: { authorization: `Bearer ${DEV_TOKEN}` },
      });
      const body = await s.json();
      if (body.state === "MINTED") {
        asset = body.asset;
        break;
      }
      expect(body.state).not.toBe("FAILED");
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(asset?.assetId).toBeTruthy();

    const good = await request.get(`/api/public/assets/${asset.assetId}/verify`);
    const goodReport = await good.json();
    expect(goodReport.passed).toBe(true);

    // Tamper one file and verify the upload against the anchored asset.
    const dir = mkdtempSync(join(tmpdir(), "okf-tamper-"));
    execSync(`cp -r ${FIXTURE}/. ${dir}`);
    writeFileSync(join(dir, "icse/seet-2027/topics.md"), "\n<!-- tampered -->\n", { flag: "a" });
    const tampered = execSync(`bash -c "tar -czf - -C ${dir} ."`);

    const bad = await request.post("/api/v1/assets/verify", {
      headers: { authorization: `Bearer ${DEV_TOKEN}` },
      multipart: {
        assetId: asset.assetId,
        bundle: { name: "tampered.tgz", mimeType: "application/gzip", buffer: tampered },
      },
    });
    const badReport = await bad.json();
    expect(badReport.passed).toBe(false);
    expect(badReport.contentIntegrity).toBe(false);
    expect(badReport.changedFiles).toContain("icse/seet-2027/topics.md");
  });

  test("live chain page renders and is accessible", async ({ page }) => {
    await page.goto("/chain");
    await expect(page.getByRole("heading", { name: "Live chain" })).toBeVisible();
    // Either a live EVM feed (ANCHOR_PROVIDER=evm) or the graceful "not configured"
    // message (default ANCHOR_PROVIDER=local) — both are valid, never a crash.
    await expect(page.getByText(/Live$/).or(page.getByText(/No live EVM chain configured/))).toBeVisible({
      timeout: 15_000,
    });
    // The live activity console renders regardless of the chain provider.
    await expect(page.getByRole("heading", { name: "Live activity" })).toBeVisible();

    // When an EVM chain is configured, blocks render as clickable cards that
    // open a detail region. (Skipped on the default local provider — no blocks.)
    const firstBlock = page.getByRole("button", { name: /^Block \d/ }).first();
    if (await firstBlock.count()) {
      await firstBlock.click();
      const detail = page.getByRole("region", { name: /Block \d+ detail/ });
      await expect(detail).toBeVisible();

      // A block that carries an anchor shows the IPFS content in full: the
      // complete (untruncated) bundle CID and a download link to verify it.
      const cid = detail.getByTestId("ipfs-cid").first();
      if (await cid.count()) {
        await expect(cid).toBeVisible();
        const cidText = (await cid.textContent())?.trim() ?? "";
        expect(cidText).not.toContain("…");
        expect(cidText.length).toBeGreaterThan(20);
        await expect(
          detail.getByRole("link", { name: /Download bundle from IPFS/ }).first().or(
            detail.getByText(/No public IPFS gateway configured|local dev storage/).first(),
          ),
        ).toBeVisible();
      }
    }

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("activity console streams a mint run with IPFS + anchor detail", async ({ page, request }) => {
    const slug = `e2e-activity-${Date.now()}`;
    await page.goto("/chain");
    await expect(page.getByRole("heading", { name: "Live activity" })).toBeVisible();

    // Kick off a mint while the console is open.
    const pub = await request.post("/api/v1/bundles", {
      headers: {
        authorization: `Bearer ${DEV_TOKEN}`,
        "x-okf-asset-slug": slug,
        "x-okf-filename": "bundle.tgz",
        "content-type": "application/gzip",
      },
      data: buildTgz(),
    });
    expect([201, 202]).toContain(pub.status());
    const { jobId } = await pub.json();

    // A "mint" run row shows up and eventually reaches a terminal phase.
    const runRow = page.getByRole("button", { name: /mint/i }).first();
    await expect(runRow).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/persist|done|MINTED/i).first()).toBeVisible({ timeout: 30_000 });

    // Expand it and confirm the detailed pipeline log is there.
    await runRow.click();
    await expect(page.getByText(/storage/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/cid:/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/anchor/).first()).toBeVisible();

    // Poll the job to completion so the test doesn't leave a half-run behind.
    for (let i = 0; i < 60; i++) {
      const body = await (
        await request.get(`/api/v1/mint-jobs/${jobId}`, { headers: { authorization: `Bearer ${DEV_TOKEN}` } })
      ).json();
      if (body.state === "MINTED" || body.state === "FAILED" || body.state === "INVALID") break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("public verification page shows VERIFIED for a freshly minted asset", async ({ page, request }) => {
    const slug = `e2e-page-${Date.now()}`;
    const pub = await request.post("/api/v1/bundles", {
      headers: {
        authorization: `Bearer ${DEV_TOKEN}`,
        "x-okf-asset-slug": slug,
        "x-okf-filename": "bundle.tgz",
        "content-type": "application/gzip",
      },
      data: buildTgz(),
    });
    const { jobId } = await pub.json();
    let assetId = "";
    for (let i = 0; i < 60; i++) {
      const body = await (
        await request.get(`/api/v1/mint-jobs/${jobId}`, { headers: { authorization: `Bearer ${DEV_TOKEN}` } })
      ).json();
      if (body.state === "MINTED") {
        assetId = body.asset.assetId;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    await page.goto(`/verify/${assetId}`);
    await expect(page.getByText("✓ VERIFIED")).toBeVisible();
    await expect(page.getByText("Blockchain anchor")).toBeVisible();
  });
});
