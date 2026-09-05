/** Field names that must never reach the terminal in cleartext (CLAUDE.md §9, §3 "Keys and secrets"). */
const SECRET_KEY_PATTERN = /token|secret|password|passwd|private[_-]?key|api[_-]?key|authorization|cookie/i;

const REDACTED = "***";

/** Redact secret-shaped keys one level deep; nested objects/arrays are stringified as-is. */
export function redactMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : value;
  }
  return out;
}
