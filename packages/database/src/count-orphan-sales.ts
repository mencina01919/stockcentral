// Cuenta ventas huérfanas: Sales que no tienen ninguna Order asociada.

import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  const orphans = await prisma.sale.findMany({
    where: { orders: { none: {} } },
    select: {
      id: true,
      saleNumber: true,
      status: true,
      paymentStatus: true,
      total: true,
      source: true,
      createdAt: true,
    },
  })
  console.log(`Total ventas huérfanas (sin orders): ${orphans.length}`)
  console.log()
  const byStatus: Record<string, number> = {}
  const byPayment: Record<string, number> = {}
  for (const s of orphans) {
    byStatus[s.status] = (byStatus[s.status] || 0) + 1
    byPayment[s.paymentStatus] = (byPayment[s.paymentStatus] || 0) + 1
  }
  console.log('Por sale.status:', byStatus)
  console.log('Por sale.paymentStatus:', byPayment)
  console.log()
  console.log('Total = 0:', orphans.filter((s) => Number(s.total) === 0).length)
  console.log('Total > 0:', orphans.filter((s) => Number(s.total) > 0).length)
  await prisma.$disconnect()
}
run()
