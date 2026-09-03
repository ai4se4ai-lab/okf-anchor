import Link from "next/link";
import { prisma } from "@/server/providers";
import { StatCard } from "@/components/checks";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [assets, versions, verifiedOk, servers, anchors, jobs, recent] = await Promise.all([
    prisma.asset.count(),
    prisma.assetVersion.count(),
    prisma.verificationResult.count({ where: { passed: true } }),
    prisma.buildServer.count(),
    prisma.anchor.count({ where: { state: "CONFIRMED" } }),
    prisma.mintJob.count(),
    prisma.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Knowledge assets published, hashed, graphed, stored and anchored.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Knowledge assets" value={assets} />
        <StatCard label="Published versions" value={versions} />
        <StatCard label="Verifications passed" value={verifiedOk} />
        <StatCard label="Build servers" value={servers} />
        <StatCard label="Confirmed anchors" value={anchors} />
        <StatCard label="Mint jobs" value={jobs} />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Recent activity
        </h2>
        <div className="card divide-y divide-slate-100 dark:divide-slate-800">
          {recent.length === 0 && <p className="text-sm text-slate-500">Nothing yet.</p>}
          {recent.map((e) => (
            <div key={e.id} className="flex items-center justify-between py-2 text-sm">
              <span>
                <span className="font-medium">{e.action}</span>{" "}
                <span className="text-slate-500">
                  {e.subjectType} · {e.actorId}
                </span>
              </span>
              <span className="text-xs text-slate-500">{e.createdAt.toISOString()}</span>
            </div>
          ))}
        </div>
      </section>

      <p className="text-sm text-slate-600 dark:text-slate-300">
        Publish from a build server with{" "}
        <code className="rounded bg-slate-100 px-1 text-slate-800 dark:bg-slate-800 dark:text-slate-100">
          POST /api/v1/bundles
        </code>
        , or try the{" "}
        <Link href="/mint" className="underline">
          mint form
        </Link>
        .
      </p>
    </div>
  );
}
