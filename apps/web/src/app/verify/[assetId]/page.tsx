import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma, providers } from "@/server/providers";
import { verifyStoredVersion } from "@okf-anchor/pipeline";
import { CheckRow, Hash } from "@/components/checks";

export const dynamic = "force-dynamic";

/** Public verification page — works without authentication (plan §40). */
export default async function VerifyAssetPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { name: true, publisherId: true, okfVersion: true } });
  if (!asset) notFound();

  let report;
  try {
    report = await verifyStoredVersion({ assetId }, { prisma, providers, requestedBy: "public-page" });
  } catch {
    notFound();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="text-center">
        <div
          className={`text-3xl font-bold ${report.passed ? "check-pass" : "check-fail"}`}
          role="status"
        >
          {report.passed ? "✓ VERIFIED" : "✗ VERIFICATION FAILED"}
        </div>
        <h1 className="mt-2 text-xl font-semibold">{asset.name}</h1>
        <p className="text-sm text-slate-500">
          {asset.publisherId} · OKF {asset.okfVersion} · version {report.versionNumber}
        </p>
      </div>

      <div className="card">
        <CheckRow label="Content integrity (Merkle root)" ok={report.contentIntegrity} />
        <CheckRow label="Manifest integrity" ok={report.manifestIntegrity} />
        <CheckRow label="Blockchain anchor" ok={report.anchorIntegrity} />
        <CheckRow label="Publisher signature" ok={report.signatureIntegrity} />
        <CheckRow label="Storage content" ok={report.storageIntegrity} />
        <CheckRow label="Graph integrity" ok={report.graphIntegrity} />
      </div>

      {!report.passed && (report.changedFiles.length > 0 || report.addedFiles.length > 0 || report.removedFiles.length > 0) && (
        <div className="card border-rose-300">
          <h2 className="mb-2 font-semibold check-fail">Tamper detected</h2>
          <ul className="space-y-1 text-sm">
            {report.changedFiles.map((f) => (
              <li key={f} className="check-fail">✗ modified: {f}</li>
            ))}
            {report.addedFiles.map((f) => (
              <li key={f} className="check-fail">＋ added: {f}</li>
            ))}
            {report.removedFiles.map((f) => (
              <li key={f} className="check-fail">－ removed: {f}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2 className="mb-1 font-semibold">Anchored commitment</h2>
        <Hash label="Expected canonical hash" value={report.expected.canonicalHash} />
        <Hash label="Recomputed canonical hash" value={report.actual.canonicalHash || "—"} />
        <Hash label="Expected Merkle root" value={report.expected.merkleRoot} />
        <Hash label="Recomputed Merkle root" value={report.actual.merkleRoot || "—"} />
      </div>

      <div className="flex gap-3 text-sm">
        <Link href={`/assets/${report.assetId}`} className="underline">View asset</Link>
        <Link href={`/query`} className="underline">Query knowledge</Link>
        <a href={`/api/public/assets/${report.assetId}/verify`} className="underline">JSON</a>
      </div>
    </div>
  );
}
