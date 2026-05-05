import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: 'stockcentral-demo' } })
  if (!tenant) throw new Error('Tenant no encontrado')

  const warehouses = await prisma.warehouse.findMany({
    where: { tenantId: tenant.id, isDefault: true },
  })

  const whByType = Object.fromEntries(warehouses.map(w => [w.warehouseType, w]))

  const products = [
    {
      sku: 'SAM-TV55-QLED',
      name: 'Samsung TV 55" QLED 4K Smart TV QN55Q80C',
      brand: 'Samsung',
      description: 'Televisor QLED 55 pulgadas con resolución 4K, tecnología Quantum Dot, HDR10+, 120Hz, compatible con Alexa y Google Assistant.',
      basePrice: 699990, costPrice: 420000, transferPrice: 480000, salePrice: 649990,
      status: 'active', tags: ['televisor', 'qled', '4k', 'samsung'],
      stockOnline: 15, stockWarehouse: 30, stockStore: 5,
    },
    {
      sku: 'LG-LAV-WM15',
      name: 'LG Lavadora Carga Frontal 15kg AI DD WM15',
      brand: 'LG',
      description: 'Lavadora de carga frontal 15kg con tecnología AI DD que detecta el peso y textura de la ropa. Vapor, 6 Motion, eficiencia A+++.',
      basePrice: 549990, costPrice: 310000, transferPrice: 370000,
      status: 'active', tags: ['lavadora', 'lg', 'electrohogar'],
      stockOnline: 8, stockWarehouse: 20, stockStore: 3,
    },
    {
      sku: 'NIKE-AM270-BLK',
      name: 'Nike Air Max 270 Zapatilla Hombre Negro/Blanco',
      brand: 'Nike',
      description: 'Zapatilla urbana con la mayor unidad de Air en el talón. Parte superior de malla transpirable, suela de goma resistente.',
      basePrice: 89990, costPrice: 42000, transferPrice: 55000, salePrice: 79990,
      status: 'active', tags: ['zapatilla', 'nike', 'deportivo'],
      stockOnline: 45, stockWarehouse: 80, stockStore: 20,
    },
    {
      sku: 'INST-OLLA-PRES',
      name: 'Instant Pot Duo 7-en-1 Olla a Presión Eléctrica 6L',
      brand: 'Instant Pot',
      description: 'Olla a presión eléctrica multifunción 7 en 1: olla a presión, olla arrocera, saltear, vaporera, yogurt, calentador y esterilizador.',
      basePrice: 69990, costPrice: 35000, transferPrice: 44000,
      status: 'active', tags: ['cocina', 'olla', 'electrohogar'],
      stockOnline: 25, stockWarehouse: 60, stockStore: 10,
    },
    {
      sku: 'APPLE-IPAD-AIR5',
      name: 'Apple iPad Air 5ta Generación 10.9" WiFi 64GB',
      brand: 'Apple',
      description: 'iPad Air con chip M1, pantalla Liquid Retina 10.9", compatible con Apple Pencil 2 y Magic Keyboard. Cámara 12MP.',
      basePrice: 749990, costPrice: 500000, transferPrice: 580000,
      status: 'active', tags: ['tablet', 'apple', 'ipad'],
      stockOnline: 12, stockWarehouse: 25, stockStore: 4,
    },
    {
      sku: 'BOSE-QC45-BLK',
      name: 'Bose QuietComfort 45 Audífonos Inalámbricos Negro',
      brand: 'Bose',
      description: 'Audífonos over-ear con cancelación de ruido líder en la industria, 24 horas de batería, micrófono para llamadas, modo Aware.',
      basePrice: 299990, costPrice: 160000, transferPrice: 200000, salePrice: 249990,
      status: 'active', tags: ['audifono', 'bose', 'bluetooth'],
      stockOnline: 20, stockWarehouse: 35, stockStore: 8,
    },
    {
      sku: 'DEWALT-TALADRO-20V',
      name: 'DeWalt Taladro Percutor Inalámbrico 20V MAX DCD778',
      brand: 'DeWalt',
      description: 'Taladro percutor 20V con motor sin escobillas, 2 velocidades, portabrocas de 13mm, incluye 2 baterías y cargador.',
      basePrice: 149990, costPrice: 80000, transferPrice: 100000,
      status: 'active', tags: ['herramienta', 'dewalt', 'taladro'],
      stockOnline: 18, stockWarehouse: 40, stockStore: 6,
    },
    {
      sku: 'NESCAFE-DOLCE-VERTUO',
      name: 'Nespresso Vertuo Next Cafetera Automática Negro',
      brand: 'Nespresso',
      description: 'Cafetera con tecnología Centrifusion, prepara 5 tamaños de café, calentamiento en 30 segundos, depósito de 1.1L extraíble.',
      basePrice: 89990, costPrice: 48000, transferPrice: 60000,
      status: 'active', tags: ['cafetera', 'nespresso', 'cocina'],
      stockOnline: 30, stockWarehouse: 55, stockStore: 12,
    },
  ]

  let created = 0
  for (const p of products) {
    const { stockOnline, stockWarehouse, stockStore, ...productData } = p

    const existing = await prisma.product.findUnique({
      where: { tenantId_sku: { tenantId: tenant.id, sku: p.sku } },
    })
    if (existing) { console.log(`  - Ya existe: ${p.sku}`); continue }

    const product = await prisma.product.create({
      data: { ...productData, tenantId: tenant.id, images: [] },
    })

    const stockByType: Record<string, number> = {
      online: stockOnline, warehouse: stockWarehouse, store: stockStore,
    }

    const inventoryData = Object.entries(stockByType)
      .filter(([type]) => whByType[type])
      .map(([type, qty]) => ({
        tenantId: tenant.id,
        productId: product.id,
        warehouseId: whByType[type].id,
        quantity: qty,
        reservedQuantity: 0,
      }))

    if (inventoryData.length > 0) {
      await prisma.inventory.createMany({ data: inventoryData })
    }

    console.log(`  ✓ ${p.sku} — ${p.name}`)
    created++
  }

  console.log(`\nListo. ${created} productos creados.`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
