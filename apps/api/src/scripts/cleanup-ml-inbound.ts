/**
 * Limpia productos que entraron al catálogo maestro por sync inbound de marketplaces
 * (ML, Paris, Lider, Falabella). Solo elimina productos cuyo ÚNICO mapping es de un
 * marketplace y no tienen formData (nunca fueron publicados manualmente).
 *
 * Ejecutar: npx ts-node -P tsconfig.json src/scripts/cleanup-ml-inbound.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const MARKETPLACE_PROVIDERS = ['mercadolibre', 'paris', 'lider', 'falabella', 'walmart', 'ripley']

async function main() {
  // Busca todos los productos que tienen al menos un mapping de marketplace sin formData
  const candidates = await prisma.product.findMany({
    where: {
      marketplaceMappings: {
        some: {
          formData: null,
          connection: { provider: { in: MARKETPLACE_PROVIDERS } },
        },
      },
    },
    include: {
      marketplaceMappings: {
        include: { connection: { select: { provider: true, name: true } } },
      },
    },
  })

  // Solo eliminar si TODOS los mappings son de marketplaces sin formData
  // (si hay algún mapping con formData, el producto fue publicado manualmente — no tocar)
  const toDelete = candidates.filter((p) => {
    const hasManualPublication = p.marketplaceMappings.some((m) => m.formData !== null)
    const allFromMarketplace = p.marketplaceMappings.every((m) =>
      MARKETPLACE_PROVIDERS.includes(m.connection.provider),
    )
    return !hasManualPublication && allFromMarketplace
  })

  console.log(`Candidatos encontrados: ${candidates.length}`)
  console.log(`A eliminar (sin publicación manual): ${toDelete.length}`)

  if (toDelete.length === 0) {
    console.log('Nada que limpiar.')
    return
  }

  console.log('\nProductos a eliminar:')
  for (const p of toDelete) {
    const providers = p.marketplaceMappings.map((m) => m.connection.provider).join(', ')
    console.log(`  - [${p.sku}] ${p.name} (via: ${providers})`)
  }

  const ids = toDelete.map((p) => p.id)

  // Eliminar en cascada (inventory, mappings, variants se borran por onDelete: Cascade)
  const result = await prisma.product.deleteMany({ where: { id: { in: ids } } })
  console.log(`\nEliminados: ${result.count} productos`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
