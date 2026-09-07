/** Field names that must never reach the terminal in cleartext (CLAUDE.md §9, §3 "Keys and secrets"). */
export const SECRET_KEY_PATTERN =
  /token|secret|password|passwd|private[_-]?key|api[_-]?key|authorization|cookie|mnemonic|seed|passphrase/i;

export const REDACTED = "***";

/** Redact secret-shaped keys one level deep; nested objects/arrays are stringified as-is. */
export function redactMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : value;
  }
  return out;
}

/** `true` if `key` names a secret that must never be logged or streamed. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}
