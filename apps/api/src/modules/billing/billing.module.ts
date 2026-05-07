import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { BILLING_QUEUE } from './billing.constants'
import { BillingListener } from './billing.listener'
import { BillingProcessor } from './billing.processor'
import { TaxDocumentsModule } from '../tax-documents/tax-documents.module'

@Module({
  imports: [
    BullModule.registerQueue({
      name: BILLING_QUEUE,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    }),
    TaxDocumentsModule,
  ],
  providers: [BillingListener, BillingProcessor],
  exports: [BillingListener],
})
export class BillingModule {}
