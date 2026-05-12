-- CreateTable
CREATE TABLE "MarketplaceOffer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "calculatedSalePrice" DECIMAL(12,2),
    "basePriceAtActivation" DECIMAL(12,2),
    "syncStatus" TEXT NOT NULL DEFAULT 'pending',
    "syncedAt" TIMESTAMP(3),
    "syncError" TEXT,
    "source" TEXT NOT NULL DEFAULT 'local',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketplaceOffer_tenantId_idx" ON "MarketplaceOffer"("tenantId");

-- CreateIndex
CREATE INDEX "MarketplaceOffer_productId_connectionId_idx" ON "MarketplaceOffer"("productId", "connectionId");

-- CreateIndex
CREATE INDEX "MarketplaceOffer_status_startDate_idx" ON "MarketplaceOffer"("status", "startDate");

-- CreateIndex
CREATE INDEX "MarketplaceOffer_status_endDate_idx" ON "MarketplaceOffer"("status", "endDate");

-- AddForeignKey
ALTER TABLE "MarketplaceOffer" ADD CONSTRAINT "MarketplaceOffer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceOffer" ADD CONSTRAINT "MarketplaceOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceOffer" ADD CONSTRAINT "MarketplaceOffer_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
