/**
 * Publish orchestration: archive → deterministic OKF pipeline → content-addressed
 * storage → publisher signature → blockchain anchor → one transactional metadata
 * write. Re-publishing identical content is idempotent and never creates a new
 * anchor (CLAUDE.md §3, skill: okf-prisma-postgres).
 */
import {
  commitmentHash,
  processBundle,
  type Commitment,
  type ProcessedBundle,
} from "@okf-anchor/okf-core";
import { assetIdToBytes32, type Providers } from "@okf-anchor/providers";
import type { PrismaClient, Prisma } from "@okf-anchor/db";
import { detectMediaType, extractArchive } from "./archive.js";
import { makeEmitter, type PipelineEventSink } from "./events.js";

const enc = new TextEncoder();

export interface PublishInput {
  readonly archive: Uint8Array;
  readonly originalFilename?: string;
  readonly buildServerId: string;
  readonly publisherId: string;
  readonly assetSlug: string;
  readonly name: string;
  readonly description?: string;
}

export type PublishStage =
  | "VALIDATING"
  | "VALID"
  | "CANONICALIZING"
  | "HASHING"
  | "GRAPHING"
  | "UPLOADING"
  | "SIGNING"
  | "SUBMITTING"
  | "CONFIRMING";

export interface PublishContext {
  readonly providers: Providers;
  readonly prisma: PrismaClient;
  readonly publicBaseUrl?: string | undefined;
  /** Optional progress hook for the async worker to advance the MintJob state. */
  readonly onStage?: ((stage: PublishStage) => Promise<void> | void) | undefined;
  /** Optional structured event stream for the live activity console (best-effort). */
  readonly onEvent?: PipelineEventSink | undefined;
}

export interface PublishResult {
  readonly deduplicated: boolean;
  readonly assetId: string;
  readonly assetSlug: string;
  readonly assetVersionId: string;
  readonly versionNumber: number;
  readonly okfVersion: string;
  readonly canonicalHash: string;
  readonly merkleRoot: string;
  readonly graphHash: string;
  readonly manifestHash: string;
  readonly commitmentHash: string;
  readonly storageCids: {
    readonly source: string;
    readonly canonical: string;
    readonly graph: string;
    readonly manifest: string;
  };
  readonly anchor: { readonly provider: string; readonly network: string; readonly ref: string; readonly state: string };
  readonly signature: { readonly publicKeyHex: string } | null;
  readonly publishedAt: string;
  readonly verificationUrl: string | null;
  readonly validation: ProcessedBundle["validation"];
}

function verificationUrl(base: string | undefined, assetId: string): string | null {
  return base ? `${base.replace(/\/$/, "")}/verify/${assetId}` : null;
}

