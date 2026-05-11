// Alterna el flag autoEmit de la conexión Bsale del tenant.
// Uso:
//   tsx toggle-auto-emit.ts off    → pausa emisión automática
//   tsx toggle-auto-emit.ts on     → reactiva emisión automática
//   tsx toggle-auto-emit.ts        → solo muestra estado actual
import { PrismaClient } from '@prisma/client'

const ACTION = process.argv[2]

async function run() {
  const prisma = new PrismaClient()
  const conn = await prisma.connection.findFirst({ where: { provider: 'bsale' } })
  if (!conn) { console.log('NO_BSALE_CONN'); process.exit(1) }
  const cfg = ((conn.config || {}) as any)
  console.log(`Bsale connection: ${conn.id}`)
  console.log(`autoEmit actual: ${cfg.autoEmit ?? '(no seteado)'}`)
  console.log(`pushToMarketplace actual: ${cfg.pushToMarketplace ?? '(no seteado)'}`)

  if (ACTION === 'off' || ACTION === 'on') {
    const next = ACTION === 'on'
    await prisma.connection.update({
      where: { id: conn.id },
      data: { config: { ...cfg, autoEmit: next } as any },
    })
    console.log(`\n→ autoEmit cambiado a: ${next}`)
    console.log(next
      ? 'La emisión automática vuelve a estar activa. Las próximas ventas paid → emit-document.'
      : 'La emisión automática queda pausada. Las ventas paid no emitirán documento solas.')
    console.log('Para emitir manualmente: /billing/documents → bulk select → "Emitir DTE".')
  } else {
    console.log('\nUso:')
    console.log('  tsx toggle-auto-emit.ts off    → pausa emisión automática')
    console.log('  tsx toggle-auto-emit.ts on     → reactiva emisión automática')
  }

  await prisma.$disconnect()
}
run().catch((e) => { console.error(e?.message || e); process.exit(1) })
