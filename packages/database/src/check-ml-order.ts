// Verifica una orden ML específica: existe en local? existe en ML?
// Si existe en ML, fetch detalle. Si no existe en local, intenta por qué.

import { PrismaClient } from '@prisma/client'
import axios from 'axios'

const ID = process.argv[2]

async function run() {
  if (!ID) { console.log('Uso: ts-node check-ml-order.ts <orderId>'); process.exit(1) }
  const prisma = new PrismaClient()

  // 1) Local
  const local = await prisma.order.findFirst({
    where: { source: 'mercadolibre', externalOrderId: ID },
    include: { items: true },
  })
  console.log('=== LOCAL ===')
  if (local) {
    console.log(`OK encontrada: ${local.orderNumber}`)
    console.log(`  status=${local.status}  paymentStatus=${local.paymentStatus}  internalStatus=${local.internalStatus}`)
    console.log(`  customerName=${local.customerName}`)
    console.log(`  total=${local.total}`)
    console.log(`  createdAt=${local.createdAt}`)
    console.log(`  items=${local.items.length}`)
  } else {
    console.log('NO está en local DB')
  }

  // 2) ML
  const conn = await prisma.connection.findFirst({ where: { provider: 'mercadolibre' } })
  if (!conn) { console.log('NO_ML_CONN'); process.exit(0) }
  const token = (conn.credentials as any).accessToken
  const c = axios.create({
    baseURL: 'https://api.mercadolibre.com',
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  })

  console.log()
  console.log('=== ML API ===')
  try {
    const res = await c.get(`/orders/${ID}`)
    const o = res.data
    console.log(`OK existe en ML`)
    console.log(`  status=${o.status}`)
    console.log(`  date_created=${o.date_created}`)
    console.log(`  date_closed=${o.date_closed}`)
    console.log(`  pack_id=${o.pack_id}`)
    console.log(`  seller.id=${o.seller?.id}`)
    console.log(`  buyer.nickname=${o.buyer?.nickname}`)
    console.log(`  total_amount=${o.total_amount}`)
    console.log(`  currency=${o.currency_id}`)
    console.log(`  shipping=${o.shipping?.id}`)
    console.log(`  tags=${(o.tags || []).join(',')}`)
    console.log(`  payments[].status=${(o.payments || []).map((p: any) => p.status).join(',')}`)
    console.log(`  items=${(o.order_items || []).length}`)
  } catch (err: any) {
    console.log(`ERROR ML: ${err?.response?.status} ${JSON.stringify(err?.response?.data)}`)
  }

  await prisma.$disconnect()
}
run().catch((e) => { console.error(e?.message); process.exit(1) })
