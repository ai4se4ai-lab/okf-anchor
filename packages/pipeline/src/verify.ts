/**
 * Independent verification. Given an asset id (or an uploaded archive to compare
 * against it), re-derive every hash from stored canonical content and check it
 * against what was anchored — never trusting a stored hash (skill:
 * okf-blockchain-anchor). The six checks map to the public verification screen.
 */
import { processBundle, type Commitment, type OkfManifest } from "@okf-anchor/okf-core";
import { verifySignature, type Providers } from "@okf-anchor/providers";
import type { PrismaClient } from "@okf-anchor/db";
import { detectMediaType, extractArchive } from "./archive.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface VerifyContext {
  readonly providers: Providers;
  readonly prisma: PrismaClient;
  readonly requestedBy?: string | undefined;
}

export interface VerificationChecks {
  readonly contentIntegrity: boolean;
  readonly manifestIntegrity: boolean;
  readonly anchorIntegrity: boolean;
  readonly signatureIntegrity: boolean;
  readonly storageIntegrity: boolean;
  readonly graphIntegrity: boolean;
}

export interface VerificationReport extends VerificationChecks {
  readonly passed: boolean;
  readonly assetId: string;
  readonly assetVersionId: string;
  readonly versionNumber: number;
  readonly changedFiles: string[];
  readonly addedFiles: string[];
  readonly removedFiles: string[];
  readonly expected: { canonicalHash: string; merkleRoot: string; graphHash: string; manifestHash: string };
  readonly actual: { canonicalHash: string; merkleRoot: string; graphHash: string; manifestHash: string };
  readonly persistedId?: string;
}

function diffFiles(
  stored: OkfManifest["files"],
  actual: ReadonlyArray<{ path: string; sha256: string }>,
): { changed: string[]; added: string[]; removed: string[] } {
  const storedMap = new Map(stored.map((f) => [f.path, f.sha256]));
  const actualMap = new Map(actual.map((f) => [f.path, f.sha256]));
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [path, sha] of actualMap) {
    if (!storedMap.has(path)) added.push(path);
    else if (storedMap.get(path) !== sha) changed.push(path);
  }
  for (const path of storedMap.keys()) {
    if (!actualMap.has(path)) removed.push(path);
  }
  return { changed: changed.sort(), added: added.sort(), removed: removed.sort() };
}

interface LoadedVersion {
  id: string;
  assetId: string;
  versionNumber: number;
  publisherId: string;
  canonicalHash: string;
  merkleRoot: string;
  graphHash: string;
  manifestHash: string;
  commitmentHash: string;
  signatureHex: string | null;
  signaturePublicKeyHex: string | null;
  okfVersion: string;
  anchor: { provider: string; network: string; ref: string } | null;
  storageObjects: Array<{ kind: string; cid: string }>;
}

async function loadVersion(prisma: PrismaClient, where: { assetVersionId?: string; assetId?: string }): Promise<LoadedVersion> {
  let versionId = where.assetVersionId;
  if (!versionId) {
    if (!where.assetId) throw new Error("verify requires assetVersionId or assetId");
    const asset = await prisma.asset.findUniqueOrThrow({
      where: { id: where.assetId },
      select: { currentVersionId: true },
    });
    if (!asset.currentVersionId) throw new Error("asset has no published version");
    versionId = asset.currentVersionId;
  }
  const version = await prisma.assetVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: { anchor: true, storageObjects: true, asset: { select: { okfVersion: true } } },
  });
  return {
    id: version.id,
    assetId: version.assetId,
    versionNumber: version.versionNumber,
    publisherId: version.publisherId,
    canonicalHash: version.canonicalHash,
    merkleRoot: version.merkleRoot,
    graphHash: version.graphHash,
    manifestHash: version.manifestHash,
    commitmentHash: version.commitmentHash,
    signatureHex: version.signatureHex,
    signaturePublicKeyHex: version.signaturePublicKeyHex,
    okfVersion: version.asset.okfVersion,
    anchor: version.anchor
      ? { provider: version.anchor.provider, network: version.anchor.network, ref: version.anchor.ref }
      : null,
    storageObjects: version.storageObjects,
  };
}

function cidOf(v: LoadedVersion, kind: string): string | undefined {
  return v.storageObjects.find((s) => s.kind === kind)?.cid;
}

function rebuildCommitment(v: LoadedVersion, sourceCid: string): Commitment {
  return {
    assetId: v.assetId,
    versionNumber: v.versionNumber,
    okfVersion: v.okfVersion,
    canonicalHash: v.canonicalHash,
    merkleRoot: v.merkleRoot,
    graphHash: v.graphHash,
    manifestHash: v.manifestHash,
    storageCid: sourceCid,
    publisher: v.publisherId,
  };
}

