// Verifica los montos reales de un documento Bsale (net, tax, exempt) tras
// emisión, para confirmar si el IVA se aplicó correctamente.

import { PrismaClient } from '@prisma/client'
import axios from 'axios'

async function run() {
  const prisma = new PrismaClient()
  const conn = await prisma.connection.findFirst({ where: { provider: 'bsale' } })
  if (!conn) { console.log('NO_BSALE'); process.exit(1) }
  const token = (conn.credentials as any).accessToken
  const c = axios.create({
    baseURL: 'https://api.bsale.io/v1',
    headers: { access_token: token },
  })

  const ids = process.argv.slice(2)
  if (ids.length === 0) {
    console.log('Uso: ts-node check-bsale-doc.ts <externalId> [<externalId> ...]')
    process.exit(1)
  }
  for (const id of ids) {
    const res = await c.get(`/documents/${id}.json`)
    const d = res.data
    console.log(`\nDocumento ${id} (folio ${d.number}):`)
    console.log(`  totalAmount:  ${d.totalAmount}`)
    console.log(`  netAmount:    ${d.netAmount}`)
    console.log(`  taxAmount:    ${d.taxAmount}    ← debe ser >0 si aplicó IVA`)
    console.log(`  exemptAmount: ${d.exemptAmount}`)
  }
  await prisma.$disconnect()
}
run().catch((e) => { console.error(e?.response?.data || e?.message); process.exit(1) })
