import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  const conn = await prisma.connection.findFirst({ where: { provider: 'bsale' } })
  if (!conn) { console.log('NO_BSALE'); process.exit(1) }
  const cfg = { ...(conn.config as any), taxIdIVA: '1' }
  await prisma.connection.update({ where: { id: conn.id }, data: { config: cfg } })
  console.log('Updated:', JSON.stringify(cfg, null, 2))
  await prisma.$disconnect()
}
run()
