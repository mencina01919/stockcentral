-- CreateTable
CREATE TABLE "TaxDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "saleId" TEXT,
    "orderId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "emitter" TEXT NOT NULL DEFAULT 'bsale',
    "externalId" TEXT,
    "folio" TEXT,
    "emittedAt" TIMESTAMP(3),
    "pdfUrl" TEXT,
    "xmlUrl" TEXT,
    "referenceDocumentId" TEXT,
    "snapshot" JSONB,
    "lastError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxDocumentLine" (
    "id" TEXT NOT NULL,
    "taxDocumentId" TEXT NOT NULL,
    "externalLineId" TEXT,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "netUnitValue" DECIMAL(12,2) NOT NULL,
    "taxIds" TEXT[],
    "discount" DECIMAL(5,2) NOT NULL DEFAULT 0,

    CONSTRAINT "TaxDocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BsaleClientCache" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rut" TEXT NOT NULL,
    "externalClientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BsaleClientCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxDocument_tenantId_status_idx" ON "TaxDocument"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TaxDocument_tenantId_saleId_idx" ON "TaxDocument"("tenantId", "saleId");

-- CreateIndex
CREATE INDEX "TaxDocument_tenantId_orderId_idx" ON "TaxDocument"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "TaxDocument_tenantId_emitter_externalId_idx" ON "TaxDocument"("tenantId", "emitter", "externalId");

-- CreateIndex
CREATE INDEX "TaxDocument_referenceDocumentId_idx" ON "TaxDocument"("referenceDocumentId");

-- CreateIndex
CREATE INDEX "TaxDocumentLine_taxDocumentId_idx" ON "TaxDocumentLine"("taxDocumentId");

-- CreateIndex
CREATE INDEX "BsaleClientCache_tenantId_idx" ON "BsaleClientCache"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BsaleClientCache_tenantId_rut_key" ON "BsaleClientCache"("tenantId", "rut");

-- AddForeignKey
ALTER TABLE "TaxDocument" ADD CONSTRAINT "TaxDocument_referenceDocumentId_fkey" FOREIGN KEY ("referenceDocumentId") REFERENCES "TaxDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxDocument" ADD CONSTRAINT "TaxDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxDocument" ADD CONSTRAINT "TaxDocument_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxDocument" ADD CONSTRAINT "TaxDocument_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxDocumentLine" ADD CONSTRAINT "TaxDocumentLine_taxDocumentId_fkey" FOREIGN KEY ("taxDocumentId") REFERENCES "TaxDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BsaleClientCache" ADD CONSTRAINT "BsaleClientCache_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
