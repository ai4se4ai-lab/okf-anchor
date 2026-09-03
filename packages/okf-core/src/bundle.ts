/**
 * In-memory model of an OKF bundle: the set of files as received, after
 * path-safety vetting and resource-limit enforcement (CLAUDE.md §3). Archive
 * unpacking (zip / tar) happens upstream; this module takes already-extracted
 * `{ path, content }` entries and is the single gate that decides a byte array
 * is a "bundle" the pipeline may process. It never writes to disk and never
 * executes anything.
 */
import { OkfError } from "./errors.js";
import { checkBundlePath, dirSegments, isMarkdown, isReservedFile } from "./paths.js";

export interface BundleLimits {
  readonly maxEntries: number;
  readonly maxDepth: number;
  readonly maxMarkdownBytes: number;
  readonly maxPayloadBytes: number;
  readonly maxTotalBytes: number;
}

export const DEFAULT_LIMITS: BundleLimits = {
  maxEntries: 5000,
  maxDepth: 12,
  maxMarkdownBytes: 512 * 1024,
  maxPayloadBytes: 8 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
};

export interface RawEntry {
  readonly path: string;
  readonly content: Uint8Array;
}

export interface BundleFile {
  /** Normalized POSIX bundle-relative path (NFC, no leading slash). */
  readonly path: string;
  readonly content: Uint8Array;
  readonly bytes: number;
  readonly markdown: boolean;
  readonly reserved: boolean;
}

export class LoadedBundle {
  readonly files: readonly BundleFile[];
  private readonly index: Map<string, BundleFile>;

  constructor(files: BundleFile[]) {
    this.files = files;
    this.index = new Map(files.map((f) => [f.path, f]));
  }

  has(path: string): boolean {
    return this.index.has(path);
  }

  get(path: string): BundleFile | undefined {
    return this.index.get(path);
  }

  /** Non-reserved markdown files, i.e. concept documents. */
  concepts(): BundleFile[] {
    return this.files.filter((f) => f.markdown && !f.reserved);
  }

  paths(): string[] {
    return this.files.map((f) => f.path);
  }
}

/** Byte-wise (code-unit) comparison, so file order is platform-independent. */
function comparePath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function loadBundle(entries: readonly RawEntry[], limits: BundleLimits = DEFAULT_LIMITS): LoadedBundle {
  if (entries.length > limits.maxEntries) {
    throw new OkfError(
      "OKF_BUNDLE_TOO_MANY_ENTRIES",
      `bundle has ${entries.length} entries, limit is ${limits.maxEntries}`,
    );
  }

  const seen = new Set<string>();
  const unsafe: string[] = [];
  const tooDeep: string[] = [];
  const oversize: string[] = [];
  const files: BundleFile[] = [];
  let total = 0;

  for (const entry of entries) {
    const check = checkBundlePath(entry.path);
    if (!check.ok) {
      unsafe.push(`${entry.path}: ${check.reason}`);
      continue;
    }
    const path = check.normalized;
    if (seen.has(path)) {
      unsafe.push(`${path}: duplicate entry`);
      continue;
    }
    seen.add(path);

    if (dirSegments(path).length + 1 > limits.maxDepth) {
      tooDeep.push(path);
      continue;
    }

    const bytes = entry.content.byteLength;
    const markdown = isMarkdown(path);
    const cap = markdown ? limits.maxMarkdownBytes : limits.maxPayloadBytes;
    if (bytes > cap) {
      oversize.push(`${path}: ${bytes} bytes exceeds ${cap}`);
      continue;
    }
    total += bytes;

    files.push({ path, content: entry.content, bytes, markdown, reserved: isReservedFile(path) });
  }

  if (unsafe.length > 0) {
    throw new OkfError("OKF_BUNDLE_UNSAFE_PATH", `bundle contains unsafe or duplicate paths`, unsafe);
  }
  if (tooDeep.length > 0) {
    throw new OkfError("OKF_BUNDLE_TOO_DEEP", `bundle exceeds max depth ${limits.maxDepth}`, tooDeep);
  }
  if (oversize.length > 0) {
    throw new OkfError("OKF_BUNDLE_TOO_LARGE", `bundle contains oversized files`, oversize);
  }
  if (total > limits.maxTotalBytes) {
    throw new OkfError(
      "OKF_BUNDLE_TOO_LARGE",
      `bundle is ${total} bytes, limit is ${limits.maxTotalBytes}`,
    );
  }
  if (files.length === 0) {
    throw new OkfError("OKF_VALIDATION_FAILED", "bundle contains no files");
  }

  files.sort((a, b) => comparePath(a.path, b.path));
  return new LoadedBundle(files);
}
