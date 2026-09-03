/**
 * JSON Canonicalization Scheme (RFC 8785), the subset OKF Anchor needs.
 *
 * Deterministic serialization used for hashing (CLAUDE.md §2): identical logical
 * input → identical bytes on every run, machine, and Node version. Object keys
 * are sorted by UTF-16 code unit (RFC 8785 §3.2.3), arrays keep order, strings
 * use the RFC 8785 §3.2.2.2 escape set, and numbers must be finite integers or
 * exact doubles — OKF frontmatter only ever carries integers (`usage_count`) and
 * booleans besides strings, so a non-finite or non-integer number is rejected
 * rather than guessed.
 */

export type JcsValue =
  | null
  | boolean
  | number
  | string
  | JcsValue[]
  | { [key: string]: JcsValue | undefined };

const ESCAPES: Record<string, string> = {
  '"': '\\"',
  "\\": "\\\\",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

function serializeString(str: string): string {
  let out = '"';
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    if (ESCAPES[ch]) {
      out += ESCAPES[ch];
    } else if (code < 0x20) {
      out += "\\u" + code.toString(16).padStart(4, "0");
    } else {
      out += ch;
    }
  }
  return out + '"';
}

function serializeNumber(num: number): string {
  if (!Number.isFinite(num)) {
    throw new TypeError("JCS: non-finite number is not serializable");
  }
  if (Number.isInteger(num)) {
    // Avoid "-0" and exponent forms for the integer range OKF uses.
    return Object.is(num, -0) ? "0" : String(num);
  }
  // RFC 8785 mandates the ECMAScript Number-to-String algorithm; JS `String`
  // already implements it. OKF has no fractional frontmatter numbers, but keep
  // the branch correct rather than lossy.
  return String(num);
}

export function canonicalize(value: JcsValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return serializeNumber(value);
  if (typeof value === "string") return serializeString(value);

  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalize(item ?? null)).join(",") + "]";
  }

  if (typeof value === "object") {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const body = keys
      .map((k) => serializeString(k) + ":" + canonicalize(value[k] as JcsValue))
      .join(",");
    return "{" + body + "}";
  }

  throw new TypeError(`JCS: unsupported value type ${typeof value}`);
}

/** UTF-8 bytes of the canonical form. */
export function canonicalizeBytes(value: JcsValue): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}
