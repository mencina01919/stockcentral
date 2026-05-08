-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "placedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "placedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Order_placedAt_idx" ON "Order"("placedAt");

-- CreateIndex
CREATE INDEX "Sale_placedAt_idx" ON "Sale"("placedAt");
