/**
 * Hashing primitives. Every hash the platform stores is an explicit
 * `{ algo, value }` pair, never a bare hex string with an implicit algorithm
 * (skill: okf-knowledge-graph).
 */
import { createHash } from "node:crypto";

export const HASH_ALGO = "sha-256" as const;
export type HashAlgo = typeof HASH_ALGO;

export interface HashRef {
  readonly algo: HashAlgo;
  readonly value: string;
}

/** Lowercase hex SHA-256 of the given bytes. */
export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256")
    .update(typeof data === "string" ? Buffer.from(data, "utf8") : data)
    .digest("hex");
}

export function sha256(data: Uint8Array | string): HashRef {
  return { algo: HASH_ALGO, value: sha256Hex(data) };
}

/** Raw 32-byte SHA-256 digest — used by the Merkle tree. */
export function sha256Bytes(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new TypeError("invalid hex string");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}
