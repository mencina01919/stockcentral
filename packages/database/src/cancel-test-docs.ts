// Marca como `cancelled` en local los TaxDocuments emitidos en pruebas previas
// para poder reemitirlos. Los documentos en Bsale quedan como están — solo
// cambia el estado en nuestra DB para que no bloquee la idempotencia.

import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  const targets = process.argv.slice(2)
  if (targets.length === 0) {
    console.log('Uso: ts-node cancel-test-docs.ts SALE-XXXX [SALE-YYYY ...]')
    process.exit(1)
  }
  for (const num of targets) {
    const sale = await prisma.sale.findFirst({ where: { saleNumber: num } })
    if (!sale) {
      console.log(`${num}: not found`)
      continue
    }
    const r = await prisma.taxDocument.updateMany({
      where: { saleId: sale.id, status: { in: ['issued', 'pending'] } },
      data: { status: 'cancelled', metadata: { cancelledLocallyForRetest: true } as any },
    })
    console.log(`${num} (${sale.id}): cancelled ${r.count} doc(s)`)
  }
  await prisma.$disconnect()
}
run()
