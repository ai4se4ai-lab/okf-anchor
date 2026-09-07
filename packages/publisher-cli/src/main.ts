#!/usr/bin/env node
/**
 * `okf` — the OKF Anchor publisher CLI. Lets a build server (or a MindPortalix
 * operator) validate, hash, publish, check, verify and query bundles without the
 * web UI. Configuration lives in `~/.okf/config.json` or env
 * (`OKF_ANCHOR_URL`, `OKF_ANCHOR_TOKEN`).
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { gunzipSync, unzipSync, zipSync } from "fflate";
import { processBundle } from "@okf-anchor/okf-core";

interface Config {
  url: string;
  token?: string | undefined;
}

const CONFIG_PATH = join(homedir(), ".okf", "config.json");

function loadConfig(): Config {
  let file: Partial<Config> = {};
  try {
    file = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<Config>;
  } catch {
    /* no config yet */
  }
  return {
    url: process.env["OKF_ANCHOR_URL"] ?? file.url ?? "http://localhost:3000",
    token: process.env["OKF_ANCHOR_TOKEN"] ?? file.token,
  };
}

function saveConfig(cfg: Config): void {
  mkdirSync(join(homedir(), ".okf"), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function die(msg: string): never {
  process.stderr.write(`okf: ${msg}\n`);
  process.exit(1);
}

/** Turn a path (directory, .zip, or .tgz) into archive bytes + a media type. */
function toArchive(path: string): { bytes: Uint8Array; contentType: string; filename: string } {
  const st = statSync(path);
  if (st.isDirectory()) {
    const files: Record<string, Uint8Array> = {};
    const walk = (dir: string): void => {
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, d.name);
        if (d.isDirectory()) walk(abs);
        else files[relative(path, abs).split(sep).join("/")] = new Uint8Array(readFileSync(abs));
      }
    };
    walk(path);
    return {
      bytes: zipSync(files, { level: 6, mtime: new Date("2020-01-01T00:00:00Z") }),
      contentType: "application/zip",
      filename: `${path.replace(/[/\\]+$/, "").split(sep).pop()}.zip`,
    };
  }
  const bytes = new Uint8Array(readFileSync(path));
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  return {
    bytes,
    contentType: isGzip ? "application/gzip" : "application/zip",
    filename: path.split(sep).pop() ?? "bundle",
  };
}

function archiveToEntries(bytes: Uint8Array, contentType: string): Array<{ path: string; content: Uint8Array }> {
  const map =
    contentType === "application/gzip"
      ? tarEntries(gunzipSync(bytes))
      : Object.entries(unzipSync(bytes)).map(([path, content]) => ({ path, content }));
  return map.filter((e) => !e.path.endsWith("/"));
}

/** Minimal ustar reader — enough for `okf validate/hash` on a local .tgz. */
function tarEntries(buf: Uint8Array): Array<{ path: string; content: Uint8Array }> {
  const out: Array<{ path: string; content: Uint8Array }> = [];
  const dec = new TextDecoder();
  for (let off = 0; off + 512 <= buf.length; ) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const name = dec.decode(header.subarray(0, 100)).replace(/\0.*$/, "");
    const size = parseInt(dec.decode(header.subarray(124, 136)).replace(/\0.*$/, "").trim() || "0", 8);
    const type = String.fromCharCode(header[156] ?? 0);
    off += 512;
    if ((type === "0" || type === "\0") && name && !name.endsWith("/")) {
      out.push({ path: name, content: buf.subarray(off, off + size) });
    }
    off += Math.ceil(size / 512) * 512;
  }
  return out;
}

async function api(
  cfg: Config,
  path: string,
  init: RequestInit & { raw?: Uint8Array; archive?: { bytes: Uint8Array; contentType: string; filename: string } } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cfg.token) headers.set("authorization", `Bearer ${cfg.token}`);
  let body = init.body ?? null;
  if (init.archive) {
    headers.set("content-type", init.archive.contentType);
    headers.set("x-okf-filename", init.archive.filename);
    body = Buffer.from(init.archive.bytes);
  }
  return fetch(new URL(path, cfg.url), { ...init, headers, body });
}

