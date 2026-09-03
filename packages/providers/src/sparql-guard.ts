/**
 * Every incoming SPARQL query is untrusted input (CLAUDE.md §3,
 * skill: okf-knowledge-graph). Parse with `sparqljs`; allow only read forms
 * (`SELECT` / `ASK` / `CONSTRUCT` / `DESCRIBE`); reject any update operation;
 * reject `SERVICE` (SPARQL federation is an SSRF vector). The whole validated
 * query string is what gets executed — never a string built from fragments.
 */
import { Parser, type SparqlQuery } from "sparqljs";

export interface SparqlGuardOptions {
  /** Hard cap injected as a `LIMIT` when the query has none (SELECT/CONSTRUCT). */
  readonly maxResults: number;
}

export interface SparqlGuardResult {
  readonly ok: boolean;
  readonly queryType?: "SELECT" | "ASK" | "CONSTRUCT" | "DESCRIBE";
  readonly reason?: string;
}

const READ_TYPES = new Set(["SELECT", "ASK", "CONSTRUCT", "DESCRIBE"]);

function hasServiceClause(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(hasServiceClause);
  const obj = node as Record<string, unknown>;
  if (obj["type"] === "service") return true;
  return Object.values(obj).some((v) => typeof v === "object" && hasServiceClause(v));
}

export function guardSparql(query: string, _options: SparqlGuardOptions): SparqlGuardResult {
  if (typeof query !== "string" || query.length === 0) {
    return { ok: false, reason: "empty query" };
  }
  if (query.length > 20_000) {
    return { ok: false, reason: "query exceeds length limit" };
  }

  let parsed: SparqlQuery;
  try {
    parsed = new Parser().parse(query) as SparqlQuery;
  } catch (err) {
    return { ok: false, reason: `parse error: ${(err as Error).message}` };
  }

  if (parsed.type === "update") {
    return { ok: false, reason: "update operations are not permitted on the read endpoint" };
  }
  if (parsed.type !== "query") {
    return { ok: false, reason: "unsupported query document" };
  }
  const qt = parsed.queryType;
  if (!READ_TYPES.has(qt)) {
    return { ok: false, reason: `query type ${qt} is not permitted` };
  }
  if (hasServiceClause(parsed)) {
    return { ok: false, reason: "SERVICE (federation) is not permitted" };
  }

  return { ok: true, queryType: qt as "SELECT" | "ASK" | "CONSTRUCT" | "DESCRIBE" };
}

/** Append a `LIMIT` if a SELECT/CONSTRUCT query lacks one. Purely textual and safe. */
export function withResultCap(query: string, guard: SparqlGuardResult, maxResults: number): string {
  if (guard.queryType !== "SELECT" && guard.queryType !== "CONSTRUCT") return query;
  if (/\blimit\s+\d+/i.test(query)) return query;
  return `${query.trimEnd()}\nLIMIT ${maxResults}\n`;
}
