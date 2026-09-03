/**
 * The deterministic core of the publish pipeline, with no I/O: raw bundle
 * entries in, every hash and the derived graph out. The worker layer wraps this
 * with storage, signing, and anchoring (which are the parts that touch the
 * network).
 */
import { DEFAULT_LIMITS, loadBundle, type BundleLimits, type RawEntry } from "./bundle.js";
import { canonicalizeBundle, type CanonicalResult } from "./canonical.js";
import { deriveGraph, type DerivedGraph } from "./graph.js";
import { buildManifest, type BuiltManifest } from "./manifest.js";
import { validateBundle, type ValidationResult } from "./validate.js";

export interface ProcessedBundle {
  readonly validation: ValidationResult;
  readonly canonical: CanonicalResult;
  readonly graph: DerivedGraph;
  readonly manifest: BuiltManifest;
}

export interface ProcessOptions {
  readonly limits?: BundleLimits;
  /** Included in `manifest.createdAt` only; never hashed. */
  readonly createdAt?: string;
  /** When true (default), throw if the bundle is not OKF-conformant (§11). */
  readonly requireConformant?: boolean;
}

export async function processBundle(
  entries: readonly RawEntry[],
  options: ProcessOptions = {},
): Promise<ProcessedBundle> {
  const bundle = loadBundle(entries, options.limits ?? DEFAULT_LIMITS);
  const validation = validateBundle(bundle);

  if ((options.requireConformant ?? true) && !validation.conformant) {
    const { OkfError } = await import("./errors.js");
    throw new OkfError(
      "OKF_VALIDATION_FAILED",
      `bundle is not OKF v0.2 conformant (${validation.errors.length} error(s))`,
      validation.errors.map((e) => `${e.path}: ${e.message}`),
    );
  }

  const canonical = canonicalizeBundle(bundle);
  const graph = await deriveGraph(bundle, canonical.canonicalHash);
  const manifest = buildManifest(canonical, graph.graphHash, options.createdAt);

  return { validation, canonical, graph, manifest };
}
