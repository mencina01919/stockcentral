-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "barcode" TEXT;

-- CreateIndex
CREATE INDEX "Product_tenantId_barcode_idx" ON "Product"("tenantId", "barcode");
