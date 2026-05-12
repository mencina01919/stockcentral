import { Module } from '@nestjs/common'
import { OffersService } from './offers.service'
import { OffersController } from './offers.controller'
import { OffersScheduler } from './offers.scheduler'

@Module({
  controllers: [OffersController],
  providers: [OffersService, OffersScheduler],
  exports: [OffersService],
})
export class OffersModule {}
