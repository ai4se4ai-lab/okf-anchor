/**
 * Canonical representation of an OKF bundle (CLAUDE.md §2). Deterministic
 * serialization used for hashing — no semantic enrichment, no locale, no
 * timestamps, no map iteration-order dependence. Two independent hashes are
 * produced and both are stored:
 *
 *  1. `merkleRoot` / per-file `sha256` — over EOL-normalized *raw bytes* of
 *     every regular file. This is what tamper detection diffs: a changed byte
 *     changes one leaf and the root, and the verifier can name the file.
 *
 *  2. `canonicalHash` — over a *semantic* canonical form: each concept's
 *     frontmatter re-serialized as JCS (RFC 8785) with sorted keys plus a hash
 *     of its normalized body; payload files contribute their normalized-byte
 *     hash. Two producers emitting the same knowledge with different YAML
 *     whitespace/key-order converge here, so this is the identity used for the
 *     `(assetId, canonicalHash)` version constraint.
 */
import { parseConcept } from "./document.js";
import { OkfError } from "./errors.js";
import { sha256Hex } from "./hash.js";
import { canonicalize, type JcsValue } from "./jcs.js";
import { leafHash, merkleRoot } from "./merkle.js";
import type { LoadedBundle } from "./bundle.js";

export interface CanonicalFileEntry {
  readonly path: string;
  /** SHA-256 hex of the EOL-normalized raw bytes. */
  readonly sha256: string;
  readonly bytes: number;
}

export interface CanonicalResult {
  readonly okfVersion: string;
  readonly files: CanonicalFileEntry[];
  readonly merkleRoot: string;
  /** SHA-256 hex of the JCS semantic canonical form. */
  readonly canonicalHash: string;
  /** The exact byte string that was hashed for `canonicalHash` (kept for audit/debug). */
  readonly canonicalForm: string;
}

const DECODER = new TextDecoder("utf-8", { fatal: false });

/** CRLF and lone CR → LF. Content is otherwise byte-preserved. */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function normalizeBody(body: string): string {
  const eol = normalizeEol(body);
  return eol.endsWith("\n") ? eol : eol + "\n";
}

/**
 * Recursively coerce a parsed-YAML value into a JCS-serializable value.
 * OKF frontmatter is strings, integers, booleans, null, lists and maps. A
 * `Date` (which a permissive YAML parser could produce) is rejected — the
 * producer keeps timestamps as strings and so must the canonical form.
 */
function toJcs(value: unknown, path: string): JcsValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new OkfError("OKF_CANONICALIZATION_FAILED", `non-finite number in ${path}`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => toJcs(item, `${path}[${i}]`));
  }
  if (value instanceof Date) {
    throw new OkfError(
      "OKF_CANONICALIZATION_FAILED",
      `datetime in ${path} was parsed as a Date; frontmatter timestamps must stay strings`,
    );
  }
  if (typeof value === "object") {
    const out: Record<string, JcsValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toJcs(v, `${path}.${k}`);
    }
    return out;
  }
  throw new OkfError("OKF_CANONICALIZATION_FAILED", `unsupported value type in ${path}`);
}

export function canonicalizeBundle(bundle: LoadedBundle): CanonicalResult {
  const files: CanonicalFileEntry[] = [];
  const leaves: Uint8Array[] = [];
  const semanticEntries: Array<[string, JcsValue]> = [];

  for (const file of bundle.files) {
    const isConcept = file.markdown && !file.reserved;
    const text = DECODER.decode(file.content);
    const normalizedBytes = new TextEncoder().encode(normalizeEol(text));

    const sha256 = sha256Hex(normalizedBytes);
    files.push({ path: file.path, sha256, bytes: normalizedBytes.byteLength });
    leaves.push(leafHash(normalizedBytes));

    if (isConcept) {
      const { frontmatter, body } = parseConcept(text);
      semanticEntries.push([
        file.path,
        {
          kind: "concept",
          frontmatter: toJcs(frontmatter, `${file.path}:frontmatter`),
          bodyHash: sha256Hex(normalizeBody(body)),
        },
      ]);
    } else {
      semanticEntries.push([file.path, { kind: "file", fileHash: sha256 }]);
    }
  }

  // Deterministic key order for the semantic map: sort by path (JCS also sorts,
  // but sorting here keeps `canonicalForm` readable and stable).
  semanticEntries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const semanticMap: Record<string, JcsValue> = {};
  for (const [path, value] of semanticEntries) semanticMap[path] = value;

  const canonicalForm = canonicalize({
    format: "OKF",
    okfVersion: "0.2",
    files: semanticMap,
  });

  return {
    okfVersion: "0.2",
    files,
    merkleRoot: merkleRoot(leaves).rootHex,
    canonicalHash: sha256Hex(canonicalForm),
    canonicalForm,
  };
}
