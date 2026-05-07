import { Module, forwardRef } from '@nestjs/common'
import { TaxDocumentsController } from './tax-documents.controller'
import { TaxDocumentsService } from './tax-documents.service'
import { BillingModule } from '../billing/billing.module'

@Module({
  imports: [forwardRef(() => BillingModule)],
  controllers: [TaxDocumentsController],
  providers: [TaxDocumentsService],
  exports: [TaxDocumentsService],
})
export class TaxDocumentsModule {}
