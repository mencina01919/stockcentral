// Lee el flag pushToMarketplace de la conexión Bsale del tenant.
import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  const conn = await prisma.connection.findFirst({ where: { provider: 'bsale' } })
  if (!conn) { console.log('NO_BSALE'); process.exit(1) }
  const cfg = (conn.config || {}) as any
  console.log('Bsale connection id:', conn.id)
  console.log('config.pushToMarketplace:', cfg.pushToMarketplace ?? '(no seteado)')
  console.log('config.autoEmit:', cfg.autoEmit ?? '(no seteado)')
  console.log('config.declareSii:', cfg.declareSii ?? '(no seteado)')
  await prisma.$disconnect()
}
run().catch((e) => { console.error(e?.message || e); process.exit(1) })
