import Link from "next/link";
import { notFound } from "next/navigation";
import { assetSummary } from "@/server/assets";
import { ipfsGatewayUrl } from "@/server/providers";
import { Hash } from "@/components/checks";

export const dynamic = "force-dynamic";

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await assetSummary(id);
  if (!a) notFound();
  const v = a.currentVersion;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{a.name}</h1>
        <p className="text-sm text-slate-500">
          {a.publisher} · {a.slug} · OKF {a.okfVersion}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href={`/verify/${a.assetId}`} className="btn">
          Verify
        </Link>
        <Link href={`/query?asset=${v?.assetVersionId ?? ""}`} className="btn">
          Query graph
        </Link>
      </div>

      {v && (
        <div className="card">
          <h2 className="mb-2 font-semibold">
            Version {v.versionNumber}{" "}
            <span className="text-sm font-normal text-slate-500">{v.publishedAt}</span>
          </h2>
          <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
            <Hash label="Canonical hash" value={v.canonicalHash} />
            <Hash label="Merkle root" value={v.merkleRoot} />
            <Hash label="Graph hash" value={v.graphHash} />
            <Hash label="Manifest hash" value={v.manifestHash} />
            <Hash label="Commitment hash" value={v.commitmentHash} />
            <Hash label="Publisher key (ed25519)" value={v.signature?.publicKeyHex} />
          </div>
          {v.anchor && (
            <div className="mt-3 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Blockchain anchor</div>
              <div>
                {v.anchor.provider} / {v.anchor.network} · <span className="font-medium">{v.anchor.state}</span>
              </div>
              <code className="hash">{v.anchor.ref}</code>
            </div>
          )}
        </div>
      )}

      {v && (
        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Storage</h2>
            <a href={`/api/v1/assets/${a.assetId}/bundle`} className="btn text-xs">
              Retrieve bundle
            </a>
          </div>
          <p className="mb-2 text-xs text-slate-500">
            Provider: <span className="font-medium">{v.storageProvider ?? "unknown"}</span>. Bundles are always
            fetched through OKF Anchor, never Kubo's admin API directly — content availability alone does not prove
            authenticity; see <Link href={`/verify/${a.assetId}`} className="underline">Verify</Link> for that.
          </p>
          <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
            <Hash label="Source CID" value={v.storageCids["SOURCE_ARCHIVE"]} />
            <Hash label="Canonical CID" value={v.storageCids["CANONICAL_BUNDLE"]} />
            <Hash label="Graph CID" value={v.storageCids["GRAPH_NQUADS"]} />
            <Hash label="Manifest CID" value={v.storageCids["MANIFEST"]} />
          </div>
          {ipfsGatewayUrl && v.storageProvider === "ipfs" && v.storageCids["SOURCE_ARCHIVE"] && (
            <a
              href={`${ipfsGatewayUrl.replace(/\/$/, "")}/ipfs/${v.storageCids["SOURCE_ARCHIVE"]}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs underline"
            >
              Open source archive in IPFS gateway ↗
            </a>
          )}
        </div>
      )}

      <div className="card">
        <h2 className="mb-2 font-semibold">Version history</h2>
        <ul className="space-y-1 text-sm">
          {a.versions.map((x) => (
            <li key={x.assetVersionId} className="flex justify-between">
              <span>
                v{x.versionNumber}
                {x.versionNumber === v?.versionNumber && (
                  <span className="ml-2 text-xs text-emerald-700 dark:text-emerald-400">current</span>
                )}
              </span>
              <code className="hash">{x.canonicalHash}</code>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
