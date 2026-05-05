import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } })
  console.log(`Procesando ${tenants.length} tenants...`)

  const defaults = [
    { name: 'Stock Online', warehouseType: 'online' },
    { name: 'Bodega Principal', warehouseType: 'warehouse' },
    { name: 'Tienda', warehouseType: 'store' },
  ]

  for (const tenant of tenants) {
    for (const def of defaults) {
      const exists = await prisma.warehouse.findFirst({
        where: { tenantId: tenant.id, warehouseType: def.warehouseType, isDefault: true },
      })
      if (!exists) {
        await prisma.warehouse.create({
          data: {
            tenantId: tenant.id,
            name: def.name,
            type: 'physical',
            warehouseType: def.warehouseType,
            isDefault: true,
            active: true,
          },
        })
        console.log(`  ✓ [${tenant.name}] Bodega "${def.name}" creada`)
      } else {
        console.log(`  - [${tenant.name}] Bodega "${def.name}" ya existe`)
      }
    }
  }

  console.log('Listo.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
