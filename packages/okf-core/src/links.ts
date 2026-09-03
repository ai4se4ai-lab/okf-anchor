/**
 * Cross-reference extraction from a concept body, ported from the producer
 * (MindPortalix `src/services/okf/okf-frontmatter.js` `extractConceptLinks` /
 * `okfNormalizeLinkTarget`) so the derived graph draws the same edges the
 * authoring app draws.
 *
 * Handles the three forms MindPortalix emits: `[[wikilinks]]` (resolved from the
 * bundle root), inline `[label](path)` markdown links (relative to the concept's
 * own directory, `.md` appended when the target is extensionless — the common
 * case in real bundles), and bare slug paths inside an inline code span.
 * `#anchors`, query strings, URLs and `mailto:` are ignored, as is anything that
 * escapes the bundle root or points at a non-markdown file. Broken links (a
 * target absent from the bundle) are still returned — resolution against the
 * file set happens in the graph layer (OKF v0.2 §6.1: consumers MUST tolerate
 * broken links).
 */
import { isReservedFile } from "./paths.js";

const WIKILINK_RE = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
const MDLINK_RE = /\[[^\]]*\]\(\s*([^)\s]+?)(?:\s+"[^"]*")?\s*\)/g;
const CODEPATH_RE = /`([^`\r\n]+)`/g;
const CODEPATH_OK = /^[A-Za-z0-9._/-]+$/;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function normalizeTarget(fromDirSegs: string[], href: string, fromRoot: boolean): string {
  const clean = String(href || "").split("#")[0]!.split("?")[0]!.trim();
  if (!clean) return "";
  const segs = fromRoot || clean.startsWith("/") ? [] : fromDirSegs.slice();
  for (const part of clean.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segs.pop();
    else segs.push(part);
  }
  if (!segs.length) return "";
  let out = segs.join("/");
  if (!/\.[a-z0-9]+$/i.test(out)) out += ".md";
  return /\.md$/i.test(out) ? out : "";
}

/**
 * Bundle-relative `.md` targets a concept body links to. Deduplicated,
 * self-references dropped, sorted. Reserved files (`index.md` / `log.md`) and a
 * link-free body yield `[]`. Never throws.
 */
export function extractConceptLinks(relPath: string, body: string): string[] {
  if (isReservedFile(String(relPath || ""))) return [];
  const text = String(body || "");
  const fromDirSegs = String(relPath || "").includes("/")
    ? String(relPath).split("/").slice(0, -1)
    : [];
  const out = new Set<string>();

  for (const m of text.matchAll(WIKILINK_RE)) {
    const target = normalizeTarget(fromDirSegs, m[1]!, true);
    if (target && target !== relPath) out.add(target);
  }
  for (const m of text.matchAll(MDLINK_RE)) {
    const href = m[1]!;
    if (!href || href.startsWith("#") || SCHEME_RE.test(href)) continue;
    const target = normalizeTarget(fromDirSegs, href, false);
    if (target && target !== relPath) out.add(target);
  }
  for (const m of text.matchAll(CODEPATH_RE)) {
    const ref = m[1]!.trim();
    if (!CODEPATH_OK.test(ref) || ref.endsWith("/")) continue;
    if (!ref.includes("/") && !/\.md$/i.test(ref)) continue;
    const target = normalizeTarget(fromDirSegs, ref, !ref.startsWith("."));
    if (target && target !== relPath) out.add(target);
  }

  return [...out].sort();
}

/**
 * Resolve a path-valued frontmatter field (`sources[].resource`,
 * `executor.resource`, `attester.resource`, `computation`, `resource`) that
 * points inside the bundle to a normalized bundle path, or `null` when it is an
 * external URL, a scope descriptor, or escapes the root (OKF §6.2).
 */
export function resolveInBundlePath(fromRelPath: string, value: string): string | null {
  const clean = String(value || "").trim();
  if (!clean || SCHEME_RE.test(clean)) return null;
  const fromDirSegs = fromRelPath.includes("/") ? fromRelPath.split("/").slice(0, -1) : [];
  const segs = clean.startsWith("/") ? [] : fromDirSegs.slice();
  for (const part of clean.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segs.length === 0) return null;
      segs.pop();
    } else segs.push(part);
  }
  return segs.length ? segs.join("/") : null;
}
