import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  const target = process.argv[2] || 'SALE-004168'
  const sale = await prisma.sale.findFirst({ where: { saleNumber: target } })
  if (!sale) { console.log('NOT_FOUND'); process.exit(0) }
  const doc = await prisma.taxDocument.findFirst({
    where: { saleId: sale.id, status: 'issued', type: { in: ['boleta', 'factura'] } },
    include: { lines: true },
    orderBy: { createdAt: 'desc' },
  })
  if (!doc) { console.log('NO_DOC'); process.exit(0) }
  console.log(`Doc ${doc.id} (folio ${doc.folio}, externalId ${doc.externalId}):`)
  for (const l of doc.lines) {
    console.log(`  line ${l.id}:`)
    console.log(`    sku=${l.sku}`)
    console.log(`    externalLineId=${l.externalLineId ?? 'NULL'}`)
    console.log(`    quantity=${l.quantity}`)
    console.log(`    netUnitValue=${l.netUnitValue}`)
  }
  await prisma.$disconnect()
}
run()
