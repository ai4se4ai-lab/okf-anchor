/**
 * The cryptographic manifest: a machine-readable index of every file hash plus
 * the bundle-level roots. `manifestHash` is the JCS+SHA-256 of the manifest
 * *without* volatile fields (`createdAt`), so it is reproducible from content
 * alone.
 */
import type { CanonicalResult } from "./canonical.js";
import { sha256Hex } from "./hash.js";
import { canonicalize } from "./jcs.js";

export interface OkfManifest {
  readonly format: "OKF";
  readonly okfVersion: string;
  readonly files: ReadonlyArray<{ path: string; sha256: string; bytes: number }>;
  readonly merkleRoot: string;
  readonly canonicalHash: string;
  readonly graphHash: string;
  /** Informational only — excluded from `manifestHash`. */
  readonly createdAt?: string;
}

export interface BuiltManifest {
  readonly manifest: OkfManifest;
  readonly manifestHash: string;
}

export function buildManifest(
  canonical: CanonicalResult,
  graphHash: string,
  createdAt?: string,
): BuiltManifest {
  const core = {
    format: "OKF" as const,
    okfVersion: canonical.okfVersion,
    files: canonical.files.map((f) => ({ path: f.path, sha256: f.sha256, bytes: f.bytes })),
    merkleRoot: canonical.merkleRoot,
    canonicalHash: canonical.canonicalHash,
    graphHash,
  };
  const manifestHash = sha256Hex(canonicalize(core));
  const manifest: OkfManifest = createdAt ? { ...core, createdAt } : core;
  return { manifest, manifestHash };
}
