-- AlterTable
ALTER TABLE "Connection" ADD COLUMN     "catalogConfig" JSONB,
ADD COLUMN     "isCatalogSource" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastCatalogSyncAt" TIMESTAMP(3),
ADD COLUMN     "lastCatalogSyncStats" JSONB;

-- CreateIndex
CREATE INDEX "Connection_tenantId_isCatalogSource_idx" ON "Connection"("tenantId", "isCatalogSource");

-- Partial unique index: max 1 catalog source per tenant.
-- Prisma cannot express partial unique indexes, so it lives in the migration.
CREATE UNIQUE INDEX "Connection_one_catalog_source_per_tenant"
  ON "Connection"("tenantId")
  WHERE "isCatalogSource" = true;
