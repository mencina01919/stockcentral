import { PrismaClient } from '@prisma/client'
async function run() {
  const prisma = new PrismaClient()
  const sales = await prisma.sale.findMany({
    where: {
      status: 'cancelled',
      taxDocuments: {
        some: { type: { in: ['boleta', 'factura'] }, status: 'issued' },
        none: { type: 'nota_credito', status: 'issued' },
      },
    },
    include: {
      taxDocuments: { select: { type: true, emitter: true, externalId: true, folio: true } },
    },
  })
  const byEmitter: Record<string, number> = {}
  for (const s of sales) {
    for (const d of s.taxDocuments) {
      if (d.type === 'nota_credito') continue
      byEmitter[d.emitter] = (byEmitter[d.emitter] || 0) + 1
    }
  }
  console.log('Cancelled sales con doc sin NC, por emitter:')
  console.log(byEmitter)
  await prisma.$disconnect()
}
run().catch((e) => { console.error(e); process.exit(1) })
