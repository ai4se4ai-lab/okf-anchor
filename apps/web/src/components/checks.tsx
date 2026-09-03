/** Verification-check row. Never colour-only — always a text label (a11y, okf-security). */
export function CheckRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800">
      <span>{label}</span>
      <span className={ok ? "check-pass" : "check-fail"}>
        {ok ? "✓ pass" : "✗ fail"}
      </span>
    </div>
  );
}

export function Hash({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="py-1">
      <div className="text-[11px] uppercase tracking-wide text-slate-600 dark:text-slate-300">{label}</div>
      <div className="hash">{value ?? "—"}</div>
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card">
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}
