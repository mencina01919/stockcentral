import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  const target = process.argv[2] || 'SALE-004168'
  const sale = await prisma.sale.findFirst({ where: { saleNumber: target } })
  if (!sale) { console.log('NOT_FOUND'); process.exit(0) }
  const docs = await prisma.taxDocument.findMany({
    where: { saleId: sale.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      type: true,
      status: true,
      folio: true,
      externalId: true,
      pdfUrl: true,
      createdAt: true,
      lastError: true,
    },
  })
  console.log(`${target} (${sale.id}) — ${docs.length} doc(s):`)
  for (const d of docs) {
    console.log(JSON.stringify(d, null, 2))
  }
  await prisma.$disconnect()
}
run()
