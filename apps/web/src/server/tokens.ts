import "server-only";
import { createHash, randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** `okf_` + 40 URL-safe chars. Shown once; only the hash is stored. */
export function newApiToken(): string {
  const bytes = randomBytes(40);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `okf_${out}`;
}

export function tokenPrefix(token: string): string {
  return token.slice(0, 12);
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
