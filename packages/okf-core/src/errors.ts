/**
 * Typed errors for the OKF core pipeline. Messages never contain secrets or
 * absolute host paths — callers surface `.code` and `.message` to API clients
 * (CLAUDE.md §9).
 */

export type OkfErrorCode =
  | "OKF_DOCUMENT_MALFORMED"
  | "OKF_BUNDLE_UNSAFE_PATH"
  | "OKF_BUNDLE_TOO_LARGE"
  | "OKF_BUNDLE_TOO_DEEP"
  | "OKF_BUNDLE_TOO_MANY_ENTRIES"
  | "OKF_VALIDATION_FAILED"
  | "OKF_CANONICALIZATION_FAILED"
  | "OKF_GRAPH_DERIVATION_FAILED";

export class OkfError extends Error {
  readonly code: OkfErrorCode;
  readonly details: readonly string[];

  constructor(code: OkfErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = "OkfError";
    this.code = code;
    this.details = details;
  }
}

/** Thrown for a structurally malformed concept file, never for a missing optional field (OKF v0.2 §11). */
export class OkfDocumentError extends OkfError {
  constructor(message: string) {
    super("OKF_DOCUMENT_MALFORMED", message);
    this.name = "OkfDocumentError";
  }
}
