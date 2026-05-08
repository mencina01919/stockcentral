// Backfill placedAt: copia createdAt a placedAt para Orders y Sales que no
// tienen el campo (legacy pre-feature). Las nuevas órdenes que entren por
// sync tendrán placedAt real desde ahora.

import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()

  console.log('Backfilling Order.placedAt = createdAt where placedAt is null...')
  const orders = await prisma.$executeRaw`
    UPDATE "Order"
    SET "placedAt" = "createdAt"
    WHERE "placedAt" IS NULL
  `
  console.log(`  ${orders} órdenes actualizadas`)

  console.log('Backfilling Sale.placedAt = createdAt where placedAt is null...')
  const sales = await prisma.$executeRaw`
    UPDATE "Sale"
    SET "placedAt" = "createdAt"
    WHERE "placedAt" IS NULL
  `
  console.log(`  ${sales} ventas actualizadas`)

  await prisma.$disconnect()
}
run().catch((e) => { console.error(e); process.exit(1) })
