import "server-only";
import { prisma, publicBaseUrl } from "./providers";

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
