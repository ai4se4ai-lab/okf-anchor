-- A mint job records the AssetVersion it resolved to. Re-submitting a bundle
-- whose canonical content is identical to an already-minted version
-- de-duplicates to that existing version (packages/pipeline/src/publish.ts) —
-- no new anchor. The 1:1 uniqueness on MintJob.assetVersionId made that legal
-- outcome crash the worker with P2002 ("Unique constraint failed on the fields:
-- (`assetVersionId`)"), so every repeat mint of unchanged content ended FAILED.
--
-- Drop the uniqueness; keep a plain index for lookups by version.
DROP INDEX "MintJob_assetVersionId_key";
CREATE INDEX "MintJob_assetVersionId_idx" ON "MintJob"("assetVersionId");
