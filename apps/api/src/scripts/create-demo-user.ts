import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const hash = await bcrypt.hash('admin123', 10)
  const trialEndsAt = new Date()
  trialEndsAt.setDate(trialEndsAt.getDate() + 14)

  const tenant = await prisma.tenant.create({
    data: {
      name: 'StockCentral Demo',
      slug: 'stockcentral-demo',
      email: 'admin@stockcentral.cl',
      country: 'CL',
      currency: 'CLP',
      plan: 'free',
      status: 'trial',
      trialEndsAt,
    },
  })

  await prisma.warehouse.createMany({
    data: [
      { tenantId: tenant.id, name: 'Stock Online',     type: 'physical', warehouseType: 'online',    isDefault: true, active: true },
      { tenantId: tenant.id, name: 'Bodega Principal', type: 'physical', warehouseType: 'warehouse',  isDefault: true, active: true },
      { tenantId: tenant.id, name: 'Tienda',           type: 'physical', warehouseType: 'store',      isDefault: true, active: true },
    ],
  })

  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'admin@stockcentral.cl',
      password: hash,
      firstName: 'Admin',
      lastName: 'StockCentral',
      role: 'owner',
      emailVerified: true,
      status: 'active',
    },
  })

  console.log('✓ Usuario creado: admin@stockcentral.cl / admin123')
}

main().catch(console.error).finally(() => prisma.$disconnect())
