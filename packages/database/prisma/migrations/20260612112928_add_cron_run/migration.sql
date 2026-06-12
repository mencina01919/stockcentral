-- CreateTable
CREATE TABLE "CronRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "connectionId" TEXT,
    "cron" TEXT NOT NULL,
    "provider" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'running',
    "stats" JSONB,
    "errorMessage" TEXT,

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CronRun_cron_startedAt_idx" ON "CronRun"("cron", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "CronRun_tenantId_startedAt_idx" ON "CronRun"("tenantId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "CronRun_connectionId_startedAt_idx" ON "CronRun"("connectionId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "CronRun_status_idx" ON "CronRun"("status");

-- AddForeignKey
ALTER TABLE "CronRun" ADD CONSTRAINT "CronRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
