/**
 * Bundle path safety. Every path that ends up in the canonical representation is
 * a POSIX, bundle-relative, NFC-normalized string with no `.`/`..` segments, no
 * leading slash, no drive letter, no NUL, and no backslash (CLAUDE.md §3,
 * skill: okf-security). This module only *classifies* strings — it never
 * touches the filesystem; archive extraction and directory walks apply these
 * checks per entry before trusting a name (zip-slip).
 */
import { OkfError } from "./errors.js";

const NUL = String.fromCharCode(0);

export interface SafePathResult {
  readonly ok: boolean;
  readonly normalized: string;
  readonly reason?: string;
}

/**
 * Normalize and vet an archive/tree entry name. Returns `{ ok: false, reason }`
 * for anything that could escape the bundle root rather than throwing, so a
 * caller can collect every offending entry.
 */
export function checkBundlePath(raw: string): SafePathResult {
  const input = String(raw);
  if (input.includes(NUL)) {
    return { ok: false, normalized: "", reason: "path contains a NUL byte" };
  }
  if (input.includes("\\")) {
    return { ok: false, normalized: "", reason: "path contains a backslash" };
  }
  if (/^[a-zA-Z]:/.test(input) || input.startsWith("//")) {
    return { ok: false, normalized: "", reason: "path is absolute" };
  }
  if (input.startsWith("/")) {
    return { ok: false, normalized: "", reason: "path is absolute" };
  }

  const segments = input.split("/");
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      return { ok: false, normalized: "", reason: "path escapes the bundle root" };
    }
    out.push(seg.normalize("NFC"));
  }
  if (out.length === 0) {
    return { ok: false, normalized: "", reason: "path is empty" };
  }
  return { ok: true, normalized: out.join("/") };
}

export function assertBundlePath(raw: string): string {
  const result = checkBundlePath(raw);
  if (!result.ok) {
    throw new OkfError("OKF_BUNDLE_UNSAFE_PATH", `unsafe bundle path: ${result.reason}`, [raw]);
  }
  return result.normalized;
}

/** Concept ID = bundle-relative path with a single trailing `.md` removed. */
export function conceptIdFromPath(path: string): string {
  return path.replace(/\.md$/i, "");
}

const RESERVED_RE = /(^|\/)(index|log)\.md$/i;

/** `index.md` / `log.md` at any level are generated bundle files, never concepts (OKF v0.2 §3.1). */
export function isReservedFile(path: string): boolean {
  return RESERVED_RE.test(path);
}

export function isMarkdown(path: string): boolean {
  return /\.md$/i.test(path);
}

/** Directory segments of a bundle path, e.g. `a/b/c.md` → `["a", "b"]`. */
export function dirSegments(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1);
}
