import Link from "next/link";
import { prisma } from "@/server/providers";

export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  const assets = await prisma.asset.findMany({
    orderBy: { updatedAt: "desc" },
    include: { currentVersion: { select: { versionNumber: true, canonicalHash: true } }, _count: { select: { versions: true } } },
    take: 100,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Knowledge assets</h1>
      {assets.length === 0 && <p className="text-sm text-slate-500">No assets published yet.</p>}
      <div className="space-y-2">
        {assets.map((a) => (
          <Link
            key={a.id}
            href={`/assets/${a.id}`}
            className="card flex items-center justify-between hover:border-slate-400"
          >
            <div>
              <div className="font-medium">{a.name}</div>
              <div className="text-xs text-slate-500">
                {a.publisherId} · {a.slug} · v{a.currentVersion?.versionNumber ?? "?"} of {a._count.versions}
              </div>
            </div>
            <code className="hash hidden sm:block">{a.currentVersion?.canonicalHash}</code>
          </Link>
        ))}
      </div>
    </div>
  );
}
