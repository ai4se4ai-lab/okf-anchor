/**
 * `GraphProvider` — stores the derived RDF dataset per asset version and answers
 * read-only SPARQL over it (CLAUDE.md §5, skill: okf-knowledge-graph). The
 * derived graph is never authoritative; it exists for querying.
 *
 * `LocalGraphProvider` uses Oxigraph (in-process, wasm, offline). Each asset
 * version's canonical N-Quads land in a named graph `urn:okf:av:<id>` so a query
 * can scope to one asset or run across the union of all of them.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { guardSparql, withResultCap, type SparqlGuardOptions } from "./sparql-guard.js";

type Oxigraph = typeof import("oxigraph");

// Oxigraph is a wasm module; load it lazily so importing this file (e.g. just to
// get the interface types, or to construct a provider that is never queried in
// this request) does not pull the wasm binary into the process or a bundler.
let oxigraphPromise: Promise<Oxigraph> | undefined;
async function loadOxigraph(): Promise<Oxigraph> {
  oxigraphPromise ??= import("oxigraph").then((m) => (("default" in m ? m.default : m) as Oxigraph));
  return oxigraphPromise;
}

export interface QueryOptions {
  /** Restrict the query to one asset version's named graph. */
  readonly assetVersionId?: string;
  readonly maxResults?: number;
}

export interface SparqlBinding {
  readonly [variable: string]: {
    type: string;
    value: string;
    datatype?: string;
    "xml:lang"?: string;
  };
}

export type SparqlResult =
  | { readonly type: "bindings"; readonly variables: string[]; readonly bindings: SparqlBinding[] }
  | { readonly type: "boolean"; readonly boolean: boolean }
  | { readonly type: "quads"; readonly nquads: string };

export interface GraphProvider {
  readonly kind: string;
  upsert(assetVersionId: string, nquads: string): Promise<void>;
  query(sparql: string, opts?: QueryOptions): Promise<SparqlResult>;
  clear(assetVersionId?: string): Promise<void>;
}

const GUARD_DEFAULTS: SparqlGuardOptions = { maxResults: 1000 };
const SPARQL_JSON = "application/sparql-results+json";
const NQUADS = "application/n-quads";

function avGraph(assetVersionId: string): string {
  return `urn:okf:av:${encodeURIComponent(assetVersionId)}`;
}

export class SparqlRejected extends Error {
  readonly code = "SPARQL_REJECTED";
  constructor(reason: string) {
    super(reason);
    this.name = "SparqlRejected";
  }
}

/**
 * In-process Oxigraph store, optionally backed by a directory of `.nq` files so
 * the graph survives a restart and is visible to every process that shares the
 * data dir (the API and the worker each hold their own store but hydrate from
 * the same files). This keeps the offline pipeline's SPARQL working without a
 * separate graph service.
 */
export class LocalGraphProvider implements GraphProvider {
  readonly kind = "local";
  private storePromise: Promise<import("oxigraph").Store> | undefined;
  private readonly persistDir: string | undefined;
  private readonly hydrated = new Set<string>();

  constructor(persistDir?: string) {
    this.persistDir = persistDir;
  }

  private async store(): Promise<import("oxigraph").Store> {
    this.storePromise ??= loadOxigraph().then((ox) => new ox.Store());
    return this.storePromise;
  }

  /** Load any `.nq` files from the persist dir that this process has not seen. */
  private async hydrate(): Promise<void> {
    if (!this.persistDir) return;
    let names: string[];
    try {
      names = await readdir(this.persistDir);
    } catch {
      return;
    }
    const ox = await loadOxigraph();
    const store = await this.store();
    for (const name of names) {
      if (!name.endsWith(".nq") || this.hydrated.has(name)) continue;
      const id = name.slice(0, -3);
      try {
        const nquads = await readFile(join(this.persistDir, name), "utf8");
        const graphName = ox.namedNode(avGraph(decodeURIComponent(id)));
        for (const q of store.match(null, null, null, graphName)) store.delete(q);
        store.load(nquads, { format: NQUADS, to_graph_name: graphName });
        this.hydrated.add(name);
      } catch {
        /* skip unreadable file */
      }
    }
  }

  async upsert(assetVersionId: string, nquads: string): Promise<void> {
    const ox = await loadOxigraph();
    const store = await this.store();
    const graphName = ox.namedNode(avGraph(assetVersionId));
    for (const q of store.match(null, null, null, graphName)) {
      store.delete(q);
    }
    store.load(nquads, { format: NQUADS, to_graph_name: graphName });
    if (this.persistDir) {
      const file = `${encodeURIComponent(assetVersionId)}.nq`;
      await mkdir(this.persistDir, { recursive: true });
      await writeFile(join(this.persistDir, file), nquads, "utf8");
      this.hydrated.add(file);
    }
  }

  async clear(assetVersionId?: string): Promise<void> {
    const ox = await loadOxigraph();
    const store = await this.store();
    const graphName = assetVersionId ? ox.namedNode(avGraph(assetVersionId)) : null;
    for (const q of store.match(null, null, null, graphName)) {
      store.delete(q);
    }
  }

  async query(sparql: string, opts: QueryOptions = {}): Promise<SparqlResult> {
    const guard = guardSparql(sparql, GUARD_DEFAULTS);
    if (!guard.ok) throw new SparqlRejected(guard.reason ?? "query rejected");

    await this.hydrate();
    const ox = await loadOxigraph();
    const store = await this.store();
    const capped = withResultCap(sparql, guard, opts.maxResults ?? GUARD_DEFAULTS.maxResults);
    const isConstruct = guard.queryType === "CONSTRUCT" || guard.queryType === "DESCRIBE";

    const queryOptions: Parameters<import("oxigraph").Store["query"]>[1] = {
      results_format: isConstruct ? NQUADS : SPARQL_JSON,
    };
    if (opts.assetVersionId) {
      queryOptions.default_graph = ox.namedNode(avGraph(opts.assetVersionId));
    } else {
      queryOptions.use_default_graph_as_union = true;
    }

    const raw = store.query(capped, queryOptions);
    if (typeof raw !== "string") {
      // Defensive: with results_format set, oxigraph returns a string.
      throw new SparqlRejected("unexpected non-serialized SPARQL result");
    }

    if (isConstruct) {
      return { type: "quads", nquads: raw };
    }

    const parsed = JSON.parse(raw) as
      | { boolean: boolean }
      | { head: { vars?: string[] }; results: { bindings: SparqlBinding[] } };

    if ("boolean" in parsed) {
      return { type: "boolean", boolean: parsed.boolean };
    }
    return {
      type: "bindings",
      variables: parsed.head.vars ?? [],
      bindings: parsed.results.bindings,
    };
  }
}
