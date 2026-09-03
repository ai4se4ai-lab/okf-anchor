"use client";

import { useState } from "react";

const SAMPLE = `PREFIX okf:  <https://okf.dev/ns#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?concept ?title ?trust WHERE {
  ?concept a skos:Concept ;
           okf:conceptId ?title ;
           okf:trustTier ?trust .
}
LIMIT 50`;

interface Bindings {
  type: "bindings";
  variables: string[];
  bindings: Array<Record<string, { value: string }>>;
}
type Result =
  | Bindings
  | { type: "boolean"; boolean: boolean }
  | { type: "quads"; nquads: string }
  | { error: { code: string; message: string } };

export default function QueryPage() {
  const [sparql, setSparql] = useState(SAMPLE);
  const [tab, setTab] = useState<"table" | "json">("table");
  const [result, setResult] = useState<Result | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/public/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sparql }),
      });
      const body = (await res.json()) as Result & { elapsedMs?: number };
      setElapsed(body.elapsedMs ?? null);
      setResult(body);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">SPARQL query</h1>
      <p className="text-sm text-slate-500">
        Deterministic query over the derived knowledge graph. Read-only: <code>SELECT</code>,{" "}
        <code>ASK</code>, <code>CONSTRUCT</code>, <code>DESCRIBE</code> only — write forms and{" "}
        <code>SERVICE</code> are rejected.
      </p>

      <textarea
        aria-label="SPARQL query"
        className="h-56 w-full rounded-md border border-slate-300 bg-white p-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
        value={sparql}
        onChange={(e) => setSparql(e.target.value)}
        spellCheck={false}
      />
      <div className="flex items-center gap-3">
        <button className="btn" onClick={run} disabled={loading}>
          {loading ? "Running…" : "Run query"}
        </button>
        {elapsed != null && <span className="text-xs text-slate-500">{elapsed} ms</span>}
      </div>

      {result && "error" in result && (
        <div className="card border-rose-300 text-sm check-fail">
          {result.error.code}: {result.error.message}
        </div>
      )}

      {result && "type" in result && (
        <div className="card">
          <div className="mb-2 flex gap-2 text-sm">
            <button
              className={tab === "table" ? "font-semibold underline" : "text-slate-500"}
              onClick={() => setTab("table")}
            >
              Table
            </button>
            <button
              className={tab === "json" ? "font-semibold underline" : "text-slate-500"}
              onClick={() => setTab("json")}
            >
              JSON
            </button>
          </div>

          {tab === "json" ? (
            <pre className="overflow-x-auto text-xs">{JSON.stringify(result, null, 2)}</pre>
          ) : result.type === "bindings" ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr>
                    {result.variables.map((v) => (
                      <th key={v} className="border-b border-slate-200 py-1 pr-4 font-semibold dark:border-slate-700">
                        {v}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.bindings.map((row, i) => (
                    <tr key={i}>
                      {result.variables.map((v) => (
                        <td key={v} className="border-b border-slate-100 py-1 pr-4 align-top font-mono text-xs dark:border-slate-800">
                          {row[v]?.value ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">{result.bindings.length} rows</p>
            </div>
          ) : result.type === "boolean" ? (
            <p className="font-mono">{String(result.boolean)}</p>
          ) : (
            <pre className="overflow-x-auto text-xs">{result.nquads}</pre>
          )}
        </div>
      )}
    </div>
  );
}
