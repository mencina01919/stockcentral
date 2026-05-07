// Marca como `cancelled` TODOS los TaxDocuments (failed, issued, pending) de
// una venta para empezar limpio en pruebas. NO toca Bsale.

import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  for (const num of process.argv.slice(2)) {
    const sale = await prisma.sale.findFirst({ where: { saleNumber: num } })
    if (!sale) { console.log(`${num}: not found`); continue }
    const r = await prisma.taxDocument.updateMany({
      where: { saleId: sale.id, status: { not: 'cancelled' } },
      data: { status: 'cancelled', metadata: { cleanedForRetest: true } as any },
    })
    console.log(`${num}: cancelled ${r.count} doc(s)`)
  }
  await prisma.$disconnect()
}
run()
