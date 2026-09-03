import { prisma } from "@/server/providers";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function VerifyIndexPage() {
  const assets = await prisma.asset.findMany({
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, name: true, publisherId: true },
  });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Verify a knowledge asset</h1>
      <p className="text-sm text-slate-500">
        Pick an asset to independently re-derive every hash from stored content and compare it to the
        blockchain anchor. Or upload a bundle to the{" "}
        <Link href="/mint" className="underline">mint form</Link> and check it against its anchored version.
      </p>
      <ul className="space-y-2">
        {assets.map((a) => (
          <li key={a.id}>
            <Link href={`/verify/${a.id}`} className="card block hover:border-slate-400">
              <span className="font-medium">{a.name}</span>{" "}
              <span className="text-xs text-slate-500">{a.publisherId}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
