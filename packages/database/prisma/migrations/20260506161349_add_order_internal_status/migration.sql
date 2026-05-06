-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "internalStatus" TEXT NOT NULL DEFAULT 'new';

-- CreateIndex
CREATE INDEX "Order_internalStatus_idx" ON "Order"("internalStatus");
