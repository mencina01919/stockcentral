// Setea un flag en config de la connection Bsale.
// Uso: ts-node set-bsale-flag.ts <key> <true|false>

import { PrismaClient } from '@prisma/client'

async function run() {
  const key = process.argv[2]
  const valRaw = process.argv[3]
  if (!key || !valRaw) { console.log('Uso: ts-node set-bsale-flag.ts <key> <true|false>'); process.exit(1) }
  const val = valRaw === 'true'
  const prisma = new PrismaClient()
  const conn = await prisma.connection.findFirst({ where: { provider: 'bsale' } })
  if (!conn) { console.log('NO_BSALE'); process.exit(1) }
  const cfg = { ...((conn.config as any) || {}), [key]: val }
  await prisma.connection.update({ where: { id: conn.id }, data: { config: cfg } })
  console.log(`Bsale config[${key}] = ${val}`)
  console.log('Full config:', JSON.stringify(cfg, null, 2))
  await prisma.$disconnect()
}
run()
