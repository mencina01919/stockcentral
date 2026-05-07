// Activa autoEmit y setea emitFromDate al cutoff que se le pasa.
// Uso: ts-node activate-auto-emit.ts <ISO date>
//   ej: ts-node activate-auto-emit.ts 2026-05-07T22:00:00Z

import { PrismaClient } from '@prisma/client'

async function run() {
  const cutoff = process.argv[2]
  if (!cutoff) { console.log('Uso: ts-node activate-auto-emit.ts <ISO date>'); process.exit(1) }
  const d = new Date(cutoff)
  if (Number.isNaN(d.getTime())) { console.log('Fecha inválida'); process.exit(1) }

  const prisma = new PrismaClient()
  const conn = await prisma.connection.findFirst({ where: { provider: 'bsale' } })
  if (!conn) { console.log('NO_BSALE'); process.exit(1) }
  const cfg = {
    ...((conn.config as any) || {}),
    autoEmit: true,
    emitFromDate: d.toISOString(),
  }
  await prisma.connection.update({ where: { id: conn.id }, data: { config: cfg } })
  console.log('Bsale config actualizado:')
  console.log(JSON.stringify(cfg, null, 2))
  await prisma.$disconnect()
}
run()
