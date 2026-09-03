/**
 * Archive extraction for uploaded bundles. Every entry name is vetted with
 * `checkBundlePath` before it is trusted (zip-slip / tar traversal), directory
 * and non-regular entries are skipped, and the same size / count limits as the
 * bundle loader apply here so a zip bomb is rejected at the boundary
 * (CLAUDE.md §3, skill: okf-security). No file is ever written to disk during
 * extraction.
 */
import { gunzipSync, unzipSync } from "fflate";
import { parseTar } from "nanotar";
import { checkBundlePath, OkfError, type RawEntry } from "@okf-anchor/okf-core";

export type ArchiveMediaType = "application/zip" | "application/gzip";

export interface ExtractLimits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
}

export const DEFAULT_EXTRACT_LIMITS: ExtractLimits = {
  maxEntries: 5000,
  maxEntryBytes: 8 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
};

export function detectMediaType(filename: string | undefined, bytes: Uint8Array): ArchiveMediaType {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return "application/zip";
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return "application/gzip";
  if (filename?.endsWith(".zip")) return "application/zip";
  if (filename?.endsWith(".tgz") || filename?.endsWith(".tar.gz")) return "application/gzip";
  throw new OkfError("OKF_VALIDATION_FAILED", "unrecognized archive format (expected .zip or .tgz)");
}

interface Collected {
  entries: RawEntry[];
  total: number;
  unsafe: string[];
}

function push(c: Collected, name: string, data: Uint8Array, limits: ExtractLimits): void {
  // Strip a single leading top-level directory the way `tar`/`git archive` add one.
  const check = checkBundlePath(name);
  if (!check.ok) {
    c.unsafe.push(`${name}: ${check.reason}`);
    return;
  }
  if (data.byteLength > limits.maxEntryBytes) {
    c.unsafe.push(`${check.normalized}: entry exceeds ${limits.maxEntryBytes} bytes`);
    return;
  }
  c.total += data.byteLength;
  if (c.total > limits.maxTotalBytes || c.entries.length + 1 > limits.maxEntries) {
    throw new OkfError("OKF_BUNDLE_TOO_LARGE", "archive exceeds extraction limits");
  }
  c.entries.push({ path: check.normalized, content: data });
}

function stripCommonPrefix(entries: RawEntry[]): RawEntry[] {
  if (entries.length === 0) return entries;
  const firstSeg = (p: string): string => p.split("/")[0] ?? "";
  const seg0 = firstSeg(entries[0]!.path);
  if (!seg0) return entries;
  const allShare = entries.every((e) => e.path === seg0 || e.path.startsWith(seg0 + "/"));
  const anyBare = entries.some((e) => !e.path.includes("/"));
  if (!allShare || anyBare) return entries;
  return entries
    .filter((e) => e.path !== seg0)
    .map((e) => ({ path: e.path.slice(seg0.length + 1), content: e.content }));
}

export function extractArchive(
  bytes: Uint8Array,
  mediaType: ArchiveMediaType,
  limits: ExtractLimits = DEFAULT_EXTRACT_LIMITS,
): RawEntry[] {
  const c: Collected = { entries: [], total: 0, unsafe: [] };

  if (mediaType === "application/zip") {
    const files = unzipSync(bytes);
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith("/")) continue; // directory entry
      push(c, name, data, limits);
    }
  } else {
    const tarBytes = gunzipSync(bytes);
    for (const entry of parseTar(tarBytes)) {
      if (entry.type === "directory") continue;
      if (entry.name.endsWith("/")) continue;
      push(c, entry.name, entry.data ?? new Uint8Array(), limits);
    }
  }

  if (c.unsafe.length > 0) {
    throw new OkfError("OKF_BUNDLE_UNSAFE_PATH", "archive contains unsafe entries", c.unsafe);
  }
  if (c.entries.length === 0) {
    throw new OkfError("OKF_VALIDATION_FAILED", "archive contains no files");
  }
  return stripCommonPrefix(c.entries);
}
