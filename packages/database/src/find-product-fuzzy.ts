// Busca productos por SKU o nombre parcial — case insensitive — para
// encontrar variantes de un SKU que el usuario menciona desde la UI.
import { PrismaClient } from '@prisma/client'

const TERM = process.argv[2] || 'GB305'

async function run() {
  const prisma = new PrismaClient()
  const products = await prisma.product.findMany({
    where: {
      OR: [
        { sku: { contains: TERM, mode: 'insensitive' } },
        { name: { contains: TERM, mode: 'insensitive' } },
      ],
    },
    include: {
      marketplaceMappings: {
        include: { connection: { select: { provider: true, name: true } } },
      },
    },
    take: 10,
  })
  console.log(`Encontrados: ${products.length}`)
  for (const p of products) {
    console.log(`\n[${p.id}] sku=${p.sku}  name=${p.name}  basePrice=${p.basePrice}`)
    for (const m of p.marketplaceMappings) {
      console.log(`  → ${m.connection.provider} (${m.connection.name}) externalId=${m.marketplaceProductId} status=${m.syncStatus} err=${m.errorMessage || '-'}`)
    }
  }
  await prisma.$disconnect()
}
run().catch((e) => { console.error(e?.message || e); process.exit(1) })
