-- CreateTable
CREATE TABLE "MarketplaceWebhookEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT,
    "topic" TEXT,
    "externalResourceId" TEXT,
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'received',
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketplaceWebhookEvent_tenantId_provider_idx" ON "MarketplaceWebhookEvent"("tenantId", "provider");

-- CreateIndex
CREATE INDEX "MarketplaceWebhookEvent_status_idx" ON "MarketplaceWebhookEvent"("status");

-- CreateIndex
CREATE INDEX "MarketplaceWebhookEvent_createdAt_idx" ON "MarketplaceWebhookEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceWebhookEvent_provider_externalEventId_key" ON "MarketplaceWebhookEvent"("provider", "externalEventId");

-- AddForeignKey
ALTER TABLE "MarketplaceWebhookEvent" ADD CONSTRAINT "MarketplaceWebhookEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
