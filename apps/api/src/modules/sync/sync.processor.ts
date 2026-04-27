import { Processor, Process, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { Job } from 'bull'
import { SYNC_QUEUE, SyncJobType } from './sync.constants'
import { SyncService } from './sync.service'

@Processor(SYNC_QUEUE)
export class SyncProcessor {
  private readonly logger = new Logger(SyncProcessor.name)

  constructor(private readonly syncService: SyncService) {}

  @Process(SyncJobType.SYNC_PRODUCTS_OUTBOUND)
  async handleProductsOutbound(job: Job<{ tenantId: string; connectionId: string; productIds?: string[] }>) {
    this.logger.log(`Processing products outbound sync for connection ${job.data.connectionId}`)
    await this.syncService.syncProductsOutbound(job.data.tenantId, job.data.connectionId, job.data.productIds)
  }

  @Process(SyncJobType.SYNC_PRODUCTS_INBOUND)
  async handleProductsInbound(job: Job<{ tenantId: string; connectionId: string }>) {
    this.logger.log(`Processing products inbound sync for connection ${job.data.connectionId}`)
    await this.syncService.syncProductsInbound(job.data.tenantId, job.data.connectionId)
  }

  @Process(SyncJobType.SYNC_ORDERS_INBOUND)
  async handleOrdersInbound(job: Job<{ tenantId: string; connectionId: string; since?: string }>) {
    this.logger.log(`Processing orders inbound sync for connection ${job.data.connectionId}`)
    const since = job.data.since ? new Date(job.data.since) : undefined
    await this.syncService.syncOrdersInbound(job.data.tenantId, job.data.connectionId, since)
  }

  @Process(SyncJobType.SYNC_STOCK)
  async handleStockSync(job: Job<{ tenantId: string; connectionId: string; productId: string; externalId: string; stock: number }>) {
    this.logger.log(`Processing stock sync for product ${job.data.productId}`)
    await this.syncService.syncSingleStock(
      job.data.tenantId,
      job.data.connectionId,
      job.data.productId,
      job.data.externalId,
      job.data.stock,
    )
  }

  @Process(SyncJobType.TEST_CONNECTION)
  async handleTestConnection(job: Job<{ tenantId: string; connectionId: string }>) {
    return this.syncService.testConnection(job.data.tenantId, job.data.connectionId)
  }

  @Process(SyncJobType.REFRESH_OAUTH_TOKEN)
  async handleRefreshToken(job: Job<{ tenantId: string; connectionId: string }>) {
    await this.syncService.refreshOAuthToken(job.data.tenantId, job.data.connectionId)
  }

  @OnQueueFailed()
  onFailed(job: Job, err: Error) {
    this.logger.error(`Job ${job.id} (${job.name}) failed: ${err.message}`, err.stack)
  }

  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.debug(`Job ${job.id} (${job.name}) completed`)
  }
}
