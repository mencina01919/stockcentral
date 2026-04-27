import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo-store' },
    update: {},
    create: {
      name: 'Demo Store',
      slug: 'demo-store',
      email: 'admin@demo-store.com',
      country: 'CL',
      currency: 'CLP',
      language: 'es',
      plan: 'pro',
      status: 'active',
    },
  })

  const hashedPassword = await bcrypt.hash('Admin1234!', 10)

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@demo-store.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@demo-store.com',
      password: hashedPassword,
      firstName: 'Admin',
      lastName: 'User',
      role: 'owner',
      emailVerified: true,
      status: 'active',
    },
  })

  const warehouse = await prisma.warehouse.upsert({
    where: { id: 'default-warehouse' },
    update: {},
    create: {
      id: 'default-warehouse',
      tenantId: tenant.id,
      name: 'Bodega Principal',
      type: 'physical',
      active: true,
    },
  })

  const products = [
    { sku: 'PROD-001', name: 'Camisa Azul Hombre', price: 29990, stock: 150 },
    { sku: 'PROD-002', name: 'Pantalón Negro', price: 49990, stock: 45 },
    { sku: 'PROD-003', name: 'Zapatos Marrón', price: 89990, stock: 23 },
    { sku: 'PROD-004', name: 'Reloj Plateado', price: 199990, stock: 12 },
    { sku: 'PROD-005', name: 'Bolso de Cuero', price: 149990, stock: 8 },
  ]

  for (const p of products) {
    const product = await prisma.product.upsert({
      where: { tenantId_sku: { tenantId: tenant.id, sku: p.sku } },
      update: {},
      create: {
        tenantId: tenant.id,
        sku: p.sku,
        name: p.name,
        basePrice: p.price,
        status: 'active',
        tags: ['demo'],
      },
    })

    const existingInventory = await prisma.inventory.findFirst({
      where: { productId: product.id, variantId: null, warehouseId: warehouse.id },
    })
    if (!existingInventory) {
      await prisma.inventory.create({
        data: {
          tenantId: tenant.id,
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: p.stock,
          minStock: 5,
        },
      })
    }
  }

  console.log('Seed completed.')
  console.log(`Tenant: ${tenant.slug}`)
  console.log('Login: admin@demo-store.com / Admin1234!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
