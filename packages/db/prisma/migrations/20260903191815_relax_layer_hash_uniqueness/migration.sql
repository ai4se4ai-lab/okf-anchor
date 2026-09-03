-- DropIndex
DROP INDEX "CanonicalRepresentation_canonicalHash_key";

-- DropIndex
DROP INDEX "KnowledgeGraph_graphHash_key";

-- CreateIndex
CREATE INDEX "CanonicalRepresentation_canonicalHash_idx" ON "CanonicalRepresentation"("canonicalHash");

-- CreateIndex
CREATE INDEX "KnowledgeGraph_graphHash_idx" ON "KnowledgeGraph"("graphHash");
