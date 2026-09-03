/**
 * Binary Merkle tree over per-file leaf hashes, with RFC 6962-style domain
 * separation (`0x00` prefix for leaves, `0x01` for internal nodes) so a leaf
 * digest can never be reinterpreted as an internal node (second-preimage
 * resistance). Leaves are supplied already ordered by the caller (sorted
 * bundle-path order); an odd level duplicates its last node.
 */
import { sha256Bytes, bytesToHex } from "./hash.js";

const LEAF_PREFIX = Uint8Array.of(0x00);
const NODE_PREFIX = Uint8Array.of(0x01);

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

export function leafHash(content: Uint8Array): Uint8Array {
  return sha256Bytes(concat(LEAF_PREFIX, content));
}

function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256Bytes(concat(NODE_PREFIX, left, right));
}

export interface MerkleResult {
  /** Lowercase hex root. The empty-tree root is the SHA-256 of the empty leaf. */
  readonly rootHex: string;
  readonly leafCount: number;
}

/** Build the root from ordered leaf digests (each a 32-byte SHA-256). */
export function merkleRoot(leaves: readonly Uint8Array[]): MerkleResult {
  if (leaves.length === 0) {
    return { rootHex: bytesToHex(sha256Bytes(LEAF_PREFIX)), leafCount: 0 };
  }
  let level: Uint8Array[] = leaves.slice();
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = i + 1 < level.length ? level[i + 1]! : left;
      next.push(nodeHash(left, right));
    }
    level = next;
  }
  return { rootHex: bytesToHex(level[0]!), leafCount: leaves.length };
}
