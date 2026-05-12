import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../prisma/prisma.service'
import { OffersService } from './offers.service'

// Orquesta el ciclo de vida de las ofertas marketplace:
//   - scheduled → active: cuando startDate <= now() y endDate > now()
//   - active → expired: cuando endDate < now()
//   - drift detection en active: si el calculatedPrice base cambió, re-syncronizar
//
// Corre cada 15 minutos. Si una transición/sync falla, queda con
// syncStatus=failed y un reintento se dará en el siguiente tick.
@Injectable()
export class OffersScheduler {
  private readonly logger = new Logger(OffersScheduler.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly offers: OffersService,
  ) {}

  @Cron('0 */15 * * * *')
  async tick() {
    const now = new Date()

    // 1) Activar ofertas scheduled cuyo startDate ya pasó.
    const toActivate = await this.prisma.marketplaceOffer.findMany({
      where: {
        status: 'scheduled',
        startDate: { lte: now },
        endDate: { gt: now },
      },
      select: { id: true },
      take: 50,
    })
    for (const o of toActivate) {
      try {
        await this.offers.activateAndPush(o.id)
      } catch (err: any) {
        this.logger.error(`Activar oferta ${o.id} falló: ${err?.message}`)
      }
    }

    // 2) Expirar ofertas active cuyo endDate ya pasó.
    const toExpire = await this.prisma.marketplaceOffer.findMany({
      where: {
        status: 'active',
        endDate: { lt: now },
      },
      select: { id: true },
      take: 50,
    })
    for (const o of toExpire) {
      try {
        await this.offers.expireAndClear(o.id)
      } catch (err: any) {
        this.logger.error(`Expirar oferta ${o.id} falló: ${err?.message}`)
      }
    }

    // 3) Drift: re-sincronizar ofertas active cuyo precio base cambió, o
    //    cuyo último sync falló. Limitamos para no saturar la cola.
    const toResync = await this.prisma.marketplaceOffer.findMany({
      where: {
        status: 'active',
        endDate: { gt: now },
        OR: [
          { syncStatus: 'pending' },
          { syncStatus: 'failed' },
        ],
      },
      select: { id: true },
      take: 30,
    })
    for (const o of toResync) {
      try {
        await this.offers.resyncActive(o.id)
      } catch (err: any) {
        this.logger.error(`Resync oferta ${o.id} falló: ${err?.message}`)
      }
    }

    if (toActivate.length || toExpire.length || toResync.length) {
      this.logger.log(
        `Offers tick: activated=${toActivate.length} expired=${toExpire.length} resynced=${toResync.length}`,
      )
    }
  }
}
