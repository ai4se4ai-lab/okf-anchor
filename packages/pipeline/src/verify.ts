/**
 * Independent verification. Given an asset id (or an uploaded archive to compare
 * against it), re-derive every hash from stored canonical content and check it
 * against what was anchored — never trusting a stored hash (skill:
 * okf-blockchain-anchor). The six checks map to the public verification screen.
 */
import { randomUUID } from "node:crypto";
import { processBundle, type Commitment, type OkfManifest } from "@okf-anchor/okf-core";
import { verifySignature, type Providers } from "@okf-anchor/providers";
import type { PrismaClient } from "@okf-anchor/db";
import { detectMediaType, extractArchive } from "./archive.js";
import { makeEmitter, type PipelineEventSink } from "./events.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface VerifyContext {
  readonly providers: Providers;
  readonly prisma: PrismaClient;
  readonly requestedBy?: string | undefined;
  /** Optional structured event stream for the live activity console (best-effort). */
  readonly onEvent?: PipelineEventSink | undefined;
  /** Correlates the emitted events with an activity run; generated when omitted. */
  readonly runId?: string | undefined;
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
  /** Correlation id for the live activity console run that streamed this verification. */
  readonly runId: string;
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
  const runId = ctx.runId ?? randomUUID();
  const emit = makeEmitter(ctx.onEvent);

  const v = await loadVersion(ctx.prisma, where);
  const sourceCid = cidOf(v, "SOURCE_ARCHIVE");
  const manifestCid = cidOf(v, "MANIFEST");
  await emit(
    "load",
    "info",
    `loaded version ${v.versionNumber} of ${v.assetId}`,
    {
      assetId: v.assetId,
      versionNumber: v.versionNumber,
      anchorProvider: v.anchor?.provider ?? "none",
      anchorNetwork: v.anchor?.network ?? "none",
      anchorRef: v.anchor?.ref ?? "none",
    },
    "okf",
  );

  let storageIntegrity = true;
  let archiveBytes: Uint8Array | null = null;
  let storedManifest: OkfManifest | null = null;
  try {
    if (!sourceCid || !manifestCid) throw new Error("missing storage objects");
    archiveBytes = await ctx.providers.storage.get(sourceCid);
    storedManifest = JSON.parse(dec.decode(await ctx.providers.storage.get(manifestCid))) as OkfManifest;
    await emit(
      "storage-fetch",
      "success",
      `fetched source archive (${archiveBytes.byteLength} bytes) + manifest from ${ctx.providers.storage.kind}`,
      { provider: ctx.providers.storage.kind, sourceCid, manifestCid, bytes: archiveBytes.byteLength },
      "storage",
    );
  } catch {
    storageIntegrity = false;
    await emit(
      "storage-fetch",
      "error",
      "could not fetch stored content for re-derivation",
      { provider: ctx.providers.storage.kind, sourceCid: sourceCid ?? null, manifestCid: manifestCid ?? null },
      "storage",
    );
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
    await emit(
      "re-derive",
      contentIntegrity && manifestIntegrity && graphIntegrity ? "success" : "warn",
      `re-derived hashes — content ${contentIntegrity ? "match" : "MISMATCH"}, ` +
        `manifest ${manifestIntegrity ? "match" : "MISMATCH"}, graph ${graphIntegrity ? "match" : "MISMATCH"}`,
      {
        canonicalHashMatch: contentIntegrity,
        manifestHashMatch: manifestIntegrity,
        graphHashMatch: graphIntegrity,
        expectedCanonicalHash: v.canonicalHash,
        actualCanonicalHash: actual.canonicalHash,
        expectedGraphHash: v.graphHash,
        actualGraphHash: actual.graphHash,
        changedFiles: changed.length,
        addedFiles: added.length,
        removedFiles: removed.length,
      },
      "canonical",
    );
  }

  const signatureIntegrity =
    !!v.signatureHex &&
    !!v.signaturePublicKeyHex &&
    verifySignature(enc.encode(v.commitmentHash), v.signatureHex, v.signaturePublicKeyHex);
  await emit(
    "signature",
    signatureIntegrity ? "success" : "error",
    `Ed25519 signature ${signatureIntegrity ? "verified" : "INVALID"}`,
    { ok: signatureIntegrity, publicKeyHex: v.signaturePublicKeyHex ?? null, commitmentHash: v.commitmentHash },
    "signer",
  );

  let anchorIntegrity = false;
  if (v.anchor && sourceCid) {
    const result = await ctx.providers.anchor.verify(
      { provider: v.anchor.provider, network: v.anchor.network, ref: v.anchor.ref },
      rebuildCommitment(v, sourceCid),
    );
    anchorIntegrity = result.ok && contentIntegrity;
    await emit(
      "anchor-read",
      anchorIntegrity ? "success" : "error",
      `on-chain commitment ${result.ok ? "matches" : "does NOT match"} re-derived content` +
        (result.ok && !contentIntegrity ? " (but content failed integrity)" : ""),
      {
        provider: v.anchor.provider,
        network: v.anchor.network,
        ref: v.anchor.ref,
        onChainMatch: result.ok,
        expectedHash: result.expectedHash,
        anchoredHash: result.anchoredHash,
        reason: result.reason ?? null,
      },
      "anchor",
    );
  } else {
    await emit("anchor-read", "warn", "no anchor on record for this version", {}, "anchor");
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

  await emit(
    "result",
    passed ? "success" : "error",
    passed ? "verification PASSED — all six checks" : "verification FAILED",
    {
      passed,
      contentIntegrity,
      manifestIntegrity,
      anchorIntegrity,
      signatureIntegrity,
      storageIntegrity,
      graphIntegrity,
      changedFiles: [...changed, ...added.map((p) => `+${p}`), ...removed.map((p) => `-${p}`)].join(",") || "none",
    },
    "okf",
  );

  return {
    ...checks,
    passed,
    runId,
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
  const runId = ctx.runId ?? randomUUID();
  const emit = makeEmitter(ctx.onEvent);

  const v = await loadVersion(ctx.prisma, { assetId });
  await emit(
    "load",
    "info",
    `comparing an uploaded archive (${archive.byteLength} bytes) against version ${v.versionNumber}`,
    { assetId: v.assetId, versionNumber: v.versionNumber, bytes: archive.byteLength },
    "okf",
  );
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

  await emit(
    "re-derive",
    contentIntegrity ? "success" : "error",
    `content ${contentIntegrity ? "matches" : "DIFFERS from"} the anchored version` +
      (d.changed.length || d.added.length || d.removed.length
        ? ` (${d.changed.length} changed, ${d.added.length} added, ${d.removed.length} removed)`
        : ""),
    {
      canonicalHashMatch: actual.canonicalHash === v.canonicalHash,
      manifestHashMatch: manifestIntegrity,
      graphHashMatch: graphIntegrity,
      expectedCanonicalHash: v.canonicalHash,
      actualCanonicalHash: actual.canonicalHash,
      changedFiles: d.changed.length,
      addedFiles: d.added.length,
      removedFiles: d.removed.length,
    },
    "canonical",
  );
  await emit(
    "signature",
    signatureIntegrity ? "success" : "error",
    `Ed25519 signature ${signatureIntegrity ? "verified" : "INVALID"}`,
    { ok: signatureIntegrity, publicKeyHex: v.signaturePublicKeyHex ?? null },
    "signer",
  );

  await ctx.prisma.verificationResult.create({
    data: {
      assetVersionId: v.id,
      requestedBy: ctx.requestedBy ?? null,
      ...checks,
      passed,
      changedFiles: [...d.changed, ...d.added.map((p) => `+${p}`), ...d.removed.map((p) => `-${p}`)],
    },
  });

  await emit(
    "result",
    passed ? "success" : "error",
    passed ? "tamper-check PASSED — upload matches the anchor" : "tamper-check FAILED — upload does not match the anchor",
    { passed, contentIntegrity, manifestIntegrity, anchorIntegrity, signatureIntegrity, storageIntegrity, graphIntegrity },
    "okf",
  );

  return {
    ...checks,
    passed,
    runId,
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
