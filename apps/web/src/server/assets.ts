import "server-only";
import { prisma, publicBaseUrl, providers } from "./providers";

export async function assetSummary(assetId: string) {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: {
      currentVersion: {
        include: { anchor: true, storageObjects: true, source: true },
      },
      versions: {
        orderBy: { versionNumber: "desc" },
        select: {
          id: true,
          versionNumber: true,
          canonicalHash: true,
          merkleRoot: true,
          graphHash: true,
          publishedAt: true,
        },
      },
    },
  });
  if (!asset) return null;

  const v = asset.currentVersion;
  return {
    assetId: asset.id,
    slug: asset.slug,
    name: asset.name,
    description: asset.description,
    okfVersion: asset.okfVersion,
    publisher: asset.publisherId,
    createdAt: asset.createdAt.toISOString(),
    verificationUrl: `${publicBaseUrl.replace(/\/$/, "")}/verify/${asset.id}`,
    currentVersion: v
      ? {
          assetVersionId: v.id,
          versionNumber: v.versionNumber,
          publishedAt: v.publishedAt.toISOString(),
          canonicalHash: v.canonicalHash,
          merkleRoot: v.merkleRoot,
          graphHash: v.graphHash,
          manifestHash: v.manifestHash,
          commitmentHash: v.commitmentHash,
          signature: v.signaturePublicKeyHex
            ? { algorithm: "ed25519", publicKeyHex: v.signaturePublicKeyHex, signatureHex: v.signatureHex }
            : null,
          storageProvider: v.storageObjects[0]?.provider ?? null,
          storageCids: Object.fromEntries(v.storageObjects.map((s) => [s.kind, s.cid])),
          source: v.source
            ? { mediaType: v.source.mediaType, sizeBytes: v.source.sizeBytes, fileCount: v.source.fileCount }
            : null,
          anchor: v.anchor
            ? {
                provider: v.anchor.provider,
                network: v.anchor.network,
                ref: v.anchor.ref,
                state: v.anchor.state,
                committedHash: v.anchor.committedHash,
                blockNumber: v.anchor.blockNumber,
              }
            : null,
        }
      : null,
    versions: asset.versions.map((x) => ({
      assetVersionId: x.id,
      versionNumber: x.versionNumber,
      canonicalHash: x.canonicalHash,
      merkleRoot: x.merkleRoot,
      graphHash: x.graphHash,
      publishedAt: x.publishedAt.toISOString(),
    })),
  };
}

export interface RetrievedBundle {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly filename: string;
  readonly versionNumber: number;
  readonly cid: string;
  readonly storageProvider: string;
}

/**
 * Retrieve the complete OKF bundle (the exact source archive that was
 * published) for an asset, through OKF Anchor — never a raw Kubo/gateway URL a
 * caller supplies (CLAUDE.md §3, plan §16). The CID always comes from the
 * trusted `AssetVersion` record, never from a request parameter.
 */
export async function retrieveBundle(assetId: string, versionNumber?: number): Promise<RetrievedBundle | null> {
  const version = versionNumber
    ? await prisma.assetVersion.findUnique({
        where: { assetId_versionNumber: { assetId, versionNumber } },
        include: { source: true, storageObjects: true },
      })
    : await prisma.asset
        .findUnique({ where: { id: assetId }, include: { currentVersion: { include: { source: true, storageObjects: true } } } })
        .then((a) => a?.currentVersion ?? null);
  if (!version) return null;

  const sourceObject = version.storageObjects.find((s) => s.kind === "SOURCE_ARCHIVE");
  if (!sourceObject) return null;

  const bytes = await providers.storage.get(sourceObject.cid);
  return {
    bytes,
    mediaType: version.source?.mediaType ?? "application/octet-stream",
    filename: version.source?.originalFilename || `${assetId}-v${version.versionNumber}.bundle`,
    versionNumber: version.versionNumber,
    cid: sourceObject.cid,
    storageProvider: sourceObject.provider,
  };
}
