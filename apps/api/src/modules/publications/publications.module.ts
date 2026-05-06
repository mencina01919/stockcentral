import { Module } from '@nestjs/common'
import { PublicationsController } from './publications.controller'
import { PublicationsService } from './publications.service'
import { LiderSpecService } from './lider-spec.service'
import { MLMetadataService } from './ml-metadata.service'
import { FalabellaMetadataService } from './falabella-metadata.service'
import { AiAutofillService } from './ai-autofill.service'
import { ProductsModule } from '../products/products.module'

@Module({
  imports: [ProductsModule],
  controllers: [PublicationsController],
  providers: [PublicationsService, LiderSpecService, MLMetadataService, FalabellaMetadataService, AiAutofillService],
  exports: [PublicationsService, LiderSpecService, MLMetadataService, FalabellaMetadataService, AiAutofillService],
})
export class PublicationsModule {}
