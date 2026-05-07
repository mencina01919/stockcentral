import { Module } from '@nestjs/common'
import { TaxDocumentsController } from './tax-documents.controller'
import { TaxDocumentsService } from './tax-documents.service'

@Module({
  controllers: [TaxDocumentsController],
  providers: [TaxDocumentsService],
  exports: [TaxDocumentsService],
})
export class TaxDocumentsModule {}
