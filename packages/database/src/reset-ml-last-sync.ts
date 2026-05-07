import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  const conn = await prisma.connection.findFirst({ where: { provider: 'mercadolibre' } })
  if (!conn) { console.log('NO_ML_CONN'); process.exit(1) }
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  await prisma.connection.update({
    where: { id: conn.id },
    data: { lastSync: sevenDaysAgo },
  })
  console.log(`lastSync de ${conn.id} forzado a ${sevenDaysAgo.toISOString()}`)
  await prisma.$disconnect()
}
run()
