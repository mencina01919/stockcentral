// Cuenta órdenes ML por estado y compara con lo que ML reporta vía API.

import { PrismaClient } from '@prisma/client'
import axios from 'axios'

async function run() {
  const prisma = new PrismaClient()

  // 1) Lo que tenemos local
  const totalLocal = await prisma.order.count({ where: { source: 'mercadolibre' } })
  const byInternal = await prisma.order.groupBy({
    by: ['internalStatus'],
    where: { source: 'mercadolibre' },
    _count: true,
  })
  const byPayment = await prisma.order.groupBy({
    by: ['paymentStatus'],
    where: { source: 'mercadolibre' },
    _count: true,
  })
  const byChannelStatus = await prisma.order.groupBy({
    by: ['status'],
    where: { source: 'mercadolibre' },
    _count: true,
  })
  console.log('=== Local DB ===')
  console.log(`Total ML orders: ${totalLocal}`)
  console.log('By internalStatus:', byInternal)
  console.log('By paymentStatus:', byPayment)
  console.log('By marketplace status:', byChannelStatus)
  console.log()

  // 2) Última fecha sincronizada
  const conn = await prisma.connection.findFirst({ where: { provider: 'mercadolibre' } })
  if (!conn) { console.log('NO_ML_CONN'); process.exit(0) }
  console.log('=== Connection ML ===')
  console.log('  status:', conn.status)
  console.log('  lastSync:', conn.lastSync)
  console.log('  syncEnabled:', conn.syncEnabled)
  console.log()

  // 3) Pegarle a ML para ver el total real por status
  const token = (conn.credentials as any).accessToken
  const sellerId = (conn.credentials as any).sellerId
  if (!token || !sellerId) { console.log('NO_TOKEN_OR_SELLER'); process.exit(0) }

  const c = axios.create({
    baseURL: 'https://api.mercadolibre.com',
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  })

  console.log('=== ML API ===')
  for (const s of ['paid', 'cancelled', 'confirmed', 'payment_required', 'payment_in_process']) {
    try {
      const res = await c.get(`/orders/search`, {
        params: { seller: sellerId, 'order.status': s, limit: 1, offset: 0 },
      })
      console.log(`  status=${s}: total=${res.data?.paging?.total ?? '?'}`)
    } catch (e: any) {
      console.log(`  status=${s}: ERROR ${e?.response?.data?.message || e?.message}`)
    }
  }
  // total general (sin filtro)
  try {
    const res = await c.get(`/orders/search`, { params: { seller: sellerId, limit: 1, offset: 0 } })
    console.log(`  TOTAL ML: ${res.data?.paging?.total}`)
  } catch (e: any) {
    console.log(`  TOTAL ML: ERROR ${e?.response?.data?.message || e?.message}`)
  }

  // 4) Última orden ML local vs primera en ML
  const lastLocal = await prisma.order.findFirst({
    where: { source: 'mercadolibre' },
    orderBy: { createdAt: 'desc' },
    select: { externalOrderId: true, createdAt: true, orderNumber: true },
  })
  console.log()
  console.log('Última orden ML local:', lastLocal)

  await prisma.$disconnect()
}
run().catch((e) => { console.error(e?.response?.data || e?.message || e); process.exit(1) })
