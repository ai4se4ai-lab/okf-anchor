/**
 * Parse and serialize a single OKF v0.2 concept document: a UTF-8 markdown file
 * with a `---`-delimited YAML frontmatter block followed by a markdown body
 * (OKF v0.2 §4).
 *
 * Ported to match the producer exactly. MindPortalix serializes with the `yaml`
 * npm package (`src/services/okf/okf-frontmatter.js` reads with
 * `yaml.CORE_SCHEMA`; the DeepSeek Harness `dsh-okf-core/document.ts` writes
 * with `yaml`'s `stringify`), which keeps ISO 8601 datetimes as strings and
 * preserves frontmatter key order as written. We use the same library so a
 * round-trip is byte-identical to the input.
 *
 * Per OKF v0.2 §11 nothing here rejects a document for a missing/unknown field.
 * The one exception is an unterminated `---` block, which is malformed markdown.
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { OkfDocumentError } from "./errors.js";

const DELIM = "---";

export type Frontmatter = Record<string, unknown>;

export interface OkfConcept {
  /** Parsed frontmatter mapping. `{}` when the file carries none. */
  readonly frontmatter: Frontmatter;
  /** Everything after the closing `---`, with one leading blank line trimmed. */
  readonly body: string;
}

/**
 * Split a concept file into `{ frontmatter, body }`.
 *
 * A file whose first line is not `---` is all body with empty frontmatter
 * (OKF v0.2 §8 index files, §4 permits a bare body). An opening `---` with no
 * matching closing `---`, or frontmatter that is not a YAML mapping, is
 * malformed and throws {@link OkfDocumentError}.
 */
export function parseConcept(text: string): OkfConcept {
  const lines = String(text).split(/\r?\n/);
  if (lines[0]?.trim() !== DELIM) {
    return { frontmatter: {}, body: String(text) };
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === DELIM) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    throw new OkfDocumentError("unterminated YAML frontmatter block");
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(lines.slice(1, endIdx).join("\n")) ?? {};
  } catch (err) {
    throw new OkfDocumentError(`invalid YAML in frontmatter: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new OkfDocumentError("frontmatter must be a YAML mapping");
  }
  let body = lines.slice(endIdx + 1).join("\n");
  if (body.startsWith("\n")) body = body.slice(1);
  return { frontmatter: parsed as Frontmatter, body };
}

/**
 * Serialize a concept back to file text: `---\n<yaml>\n---\n\n<body>\n`.
 * Frontmatter key order is preserved as given; the body always ends in exactly
 * one newline. An empty frontmatter object emits body only (index/log files).
 */
export function serializeConcept(concept: OkfConcept): string {
  const body = concept.body.endsWith("\n") ? concept.body : `${concept.body}\n`;
  if (Object.keys(concept.frontmatter).length === 0) {
    return body;
  }
  const fm = stringifyYaml(concept.frontmatter, { lineWidth: 0 }).replace(/\n+$/, "");
  return `${DELIM}\n${fm}\n${DELIM}\n\n${body}`;
}

/**
 * OKF's one hard requirement (§11): a non-empty string `type`. Returns a reason
 * when unmet, never throws, so a consumer lists a non-conformant file instead of
 * rejecting the whole bundle.
 */
export function conformanceIssue(frontmatter: Frontmatter): string | null {
  const type = frontmatter["type"];
  if (type === undefined || type === null || type === "") {
    return "missing required frontmatter key: type";
  }
  if (typeof type !== "string") {
    return 'frontmatter key "type" must be a string';
  }
  return null;
}
