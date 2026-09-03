-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'PUBLISHER', 'VIEWER');

-- CreateEnum
CREATE TYPE "BuildServerEnvironment" AS ENUM ('DEVELOPMENT', 'STAGING', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "AnchorState" AS ENUM ('PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "StorageObjectKind" AS ENUM ('SOURCE_ARCHIVE', 'CANONICAL_BUNDLE', 'MANIFEST', 'GRAPH_NQUADS');

-- CreateEnum
CREATE TYPE "MintJobState" AS ENUM ('RECEIVED', 'VALIDATING', 'INVALID', 'VALID', 'CANONICALIZING', 'HASHING', 'GRAPHING', 'UPLOADING', 'SIGNING', 'SUBMITTING', 'CONFIRMING', 'MINTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('HUMAN', 'BUILD_SERVER', 'SYSTEM');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuildServer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "environment" "BuildServerEnvironment" NOT NULL DEFAULT 'DEVELOPMENT',
    "organizationId" TEXT NOT NULL,
    "publicKeyHex" TEXT,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuildServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiCredential" (
    "id" TEXT NOT NULL,
    "buildServerId" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "okfVersion" TEXT NOT NULL DEFAULT '0.2',
    "publisherId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetVersion" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publisherId" TEXT NOT NULL,
    "canonicalHash" TEXT NOT NULL,
    "merkleRoot" TEXT NOT NULL,
    "graphHash" TEXT NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "commitmentHash" TEXT NOT NULL,
    "signatureHex" TEXT,
    "signaturePublicKeyHex" TEXT,
    "canonicalId" TEXT NOT NULL,
    "graphId" TEXT NOT NULL,

    CONSTRAINT "AssetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OkfSource" (
    "id" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "originalFilename" TEXT,
    "mediaType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "fileCount" INTEGER NOT NULL,
    "sourceCid" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OkfSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalRepresentation" (
    "id" TEXT NOT NULL,
    "canonicalHash" TEXT NOT NULL,
    "algo" TEXT NOT NULL DEFAULT 'sha-256',
    "deterministic" BOOLEAN NOT NULL DEFAULT true,
    "fileCount" INTEGER NOT NULL,
    "merkleRoot" TEXT NOT NULL,
    "canonicalCid" TEXT NOT NULL,
    "producedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanonicalRepresentation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeGraph" (
    "id" TEXT NOT NULL,
    "graphHash" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'application/n-quads',
    "derivedFromCanonicalHash" TEXT NOT NULL,
    "tripleCount" INTEGER NOT NULL,
    "graphCid" TEXT NOT NULL,
    "producedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeGraph_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageObject" (
    "id" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "kind" "StorageObjectKind" NOT NULL,
    "cid" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Anchor" (
    "id" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "committedHash" TEXT NOT NULL,
    "state" "AnchorState" NOT NULL DEFAULT 'PENDING',
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "blockNumber" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Anchor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationHistory" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "publisherId" TEXT NOT NULL,
    "canonicalHash" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MintJob" (
    "id" TEXT NOT NULL,
    "buildServerId" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "assetSlug" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "state" "MintJobState" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sourceCid" TEXT NOT NULL,
    "error" TEXT,
    "assetVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MintJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationResult" (
    "id" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "requestedBy" TEXT,
    "contentIntegrity" BOOLEAN NOT NULL,
    "manifestIntegrity" BOOLEAN NOT NULL,
    "anchorIntegrity" BOOLEAN NOT NULL,
    "signatureIntegrity" BOOLEAN NOT NULL,
    "storageIntegrity" BOOLEAN NOT NULL,
    "graphIntegrity" BOOLEAN NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "changedFiles" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "ip" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BuildServer_publisherId_key" ON "BuildServer"("publisherId");

-- CreateIndex
CREATE INDEX "BuildServer_organizationId_idx" ON "BuildServer"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiCredential_tokenPrefix_key" ON "ApiCredential"("tokenPrefix");

-- CreateIndex
CREATE INDEX "ApiCredential_buildServerId_idx" ON "ApiCredential"("buildServerId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_currentVersionId_key" ON "Asset"("currentVersionId");

-- CreateIndex
CREATE INDEX "Asset_organizationId_idx" ON "Asset"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_publisherId_slug_key" ON "Asset"("publisherId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "AssetVersion_canonicalId_key" ON "AssetVersion"("canonicalId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetVersion_graphId_key" ON "AssetVersion"("graphId");

-- CreateIndex
CREATE INDEX "AssetVersion_publisherId_idx" ON "AssetVersion"("publisherId");

-- CreateIndex
CREATE INDEX "AssetVersion_canonicalHash_idx" ON "AssetVersion"("canonicalHash");

-- CreateIndex
CREATE INDEX "AssetVersion_commitmentHash_idx" ON "AssetVersion"("commitmentHash");

-- CreateIndex
CREATE UNIQUE INDEX "AssetVersion_assetId_canonicalHash_key" ON "AssetVersion"("assetId", "canonicalHash");

-- CreateIndex
CREATE UNIQUE INDEX "AssetVersion_assetId_versionNumber_key" ON "AssetVersion"("assetId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "OkfSource_assetVersionId_key" ON "OkfSource"("assetVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalRepresentation_canonicalHash_key" ON "CanonicalRepresentation"("canonicalHash");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeGraph_graphHash_key" ON "KnowledgeGraph"("graphHash");

-- CreateIndex
CREATE INDEX "KnowledgeGraph_derivedFromCanonicalHash_idx" ON "KnowledgeGraph"("derivedFromCanonicalHash");

-- CreateIndex
CREATE INDEX "StorageObject_cid_idx" ON "StorageObject"("cid");

-- CreateIndex
CREATE UNIQUE INDEX "StorageObject_assetVersionId_kind_key" ON "StorageObject"("assetVersionId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Anchor_assetVersionId_key" ON "Anchor"("assetVersionId");

-- CreateIndex
CREATE INDEX "Anchor_committedHash_idx" ON "Anchor"("committedHash");

-- CreateIndex
CREATE INDEX "PublicationHistory_assetId_idx" ON "PublicationHistory"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "MintJob_idempotencyKey_key" ON "MintJob"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MintJob_assetVersionId_key" ON "MintJob"("assetVersionId");

-- CreateIndex
CREATE INDEX "MintJob_buildServerId_idx" ON "MintJob"("buildServerId");

-- CreateIndex
CREATE INDEX "MintJob_publisherId_assetSlug_idx" ON "MintJob"("publisherId", "assetSlug");

-- CreateIndex
CREATE INDEX "MintJob_state_idx" ON "MintJob"("state");

-- CreateIndex
CREATE INDEX "VerificationResult_assetVersionId_idx" ON "VerificationResult"("assetVersionId");

-- CreateIndex
CREATE INDEX "AuditEvent_subjectType_subjectId_idx" ON "AuditEvent"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildServer" ADD CONSTRAINT "BuildServer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_buildServerId_fkey" FOREIGN KEY ("buildServerId") REFERENCES "BuildServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "AssetVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetVersion" ADD CONSTRAINT "AssetVersion_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetVersion" ADD CONSTRAINT "AssetVersion_canonicalId_fkey" FOREIGN KEY ("canonicalId") REFERENCES "CanonicalRepresentation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetVersion" ADD CONSTRAINT "AssetVersion_graphId_fkey" FOREIGN KEY ("graphId") REFERENCES "KnowledgeGraph"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OkfSource" ADD CONSTRAINT "OkfSource_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageObject" ADD CONSTRAINT "StorageObject_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Anchor" ADD CONSTRAINT "Anchor_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationHistory" ADD CONSTRAINT "PublicationHistory_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationHistory" ADD CONSTRAINT "PublicationHistory_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MintJob" ADD CONSTRAINT "MintJob_buildServerId_fkey" FOREIGN KEY ("buildServerId") REFERENCES "BuildServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MintJob" ADD CONSTRAINT "MintJob_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationResult" ADD CONSTRAINT "VerificationResult_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

