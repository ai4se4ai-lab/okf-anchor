/**
 * OKF v0.2 signal layer: trust tier, trust state, staleness, provenance
 * normalization. Verdict logic mirrors the producer
 * (MindPortalix `src/services/okf/okf-frontmatter.js`) so a concept gets the
 * same tier here as in the app that wrote it. Nothing here throws (OKF v0.2 §11).
 */
import type { Frontmatter } from "./document.js";

export type TrustTier = "unverified" | "machine-confirmed" | "human-reviewed";
export type TrustState = TrustTier | "verified-stale";

export interface VerificationEvent {
  readonly by: string;
  readonly at?: string;
}

export interface NormalizedSource {
  /** REQUIRED per OKF §5.1 — a URL, a bundle path, or a scope descriptor. */
  readonly resource: string;
  readonly id?: string;
  readonly title?: string;
  readonly author?: string;
  readonly usageCount?: number;
  readonly lastModified?: string;
  /** True when the entry was written as a bare string (`sources: [- files/x.txt]`). */
  readonly bare: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * `verified` events as an array (OKF §5.2). A lone verifier MAY be a bare
 * `{ by, at }` mapping; consumers MUST treat it as a one-element list.
 */
export function normalizeVerified(frontmatter: Frontmatter): VerificationEvent[] {
  const verified = frontmatter["verified"];
  const list = Array.isArray(verified) ? verified : verified != null ? [verified] : [];
  const out: VerificationEvent[] = [];
  for (const entry of list) {
    if (!isPlainObject(entry)) continue;
    const by = entry["by"];
    if (typeof by !== "string" || by === "") continue;
    const at = entry["at"];
    out.push(typeof at === "string" ? { by, at } : { by });
  }
  return out;
}

/**
 * `sources` normalization (OKF §5.1). Real producers emit a list of bare
 * strings; the reference corpus emits `{ id, resource, ... }` mappings. Accept
 * both. Entries with no usable `resource` are dropped.
 */
export function normalizeSources(frontmatter: Frontmatter): NormalizedSource[] {
  const raw = frontmatter["sources"];
  if (!Array.isArray(raw)) return [];
  const out: NormalizedSource[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      if (entry.trim() === "") continue;
      out.push({ resource: entry, bare: true });
      continue;
    }
    if (!isPlainObject(entry)) continue;
    const resource = entry["resource"];
    if (typeof resource !== "string" || resource.trim() === "") continue;
    const source: {
      resource: string;
      bare: boolean;
      id?: string;
      title?: string;
      author?: string;
      usageCount?: number;
      lastModified?: string;
    } = { resource, bare: false };
    if (typeof entry["id"] === "string") source.id = entry["id"];
    if (typeof entry["title"] === "string") source.title = entry["title"];
    if (typeof entry["author"] === "string") source.author = entry["author"];
    if (typeof entry["usage_count"] === "number") source.usageCount = entry["usage_count"];
    if (typeof entry["last_modified"] === "string") source.lastModified = entry["last_modified"];
    out.push(source);
  }
  return out;
}

/**
 * Trust tier from `verified` (OKF §5.3): no `verified` → unverified; only
 * non-`human:` actors → machine-confirmed; any `human:<id>` → human-reviewed.
 */
export function trustTier(frontmatter: Frontmatter): TrustTier {
  const events = normalizeVerified(frontmatter);
  if (events.length === 0) return "unverified";
  for (const event of events) {
    if (event.by.startsWith("human:")) return "human-reviewed";
  }
  return "machine-confirmed";
}

/** Latest `verified[].at`, or null when unverified / undated. */
export function lastVerifiedAt(frontmatter: Frontmatter): string | null {
  const ats = normalizeVerified(frontmatter)
    .map((e) => e.at)
    .filter((at): at is string => typeof at === "string" && at.length > 0)
    .sort();
  return ats.length ? (ats[ats.length - 1] as string) : null;
}

function generatedAt(frontmatter: Frontmatter): string | null {
  const generated = frontmatter["generated"];
  if (isPlainObject(generated) && typeof generated["at"] === "string") {
    return generated["at"];
  }
  return null;
}

/**
 * Verified-but-since-changed: a `verified` event exists AND `generated.at` is
 * strictly newer than the latest `verified[].at`.
 */
export function verifiedStaleRelativeToContent(frontmatter: Frontmatter): boolean {
  const g = generatedAt(frontmatter);
  const v = lastVerifiedAt(frontmatter);
  if (g === null || v === null) return false;
  const gp = Date.parse(g);
  const vp = Date.parse(v);
  if (Number.isNaN(gp) || Number.isNaN(vp)) return false;
  return gp > vp;
}

export function trustState(frontmatter: Frontmatter): TrustState {
  const tier = trustTier(frontmatter);
  if (tier === "unverified") return "unverified";
  return verifiedStaleRelativeToContent(frontmatter) ? "verified-stale" : tier;
}

/**
 * Staleness per `stale_after` (OKF §5.5): stale when `now >= stale_after`.
 * A `stale_after` without an explicit UTC offset names a different instant in
 * every timezone, so it is ignored rather than guessed.
 */
export function isStale(frontmatter: Frontmatter, now: Date = new Date()): boolean {
  const raw = String(frontmatter["stale_after"] ?? "");
  if (!raw.includes("T")) return false;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) return false;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return false;
  return now.getTime() >= parsed;
}

/** Whether a concept carries an Attested Computation contract (OKF §10.2). */
export function isAttested(frontmatter: Frontmatter): boolean {
  return (
    frontmatter["type"] === "Attested Computation" ||
    frontmatter["runtime"] != null ||
    frontmatter["executor"] != null ||
    frontmatter["attester"] != null
  );
}

export type LifecycleStatus = "draft" | "stable" | "deprecated";

export function status(frontmatter: Frontmatter): LifecycleStatus {
  const raw = frontmatter["status"];
  return raw === "draft" || raw === "deprecated" ? raw : "stable";
}