export async function publishBundle(input: PublishInput, ctx: PublishContext): Promise<PublishResult> {
  const { providers, prisma } = ctx;

  const server = await prisma.buildServer.findUniqueOrThrow({
    where: { id: input.buildServerId },
    select: { id: true, organizationId: true, disabledAt: true },
  });
  if (server.disabledAt) throw new Error("build server is disabled");

  const stage = async (s: PublishStage): Promise<void> => {
    await ctx.onStage?.(s);
  };
  const emit = makeEmitter(ctx.onEvent);

  await stage("VALIDATING");
  const mediaType = detectMediaType(input.originalFilename, input.archive);
  await emit(
    "validate",
    "info",
    `received ${input.archive.byteLength} byte ${mediaType} archive`,
    { mediaType, bytes: input.archive.byteLength },
    "okf",
  );
  const entries = extractArchive(input.archive, mediaType);
  await emit("validate", "info", `archive expanded to ${entries.length} file(s)`, { files: entries.length }, "okf");
  await stage("CANONICALIZING");
  const processed = await processBundle(entries, {
    createdAt: new Date().toISOString(),
  });
  await stage("GRAPHING");

  const canonicalHash = processed.canonical.canonicalHash;
  await emit(
    "canonicalize",
    "success",
    `canonicalized ${processed.canonical.files.length} file(s) → ${canonicalHash.slice(0, 16)}…`,
    {
      fileCount: processed.canonical.files.length,
      okfVersion: processed.canonical.okfVersion,
      conformant: processed.validation.conformant,
      infoFindings: processed.validation.info.length,
      canonicalHash,
      merkleRoot: processed.canonical.merkleRoot,
      canonicalBytes: enc.encode(processed.canonical.canonicalForm).byteLength,
    },
    "canonical",
  );
  await emit(
    "graph",
    "success",
    `derived ${processed.graph.quads.length} RDF triple(s)`,
    { tripleCount: processed.graph.quads.length, graphHash: processed.graph.graphHash },
    "graph",
  );

  const asset = await prisma.asset.upsert({
    where: { publisherId_slug: { publisherId: input.publisherId, slug: input.assetSlug } },
    create: {
      slug: input.assetSlug,
      name: input.name,
      description: input.description ?? null,
      publisherId: input.publisherId,
      organizationId: server.organizationId,
      okfVersion: processed.canonical.okfVersion,
    },
    update: {},
    select: { id: true, slug: true },
  });

  // Idempotency: identical canonical content resolves to the existing version.
  const existing = await prisma.assetVersion.findUnique({
    where: { assetId_canonicalHash: { assetId: asset.id, canonicalHash } },
    include: { anchor: true, storageObjects: true },
  });
  if (existing) {
    await emit(
      "dedup",
      "success",
      `identical content already published as version ${existing.versionNumber} — no new anchor`,
      { deduplicated: true, assetId: asset.id, versionNumber: existing.versionNumber, canonicalHash },
      "canonical",
    );
    return toResult(existing, asset, processed, true, ctx.publicBaseUrl);
  }

  // Store the four layer artifacts.
  await stage("UPLOADING");
  await emit(
    "store",
    "info",
    `storing four layer artifacts via ${providers.storage.kind}`,
    { provider: providers.storage.kind },
    "storage",
  );
  const manifestJson = JSON.stringify(processed.manifest.manifest);
  const canonicalBytes = enc.encode(processed.canonical.canonicalForm).byteLength;
  const graphBytes = enc.encode(processed.graph.nquads).byteLength;
  const manifestBytes = enc.encode(manifestJson).byteLength;
  const [sourceCid, canonicalCid, graphCid, manifestCid] = await Promise.all([
    providers.storage.put(input.archive),
    providers.storage.put(enc.encode(processed.canonical.canonicalForm)),
    providers.storage.put(enc.encode(processed.graph.nquads)),
    providers.storage.put(enc.encode(manifestJson)),
  ]);
  await emit("store", "info", `source archive → ${sourceCid}`, { kind: "SOURCE_ARCHIVE", cid: sourceCid, bytes: input.archive.byteLength, provider: providers.storage.kind }, "storage");
  await emit("store", "info", `canonical bundle → ${canonicalCid}`, { kind: "CANONICAL_BUNDLE", cid: canonicalCid, bytes: canonicalBytes, provider: providers.storage.kind }, "storage");
  await emit("store", "info", `graph n-quads → ${graphCid}`, { kind: "GRAPH_NQUADS", cid: graphCid, bytes: graphBytes, provider: providers.storage.kind }, "storage");
  await emit("store", "info", `manifest → ${manifestCid}`, { kind: "MANIFEST", cid: manifestCid, bytes: manifestBytes, provider: providers.storage.kind }, "storage");
  await Promise.all(
    [sourceCid, canonicalCid, graphCid, manifestCid].map((c) => providers.storage.pin(c)),
  );
  await emit("store", "success", `pinned 4 objects on ${providers.storage.kind}`, { pinned: 4, provider: providers.storage.kind }, "storage");

  const agg = await prisma.assetVersion.aggregate({
    where: { assetId: asset.id },
    _max: { versionNumber: true },
  });
  const versionNumber = (agg._max.versionNumber ?? 0) + 1;

  const commitment: Commitment = {
    assetId: asset.id,
    versionNumber,
    okfVersion: processed.canonical.okfVersion,
    canonicalHash,
    merkleRoot: processed.canonical.merkleRoot,
    graphHash: processed.graph.graphHash,
    manifestHash: processed.manifest.manifestHash,
    storageCid: sourceCid,
    publisher: input.publisherId,
  };
  const cHash = commitmentHash(commitment);
  await stage("SIGNING");
  await emit("sign", "info", "signing commitment (Ed25519)", { algo: "ed25519", commitmentHash: cHash }, "signer");
  const signature = await providers.signer.sign(enc.encode(cHash));
  await emit(
    "sign",
    "success",
    `commitment signed by ${signature.publicKeyHex.slice(0, 16)}…`,
    { algo: "ed25519", publicKeyHex: signature.publicKeyHex },
    "signer",
  );
  await stage("SUBMITTING");
  await emit(
    "anchor-submit",
    "info",
    `submitting anchor via ${providers.anchor.kind} (${providers.anchor.network})`,
    {
      provider: providers.anchor.kind,
      network: providers.anchor.network,
      assetIdHash: assetIdToBytes32(asset.id),
      version: versionNumber,
      commitmentHash: cHash,
      bundleCid: sourceCid,
    },
    "anchor",
  );
  const anchorRef = await providers.anchor.anchor(commitment);
  await emit(
    "anchor-submit",
    "success",
    `anchor accepted — ref ${anchorRef.ref}`,
    { provider: anchorRef.provider, network: anchorRef.network, ref: anchorRef.ref },
    "anchor",
  );
  await stage("CONFIRMING");
  const anchorStatus = await providers.anchor.status(anchorRef);
  await emit(
    "anchor-confirm",
    anchorStatus.state === "failed" ? "error" : "success",
    `anchor ${anchorStatus.state} — ${anchorStatus.confirmations} confirmation(s)` +
      (anchorStatus.blockNumber != null ? ` in block ${anchorStatus.blockNumber}` : ""),
    {
      state: anchorStatus.state,
      confirmations: anchorStatus.confirmations,
      blockNumber: anchorStatus.blockNumber ?? null,
      committedHash: anchorStatus.committedHash,
      gasUsed: anchorStatus.gasUsed ?? null,
      effectiveGasPriceWei: anchorStatus.effectiveGasPriceWei ?? null,
      transactionHash: anchorStatus.transactionHash ?? anchorRef.ref,
    },
    "anchor",
  );

  let created;
  try {
    created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const canonical = await tx.canonicalRepresentation.create({
        data: {
          canonicalHash,
          algo: "sha-256",
          deterministic: true,
          fileCount: processed.canonical.files.length,
          merkleRoot: processed.canonical.merkleRoot,
          canonicalCid,
        },
      });
      const graph = await tx.knowledgeGraph.create({
        data: {
          graphHash: processed.graph.graphHash,
          format: "application/n-quads",
          derivedFromCanonicalHash: canonicalHash,
          tripleCount: processed.graph.quads.length,
          graphCid,
        },
      });
      const version = await tx.assetVersion.create({
        data: {
          assetId: asset.id,
          versionNumber,
          publisherId: input.publisherId,
          canonicalHash,
          merkleRoot: processed.canonical.merkleRoot,
          graphHash: processed.graph.graphHash,
          manifestHash: processed.manifest.manifestHash,
          commitmentHash: cHash,
          signatureHex: signature.signatureHex,
          signaturePublicKeyHex: signature.publicKeyHex,
          canonicalId: canonical.id,
          graphId: graph.id,
          source: {
            create: {
              originalFilename: input.originalFilename ?? null,
              mediaType,
              sizeBytes: input.archive.byteLength,
              fileCount: entries.length,
              sourceCid,
            },
          },
          storageObjects: {
            create: [
              { kind: "SOURCE_ARCHIVE", cid: sourceCid, provider: providers.storage.kind, sizeBytes: input.archive.byteLength, pinned: true },
              { kind: "CANONICAL_BUNDLE", cid: canonicalCid, provider: providers.storage.kind, sizeBytes: enc.encode(processed.canonical.canonicalForm).byteLength, pinned: true },
              { kind: "GRAPH_NQUADS", cid: graphCid, provider: providers.storage.kind, sizeBytes: enc.encode(processed.graph.nquads).byteLength, pinned: true },
              { kind: "MANIFEST", cid: manifestCid, provider: providers.storage.kind, sizeBytes: enc.encode(manifestJson).byteLength, pinned: true },
            ],
          },
          anchor: {
            create: {
              provider: anchorRef.provider,
              network: anchorRef.network,
              ref: anchorRef.ref,
              committedHash: cHash,
              state: anchorStatus.state.toUpperCase() as "PENDING" | "SUBMITTED" | "CONFIRMED" | "FAILED",
              confirmations: anchorStatus.confirmations,
              blockNumber: anchorStatus.blockNumber ?? null,
              confirmedAt: anchorStatus.state === "confirmed" ? new Date() : null,
            },
          },
        },
        include: { anchor: true, storageObjects: true },
      });

      await tx.publicationHistory.create({
        data: {
          assetId: asset.id,
          assetVersionId: version.id,
          versionNumber,
          publisherId: input.publisherId,
          canonicalHash,
        },
      });
      await tx.asset.update({
        where: { id: asset.id },
        data: {
          currentVersionId: version.id,
          name: input.name,
          description: input.description ?? null,
        },
      });
      return version;
    });
  } catch (err) {
    // Lost a race on the (assetId, canonicalHash) unique constraint.
    if (isUniqueViolation(err)) {
      const winner = await prisma.assetVersion.findUniqueOrThrow({
        where: { assetId_canonicalHash: { assetId: asset.id, canonicalHash } },
        include: { anchor: true, storageObjects: true },
      });
      await emit(
        "dedup",
        "success",
        `concurrent publish won the race — resolved to version ${winner.versionNumber}`,
        { deduplicated: true, assetId: asset.id, versionNumber: winner.versionNumber, canonicalHash },
        "canonical",
      );
      return toResult(winner, asset, processed, true, ctx.publicBaseUrl);
    }
    throw err;
  }

  await emit(
    "persist",
    "success",
    `version ${created.versionNumber} committed to the metadata store`,
    { assetId: asset.id, assetVersionId: created.id, versionNumber: created.versionNumber, deduplicated: false },
    "okf",
  );

  await providers.graph.upsert(created.id, processed.graph.nquads);
  await emit(
    "graph",
    "success",
    "knowledge graph upserted to the triplestore",
    { assetVersionId: created.id, tripleCount: processed.graph.quads.length },
    "graph",
  );

  return toResult(created, asset, processed, false, ctx.publicBaseUrl);
}