async function fetchMindPortalixExport(base: string, filter: string): Promise<{ bytes: Uint8Array; contentType: string; filename: string }> {
  const u = new URL("/api/okf/export", base);
  u.searchParams.set("filter", filter);
  u.searchParams.set("format", "tgz");
  if (!/^https?:$/.test(u.protocol)) die("MindPortalix URL must be http(s)");
  const res = await fetch(u);
  if (!res.ok) die(`MindPortalix export failed: ${res.status}`);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: "application/gzip",
    filename: "mindportalix-export.tgz",
  };
}

function arg(flags: string[], argv: string[]): string | undefined {
  for (const f of flags) {
    const i = argv.indexOf(f);
    if (i >= 0) return argv[i + 1];
  }
  return undefined;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const cfg = loadConfig();

  switch (cmd) {
    case "login": {
      const url = rest[0] ?? cfg.url;
      const token = arg(["--token", "-t"], rest) ?? process.env["OKF_ANCHOR_TOKEN"];
      if (!token) die("usage: okf login <url> --token <token>");
      saveConfig({ url, token });
      process.stdout.write(`saved ${CONFIG_PATH} (url=${url})\n`);
      return;
    }

    case "validate":
    case "hash": {
      const path = rest[0] ?? die(`usage: okf ${cmd} <dir|archive>`);
      const { bytes, contentType } = toArchive(path);
      const processed = await processBundle(archiveToEntries(bytes, contentType), {
        requireConformant: cmd === "validate",
      });
      process.stdout.write(
        JSON.stringify(
          {
            conformant: processed.validation.conformant,
            errors: processed.validation.errors,
            stats: processed.validation.stats,
            canonicalHash: processed.canonical.canonicalHash,
            merkleRoot: processed.canonical.merkleRoot,
            graphHash: processed.graph.graphHash,
            manifestHash: processed.manifest.manifestHash,
          },
          null,
          2,
        ) + "\n",
      );
      return;
    }

    case "publish": {
      if (!cfg.token) die("no token — run `okf login <url> --token <token>` first");
      const fromMp = arg(["--from-mindportalix"], rest);
      const filter = arg(["--filter"], rest) ?? "usable";
      const slug = arg(["--slug"], rest);
      const wait = rest.includes("--wait");
      const archive = fromMp
        ? await fetchMindPortalixExport(fromMp, filter)
        : toArchive(rest[0] ?? die("usage: okf publish <dir|archive> | --from-mindportalix <url>"));

      const res = await api(cfg, "/api/v1/bundles", {
        method: "POST",
        archive,
        ...(slug ? { headers: { "x-okf-asset-slug": slug } } : {}),
      });
      const body = (await res.json()) as { jobId?: string; state?: string; error?: { message: string } };
      if (!res.ok) die(`publish failed: ${body.error?.message ?? res.status}`);
      process.stdout.write(`job ${body.jobId} (${body.state})\n`);
      if (!wait || !body.jobId) return;

      for (;;) {
        await new Promise((r) => setTimeout(r, 800));
        const s = await api(cfg, `/api/v1/mint-jobs/${body.jobId}`);
        const j = (await s.json()) as { state: string; error?: string; asset?: { assetId: string; verificationUrl?: string } };
        process.stdout.write(`  ${j.state}\n`);
        if (j.state === "MINTED") {
          process.stdout.write(`asset ${j.asset?.assetId}\nverify ${j.asset?.verificationUrl}\n`);
          return;
        }
        if (j.state === "FAILED" || j.state === "INVALID") die(j.error ?? j.state);
      }
    }

    case "status": {
      const id = rest[0] ?? die("usage: okf status <jobId>");
      const res = await api(cfg, `/api/v1/mint-jobs/${id}`);
      process.stdout.write((await res.text()) + "\n");
      return;
    }

    case "verify": {
      const assetId = rest[0] ?? die("usage: okf verify <assetId> [<dir|archive>]");
      if (rest[1]) {
        const { bytes, contentType, filename } = toArchive(rest[1]);
        const form = new FormData();
        form.set("assetId", assetId);
        form.set("bundle", new Blob([Buffer.from(bytes)], { type: contentType }), filename);
        const res = await api(cfg, "/api/v1/assets/verify", { method: "POST", body: form });
        process.stdout.write((await res.text()) + "\n");
      } else {
        const res = await fetch(new URL(`/api/public/assets/${assetId}/verify`, cfg.url));
        process.stdout.write((await res.text()) + "\n");
      }
      return;
    }

    case "storage": {
      const sub = rest[0];
      const id = rest[1];
      if (sub === "status") {
        if (!id) die("usage: okf storage status <assetId>");
        const res = await fetch(new URL(`/api/public/assets/${id}`, cfg.url));
        if (!res.ok) die(`storage status failed: ${res.status}`);
        const a = (await res.json()) as {
          currentVersion?: { storageProvider?: string; storageCids?: Record<string, string> } | null;
        };
        const v = a.currentVersion;
        process.stdout.write(
          `Storage Provider: ${v?.storageProvider ?? "unknown"}\n` +
            `Source CID:     ${v?.storageCids?.["SOURCE_ARCHIVE"] ?? "—"}\n` +
            `Canonical CID:  ${v?.storageCids?.["CANONICAL_BUNDLE"] ?? "—"}\n` +
            `Manifest CID:   ${v?.storageCids?.["MANIFEST"] ?? "—"}\n` +
            `Graph CID:      ${v?.storageCids?.["GRAPH_NQUADS"] ?? "—"}\n`,
        );
        return;
      }
      if (sub === "retrieve") {
        if (!id) die("usage: okf storage retrieve <assetId> [--out <path>] [--version <n>]");
        const version = arg(["--version"], rest);
        const out = arg(["--out", "-o"], rest) ?? `${id}.bundle`;
        const u = new URL(`/api/public/assets/${id}/bundle`, cfg.url);
        if (version) u.searchParams.set("version", version);
        const res = await fetch(u);
        if (!res.ok) die(`retrieve failed: ${res.status}`);
        writeFileSync(out, Buffer.from(await res.arrayBuffer()));
        process.stdout.write(`saved ${out} (${res.headers.get("x-okf-storage-provider") ?? "?"} / ${res.headers.get("x-okf-cid") ?? "?"})\n`);
        return;
      }
      die("usage: okf storage <status|retrieve> <assetId>");
      return;
    }

    case "query": {
      const sparql = rest.find((a) => !a.startsWith("--")) ?? die("usage: okf query '<SPARQL>' [--asset <id>]");
      const asset = arg(["--asset"], rest);
      const res = await fetch(new URL("/api/public/query", cfg.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sparql, assetVersionId: asset }),
      });
      process.stdout.write((await res.text()) + "\n");
      return;
    }

    default:
      process.stdout.write(
        "okf <command>\n\n" +
          "  login <url> --token <t>       save credentials to ~/.okf/config.json\n" +
          "  validate <dir|archive>        check OKF v0.2 conformance\n" +
          "  hash <dir|archive>            print canonical / merkle / graph / manifest hashes\n" +
          "  publish <dir|archive> [--wait] [--slug s]\n" +
          "  publish --from-mindportalix <url> [--filter usable] [--wait]\n" +
          "  status <jobId>\n" +
          "  verify <assetId> [<dir|archive>]\n" +
          "  storage status <assetId>              provider + CIDs for the current version\n" +
          "  storage retrieve <assetId> [--out f] [--version n]\n" +
          "  query '<SPARQL>' [--asset <assetVersionId>]\n",
      );
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
