// Inspecciona los datos billing de una orden ML para anticipar el resultado
// de la emisión: ¿tiene RUT? ¿factura o boleta? ¿dirección?

import { PrismaClient } from '@prisma/client'

const ID = process.argv[2]

async function run() {
  if (!ID) { console.log('Uso: ts-node inspect-order-billing.ts <externalOrderId>'); process.exit(1) }
  const prisma = new PrismaClient()
  const order = await prisma.order.findFirst({
    where: { source: 'mercadolibre', externalOrderId: ID },
    include: { items: true, sale: true },
  })
  if (!order) { console.log('NOT_FOUND'); process.exit(0) }

  console.log('=== Order ===')
  console.log(`  orderNumber: ${order.orderNumber}`)
  console.log(`  saleId: ${order.saleId}`)
  console.log(`  saleNumber: ${order.sale?.saleNumber}`)
  console.log(`  status: ${order.status}`)
  console.log(`  paymentStatus: ${order.paymentStatus}`)
  console.log(`  internalStatus: ${order.internalStatus}`)
  console.log(`  total: ${order.total} ${order.currency}`)
  console.log()
  console.log('=== Customer (boleta) ===')
  console.log(`  customerName: ${order.customerName}`)
  console.log(`  customerEmail: ${order.customerEmail}`)
  console.log(`  customerPhone: ${order.customerPhone}`)
  console.log(`  customerDocType: ${order.customerDocType}`)
  console.log(`  customerDocNumber: ${order.customerDocNumber}`)
  console.log()
  console.log('=== Billing (factura) ===')
  console.log(`  invoiceType: ${order.invoiceType}`)
  console.log(`  billingName: ${order.billingName}`)
  console.log(`  billingDocType: ${order.billingDocType}`)
  console.log(`  billingDocNumber: ${order.billingDocNumber}`)
  console.log(`  billingEmail: ${order.billingEmail}`)
  console.log(`  economicActivity: ${order.economicActivity}`)
  console.log(`  taxContributor: ${order.taxContributor}`)
  console.log()
  console.log('=== Address ===')
  console.log(`  shippingAddress: ${JSON.stringify(order.shippingAddress)}`)
  console.log(`  billingAddress: ${JSON.stringify(order.billingAddress)}`)
  console.log()
  console.log('=== Items ===')
  for (const item of order.items) {
    console.log(`  ${item.sku} x${item.quantity} @ ${item.unitPrice} = ${item.totalPrice}`)
    console.log(`    name: ${item.name}`)
  }
  console.log()
  console.log('=== Sale (raíz para facturar) ===')
  if (order.sale) {
    console.log(`  saleNumber: ${order.sale.saleNumber}`)
    console.log(`  invoiceType: ${order.sale.invoiceType}`)
    console.log(`  billingName: ${order.sale.billingName}`)
    console.log(`  billingDocNumber: ${order.sale.billingDocNumber}`)
    console.log(`  total: ${order.sale.total}`)
    console.log(`  paymentStatus: ${order.sale.paymentStatus}`)
  }

  await prisma.$disconnect()
}
run()
