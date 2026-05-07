import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  const sale = await prisma.sale.findFirst({
    where: { saleNumber: process.argv[2] || 'SALE-004178' },
    include: { orders: { include: { items: true } } },
  })
  if (!sale) {
    console.log('NOT_FOUND')
    process.exit(0)
  }
  console.log(JSON.stringify({
    id: sale.id,
    tenantId: sale.tenantId,
    saleNumber: sale.saleNumber,
    customerName: sale.customerName,
    customerDocNumber: sale.customerDocNumber,
    billingName: sale.billingName,
    billingDocNumber: sale.billingDocNumber,
    invoiceType: sale.invoiceType,
    status: sale.status,
    paymentStatus: sale.paymentStatus,
    total: sale.total.toString(),
    currency: sale.currency,
    source: sale.source,
    itemsCount: sale.orders.flatMap(o => o.items).length,
    externalOrderIds: sale.orders.map(o => o.externalOrderId),
  }, null, 2))
  await prisma.$disconnect()
}
run()
