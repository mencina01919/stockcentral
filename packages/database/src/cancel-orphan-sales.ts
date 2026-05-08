// Marca como `cancelled` las ventas huérfanas (sin orders) que están como
// pending. Estas son leftover del sync — no aportan información útil y
// están ensuciando el tab "Por facturar".

import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  const result = await prisma.sale.updateMany({
    where: {
      orders: { none: {} },
      status: 'pending',
      total: 0,
    },
    data: {
      status: 'cancelled',
      paymentStatus: 'cancelled',
      metadata: { cancelledReason: 'orphan_sale_cleanup' } as any,
    },
  })
  console.log(`Ventas huérfanas marcadas como cancelled: ${result.count}`)
  await prisma.$disconnect()
}
run()
