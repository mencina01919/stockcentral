import { Module } from '@nestjs/common'
import { InboundWebhooksController } from './inbound-webhooks.controller'
import { InboundWebhooksService } from './inbound-webhooks.service'
import { SyncModule } from '../sync/sync.module'

@Module({
  imports: [SyncModule],
  controllers: [InboundWebhooksController],
  providers: [InboundWebhooksService],
})
export class InboundWebhooksModule {}