interface VersionRow {
  id: string;
  versionNumber: number;
  canonicalHash: string;
  merkleRoot: string;
  graphHash: string;
  manifestHash: string;
  commitmentHash: string;
  signaturePublicKeyHex: string | null;
  publishedAt: Date;
  anchor: { provider: string; network: string; ref: string; state: string } | null;
  storageObjects: Array<{ kind: string; cid: string }>;
}

function toResult(
  version: VersionRow,
  asset: { id: string; slug: string },
  processed: ProcessedBundle,
  deduplicated: boolean,
  publicBaseUrl: string | undefined,
): PublishResult {
  const cid = (kind: string): string =>
    version.storageObjects.find((s) => s.kind === kind)?.cid ?? "";
  return {
    deduplicated,
    assetId: asset.id,
    assetSlug: asset.slug,
    assetVersionId: version.id,
    versionNumber: version.versionNumber,
    okfVersion: processed.canonical.okfVersion,
    canonicalHash: version.canonicalHash,
    merkleRoot: version.merkleRoot,
    graphHash: version.graphHash,
    manifestHash: version.manifestHash,
    commitmentHash: version.commitmentHash,
    storageCids: {
      source: cid("SOURCE_ARCHIVE"),
      canonical: cid("CANONICAL_BUNDLE"),
      graph: cid("GRAPH_NQUADS"),
      manifest: cid("MANIFEST"),
    },
    anchor: {
      provider: version.anchor?.provider ?? "unknown",
      network: version.anchor?.network ?? "unknown",
      ref: version.anchor?.ref ?? "",
      state: (version.anchor?.state ?? "PENDING").toString(),
    },
    signature: version.signaturePublicKeyHex ? { publicKeyHex: version.signaturePublicKeyHex } : null,
    publishedAt: version.publishedAt.toISOString(),
    verificationUrl: verificationUrl(publicBaseUrl, asset.id),
    validation: processed.validation,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}
