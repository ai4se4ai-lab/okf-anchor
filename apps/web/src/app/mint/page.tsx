"use client";

import { useCallback, useRef, useState } from "react";

const STATES = [
  "RECEIVED",
  "VALIDATING",
  "CANONICALIZING",
  "GRAPHING",
  "UPLOADING",
  "SIGNING",
  "SUBMITTING",
  "CONFIRMING",
  "MINTED",
];

const DEV_TOKEN = "okf_dev_local_0000000000000000000000000000";

export default function MintPage() {
  const [token, setToken] = useState(DEV_TOKEN);
  const [slug, setSlug] = useState("");
  const [state, setState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asset, setAsset] = useState<{ assetId: string; verificationUrl: string | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const poll = useCallback(async (jobId: string) => {
    for (let i = 0; i < 120; i++) {
      const res = await fetch(`/api/v1/mint-jobs/${jobId}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      setState(body.state);
      if (body.state === "MINTED") {
        setAsset({
          assetId: body.asset?.assetId ?? "",
          verificationUrl: body.asset?.verificationUrl ?? null,
        });
        return;
      }
      if (body.state === "FAILED" || body.state === "INVALID") {
        setError(body.error ?? body.state);
        return;
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    setError("timed out waiting for the mint job");
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAsset(null);
    setState(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("choose a .zip or .tgz bundle");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("bundle", file);
      const res = await fetch("/api/v1/bundles", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "x-okf-asset-slug": slug || file.name.replace(/\.(zip|tgz|tar\.gz)$/i, ""),
        },
        body: form,
      });
      const body = await res.json();
      if (!res.ok) {
        setError(`${body.error?.code}: ${body.error?.message}`);
        return;
      }
      setState(body.state);
      await poll(body.jobId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="text-2xl font-semibold">Mint a knowledge asset</h1>
      <p className="text-sm text-slate-500">
        Upload an OKF v0.2 bundle (a <code>.zip</code> or <code>.tgz</code> — for example a
        MindPortalix export). It is validated, canonicalized, hashed, graphed, stored and anchored.
      </p>

      <form onSubmit={submit} className="card space-y-3">
        <label className="block text-sm">
          API token
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="block text-sm">
          Asset slug <span className="text-slate-500">(optional)</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="derived from the filename"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="block text-sm">
          Bundle archive
          <input ref={fileRef} type="file" accept=".zip,.tgz,.tar.gz,application/zip,application/gzip" className="mt-1 block text-sm" />
        </label>
        <button className="btn" disabled={busy} type="submit">
          {busy ? "Working…" : "Publish & mint"}
        </button>
      </form>

      {state && (
        <div className="card">
          <ol className="space-y-1 text-sm">
            {STATES.map((s) => {
              const idx = STATES.indexOf(state);
              const here = STATES.indexOf(s);
              const done = here < idx || state === "MINTED";
              const active = s === state;
              return (
                <li key={s} className={active ? "font-semibold" : done ? "check-pass" : "text-slate-500"}>
                  {done ? "✓" : active ? "•" : "○"} {s}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {error && <div className="card border-rose-300 text-sm check-fail">{error}</div>}

      {asset && (
        <div className="card border-emerald-400 text-sm">
          <p className="check-pass font-semibold">Minted.</p>
          <p className="mt-1">
            <a className="underline" href={`/assets/${asset.assetId}`}>View asset</a>
            {asset.verificationUrl && (
              <>
                {" · "}
                <a className="underline" href={`/verify/${asset.assetId}`}>Public verification</a>
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
