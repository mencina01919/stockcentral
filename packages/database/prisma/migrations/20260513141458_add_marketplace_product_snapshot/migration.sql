-- CreateTable
CREATE TABLE "MarketplaceProductSnapshot" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalSku" TEXT,
    "title" TEXT,
    "price" DECIMAL(12,2),
    "stock" INTEGER,
    "status" TEXT,
    "images" JSONB,
    "url" TEXT,
    "categoryId" TEXT,
    "rawData" JSONB,
    "lastFetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceProductSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketplaceProductSnapshot_connectionId_lastFetchedAt_idx" ON "MarketplaceProductSnapshot"("connectionId", "lastFetchedAt");

-- CreateIndex
CREATE INDEX "MarketplaceProductSnapshot_connectionId_status_idx" ON "MarketplaceProductSnapshot"("connectionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceProductSnapshot_connectionId_externalId_key" ON "MarketplaceProductSnapshot"("connectionId", "externalId");

-- AddForeignKey
ALTER TABLE "MarketplaceProductSnapshot" ADD CONSTRAINT "MarketplaceProductSnapshot_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
