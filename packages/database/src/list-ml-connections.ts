import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  const conns = await prisma.connection.findMany({
    where: { provider: 'mercadolibre' },
    select: {
      id: true, tenantId: true, name: true, status: true, lastSync: true,
      syncEnabled: true, createdAt: true,
      credentials: true, config: true,
    },
  })
  console.log(`Total ML connections: ${conns.length}`)
  for (const c of conns) {
    const creds = c.credentials as any
    const cfg = c.config as any
    console.log()
    console.log(`id: ${c.id}`)
    console.log(`  name: ${c.name}`)
    console.log(`  status: ${c.status}`)
    console.log(`  syncEnabled: ${c.syncEnabled}`)
    console.log(`  lastSync: ${c.lastSync}`)
    console.log(`  createdAt: ${c.createdAt}`)
    console.log(`  sellerId: ${creds?.sellerId}`)
    console.log(`  has accessToken: ${!!creds?.accessToken}`)
    console.log(`  has refreshToken: ${!!creds?.refreshToken}`)
    console.log(`  has clientId in config: ${!!cfg?.clientId}`)
    console.log(`  tokenExpiresAt: ${cfg?.tokenExpiresAt}`)
  }
  await prisma.$disconnect()
}
run()
