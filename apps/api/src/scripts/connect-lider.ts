import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: 'stockcentral-demo' } })
  if (!tenant) throw new Error('Tenant no encontrado')

  const existing = await prisma.connection.findFirst({ where: { tenantId: tenant.id, provider: 'lider' } })
  if (existing) {
    await prisma.connection.update({
      where: { id: existing.id },
      data: { status: 'connected', credentials: { clientId: 'a8097210-620a-40b3-ba1b-58e8ae9955e2', clientSecret: 'P1izCpF1aCanYQPYzfbAmHZRI8s2hTf8oVVUGOaFewLzknSsI7PbV7Q4gh33_MI1nAu_7g3OMCO5N8gC1WNk6Q' }, config: { sandbox: true } },
    })
    console.log('✓ Conexión Lider actualizada')
    return
  }

  await prisma.connection.create({
    data: {
      tenantId: tenant.id,
      type: 'marketplace',
      provider: 'lider',
      name: 'Lider (Walmart Chile)',
      credentials: {
        clientId: 'a8097210-620a-40b3-ba1b-58e8ae9955e2',
        clientSecret: 'P1izCpF1aCanYQPYzfbAmHZRI8s2hTf8oVVUGOaFewLzknSsI7PbV7Q4gh33_MI1nAu_7g3OMCO5N8gC1WNk6Q',
      },
      config: { sandbox: true },
      status: 'connected',
      syncEnabled: true,
    },
  })
  console.log('✓ Conexión Lider creada correctamente (modo sandbox)')
}

main().catch(console.error).finally(() => prisma.$disconnect())
