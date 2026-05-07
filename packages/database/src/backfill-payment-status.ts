// Backfill puntual: corrige paymentStatus de Order y Sale que quedaron como
// 'pending' siendo en realidad cancelaciones (mapeo previo no consideraba
// cancelled/canceled/failed como cancelled).
// Correr una sola vez tras desplegar el fix en sync.service.mapPaymentStatus.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function run() {
  const orders = await prisma.order.updateMany({
    where: {
      paymentStatus: 'pending',
      status: { in: ['cancelled', 'canceled', 'failed'] },
    },
    data: { paymentStatus: 'cancelled' },
  })
  const sales = await prisma.sale.updateMany({
    where: {
      paymentStatus: 'pending',
      status: { in: ['cancelled', 'canceled', 'failed'] },
    },
    data: { paymentStatus: 'cancelled' },
  })
  console.log(`Order rows updated: ${orders.count}`)
  console.log(`Sale rows updated:  ${sales.count}`)
}

run()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
