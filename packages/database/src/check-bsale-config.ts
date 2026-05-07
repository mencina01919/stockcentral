import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  const conn = await prisma.connection.findFirst({
    where: { provider: 'bsale' },
  })
  if (!conn) {
    console.log('NO_BSALE_CONNECTION')
    process.exit(0)
  }
  const config = (conn.config || {}) as any
  console.log('Bsale connection config:')
  console.log(JSON.stringify(config, null, 2))
  console.log()
  console.log('Tipo de taxIdIVA:', typeof config.taxIdIVA)
  console.log('Valor:           ', JSON.stringify(config.taxIdIVA))
  await prisma.$disconnect()
}
run()
