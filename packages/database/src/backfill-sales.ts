import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function aggregateStatus(statuses: string[]): string {
  if (statuses.length === 0) return 'pending'
  const unique = Array.from(new Set(statuses))
  if (unique.length === 1) return unique[0]
  if (unique.every((s) => s === 'cancelled')) return 'cancelled'
  if (unique.includes('pending')) return 'pending'
  return unique[0]
}

async function main() {
  console.log('Backfill sales: starting…')

  const orders = await prisma.$queryRaw<
    Array<{
      id: string
      tenantId: string
      source: string
      orderNumber: string
      saleId: string | null
      customerName: string
      customerEmail: string | null
      customerPhone: string | null
      shippingAddress: any
      billingAddress: any
      subtotal: any
      shippingCost: any
      tax: any
      discount: any
      total: any
      currency: string
      status: string
      paymentStatus: string
      shipmentStatus: string
      packId: string | null
      metadata: any
      createdAt: Date
    }>
  >`
    SELECT id, "tenantId", source, "orderNumber", "saleId", "customerName",
           "customerEmail", "customerPhone", "shippingAddress", "billingAddress",
           subtotal, "shippingCost", tax, discount, total, currency, status,
           "paymentStatus", "shipmentStatus", "packId", metadata, "createdAt"
    FROM "Order"
    WHERE "saleId" IS NULL
    ORDER BY "tenantId", "createdAt" ASC
  `

  console.log(`Found ${orders.length} orders without saleId`)
  if (orders.length === 0) {
    console.log('Nothing to backfill.')
    return
  }

  // For ML orders without packId column populated (legacy), try to read from metadata.rawData.pack_id
  for (const o of orders) {
    if (!o.packId && o.source === 'mercadolibre') {
      const raw = o.metadata?.rawData
      const pid = raw?.pack_id
      if (pid) {
        await prisma.$executeRaw`UPDATE "Order" SET "packId" = ${String(pid)} WHERE id = ${o.id}`
        o.packId = String(pid)
      }
    }
  }

  // Group by (tenantId, source, packId) — orders without packId stay 1:1
  const groups = new Map<string, typeof orders>()
  for (const o of orders) {
    const key = o.packId
      ? `${o.tenantId}|${o.source}|pack:${o.packId}`
      : `${o.tenantId}|solo:${o.id}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(o)
  }

  console.log(`Will create ${groups.size} sales`)

  let saleCounters = new Map<string, number>()
  for (const tenantId of new Set(orders.map((o) => o.tenantId))) {
    const existing = await prisma.sale.count({ where: { tenantId } })
    saleCounters.set(tenantId, existing)
  }

  let created = 0
  for (const [, groupOrders] of groups) {
    const first = groupOrders[0]
    const tenantId = first.tenantId
    const next = (saleCounters.get(tenantId) || 0) + 1
    saleCounters.set(tenantId, next)
    const saleNumber = `SALE-${String(next).padStart(6, '0')}`

    const sum = (key: 'subtotal' | 'shippingCost' | 'tax' | 'discount' | 'total') =>
      groupOrders.reduce((acc, o) => acc + Number(o[key] || 0), 0)

    const sale = await prisma.sale.create({
      data: {
        tenantId,
        saleNumber,
        source: first.source,
        externalGroupId: first.packId || null,
        customerName: first.customerName,
        customerEmail: first.customerEmail,
        customerPhone: first.customerPhone,
        shippingAddress: first.shippingAddress ?? undefined,
        billingAddress: first.billingAddress ?? undefined,
        subtotal: sum('subtotal'),
        shippingCost: sum('shippingCost'),
        tax: sum('tax'),
        discount: sum('discount'),
        total: sum('total'),
        currency: first.currency,
        status: aggregateStatus(groupOrders.map((o) => o.status)),
        paymentStatus: aggregateStatus(groupOrders.map((o) => o.paymentStatus)),
        shipmentStatus: aggregateStatus(groupOrders.map((o) => o.shipmentStatus)),
        createdAt: first.createdAt,
      },
    })

    await prisma.order.updateMany({
      where: { id: { in: groupOrders.map((o) => o.id) } },
      data: { saleId: sale.id },
    })
    created++
  }

  console.log(`Backfill done: ${created} sales created`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
