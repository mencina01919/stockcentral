import { Module } from '@nestjs/common'
import { PublicationsController } from './publications.controller'
import { PublicationsService } from './publications.service'
import { LiderSpecService } from './lider-spec.service'
import { MLMetadataService } from './ml-metadata.service'
import { FalabellaMetadataService } from './falabella-metadata.service'

@Module({
  controllers: [PublicationsController],
  providers: [PublicationsService, LiderSpecService, MLMetadataService, FalabellaMetadataService],
  exports: [PublicationsService, LiderSpecService, MLMetadataService, FalabellaMetadataService],
})
export class PublicationsModule {}
