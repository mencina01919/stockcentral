import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  const billing = await prisma.connection.findMany({
    where: { type: 'billing' },
    select: { id: true, provider: true, config: true, updatedAt: true, createdAt: true, status: true },
  })
  console.log(`Billing connections: ${billing.length}`)
  for (const c of billing) {
    console.log(`\nID=${c.id} provider=${c.provider} status=${c.status}`)
    console.log(`  created: ${c.createdAt.toISOString()}`)
    console.log(`  updated: ${c.updatedAt.toISOString()}`)
    console.log(`  config:`, JSON.stringify(c.config, null, 2))
  }
  await prisma.$disconnect()
}
run().catch((e) => { console.error(e); process.exit(1) })
