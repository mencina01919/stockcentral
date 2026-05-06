import { Module } from '@nestjs/common'
import { CatalogSourceService } from './catalog-source.service'
import { CatalogSourceController } from './catalog-source.controller'

@Module({
  controllers: [CatalogSourceController],
  providers: [CatalogSourceService],
  exports: [CatalogSourceService],
})
export class CatalogSourceModule {}
