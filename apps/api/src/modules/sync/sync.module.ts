import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { SyncService } from './sync.service'
import { SyncController } from './sync.controller'
import { SyncProcessor } from './sync.processor'
import { SYNC_QUEUE } from './sync.constants'

@Module({
  imports: [
    BullModule.registerQueue({
      name: SYNC_QUEUE,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    }),
  ],
  controllers: [SyncController],
  providers: [SyncService, SyncProcessor],
  exports: [SyncService],
})
export class SyncModule {}