/** Full re-derivation from the stored source archive. */
export async function verifyStoredVersion(
  where: { assetVersionId?: string; assetId?: string },
  ctx: VerifyContext,
): Promise<VerificationReport> {
  const v = await loadVersion(ctx.prisma, where);
  const sourceCid = cidOf(v, "SOURCE_ARCHIVE");
  const manifestCid = cidOf(v, "MANIFEST");

  let storageIntegrity = true;
  let archiveBytes: Uint8Array | null = null;
  let storedManifest: OkfManifest | null = null;
  try {
    if (!sourceCid || !manifestCid) throw new Error("missing storage objects");
    archiveBytes = await ctx.providers.storage.get(sourceCid);
    storedManifest = JSON.parse(dec.decode(await ctx.providers.storage.get(manifestCid))) as OkfManifest;
  } catch {
    storageIntegrity = false;
  }

  let actual = { canonicalHash: "", merkleRoot: "", graphHash: "", manifestHash: "" };
  let changed: string[] = [];
  let added: string[] = [];
  let removed: string[] = [];
  let contentIntegrity = false;
  let manifestIntegrity = false;
  let graphIntegrity = false;

  if (archiveBytes) {
    const mediaType = detectMediaType(undefined, archiveBytes);
    const processed = await processBundle(extractArchive(archiveBytes, mediaType), {
      requireConformant: false,
    });
    actual = {
      canonicalHash: processed.canonical.canonicalHash,
      merkleRoot: processed.canonical.merkleRoot,
      graphHash: processed.graph.graphHash,
      manifestHash: processed.manifest.manifestHash,
    };
    if (storedManifest) {
      const d = diffFiles(storedManifest.files, processed.canonical.files);
      changed = d.changed;
      added = d.added;
      removed = d.removed;
    }
    contentIntegrity =
      actual.canonicalHash === v.canonicalHash &&
      actual.merkleRoot === v.merkleRoot &&
      changed.length === 0 &&
      added.length === 0 &&
      removed.length === 0;
    manifestIntegrity = actual.manifestHash === v.manifestHash;
    graphIntegrity = actual.graphHash === v.graphHash;
  }

  const signatureIntegrity =
    !!v.signatureHex &&
    !!v.signaturePublicKeyHex &&
    verifySignature(enc.encode(v.commitmentHash), v.signatureHex, v.signaturePublicKeyHex);

  let anchorIntegrity = false;
  if (v.anchor && sourceCid) {
    const result = await ctx.providers.anchor.verify(
      { provider: v.anchor.provider, network: v.anchor.network, ref: v.anchor.ref },
      rebuildCommitment(v, sourceCid),
    );
    anchorIntegrity = result.ok && contentIntegrity;
  }

  const checks: VerificationChecks = {
    contentIntegrity,
    manifestIntegrity,
    anchorIntegrity,
    signatureIntegrity,
    storageIntegrity,
    graphIntegrity,
  };
  const passed = Object.values(checks).every(Boolean);

  const persisted = await ctx.prisma.verificationResult.create({
    data: {
      assetVersionId: v.id,
      requestedBy: ctx.requestedBy ?? null,
      ...checks,
      passed,
      changedFiles: [...changed, ...added.map((p) => `+${p}`), ...removed.map((p) => `-${p}`)],
    },
    select: { id: true },
  });

  return {
    ...checks,
    passed,
    assetId: v.assetId,
    assetVersionId: v.id,
    versionNumber: v.versionNumber,
    changedFiles: changed,
    addedFiles: added,
    removedFiles: removed,
    expected: {
      canonicalHash: v.canonicalHash,
      merkleRoot: v.merkleRoot,
      graphHash: v.graphHash,
      manifestHash: v.manifestHash,
    },
    actual,
    persistedId: persisted.id,
  };
}

/**
 * Compare a caller-supplied archive to what was anchored for `assetId` (the
 * tamper-detection flow). Content / manifest / graph checks come from the
 * comparison; the anchor check passes only if the content still matches.
 */
export async function verifyAgainstUpload(
  assetId: string,
  archive: Uint8Array,
  originalFilename: string | undefined,
  ctx: VerifyContext,
): Promise<VerificationReport> {
  const v = await loadVersion(ctx.prisma, { assetId });
  const manifestCid = cidOf(v, "MANIFEST");
  const storedManifest = manifestCid
    ? (JSON.parse(dec.decode(await ctx.providers.storage.get(manifestCid))) as OkfManifest)
    : null;

  const processed = await processBundle(
    extractArchive(archive, detectMediaType(originalFilename, archive)),
    { requireConformant: false },
  );
  const actual = {
    canonicalHash: processed.canonical.canonicalHash,
    merkleRoot: processed.canonical.merkleRoot,
    graphHash: processed.graph.graphHash,
    manifestHash: processed.manifest.manifestHash,
  };
  const d = storedManifest
    ? diffFiles(storedManifest.files, processed.canonical.files)
    : { changed: [], added: [], removed: [] };

  const contentIntegrity =
    actual.canonicalHash === v.canonicalHash &&
    actual.merkleRoot === v.merkleRoot &&
    d.changed.length === 0 &&
    d.added.length === 0 &&
    d.removed.length === 0;
  const manifestIntegrity = actual.manifestHash === v.manifestHash;
  const graphIntegrity = actual.graphHash === v.graphHash;
  const signatureIntegrity =
    !!v.signatureHex &&
    !!v.signaturePublicKeyHex &&
    verifySignature(enc.encode(v.commitmentHash), v.signatureHex, v.signaturePublicKeyHex);
  const storageIntegrity = storedManifest !== null;
  const anchorIntegrity = contentIntegrity && manifestIntegrity && graphIntegrity;

  const checks: VerificationChecks = {
    contentIntegrity,
    manifestIntegrity,
    anchorIntegrity,
    signatureIntegrity,
    storageIntegrity,
    graphIntegrity,
  };
  const passed = Object.values(checks).every(Boolean);

  await ctx.prisma.verificationResult.create({
    data: {
      assetVersionId: v.id,
      requestedBy: ctx.requestedBy ?? null,
      ...checks,
      passed,
      changedFiles: [...d.changed, ...d.added.map((p) => `+${p}`), ...d.removed.map((p) => `-${p}`)],
    },
  });

  return {
    ...checks,
    passed,
    assetId: v.assetId,
    assetVersionId: v.id,
    versionNumber: v.versionNumber,
    changedFiles: d.changed,
    addedFiles: d.added,
    removedFiles: d.removed,
    expected: {
      canonicalHash: v.canonicalHash,
      merkleRoot: v.merkleRoot,
      graphHash: v.graphHash,
      manifestHash: v.manifestHash,
    },
    actual,
  };
}
