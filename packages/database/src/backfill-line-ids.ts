// Backfill: para todas las TaxDocuments con `externalId` pero líneas con
// `externalLineId=NULL`, consultar Bsale /documents/{id}/details.json y
// llenar los IDs. Necesario para poder emitir NC sobre documentos antiguos.

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

  const docs = await prisma.taxDocument.findMany({
    where: {
      emitter: 'bsale',
      status: 'issued',
      externalId: { not: null },
      type: { in: ['boleta', 'factura'] },
    },
    include: { lines: true },
  })

  console.log(`${docs.length} documents issued`)
  for (const doc of docs) {
    const missing = doc.lines.filter((l) => !l.externalLineId)
    if (missing.length === 0) {
      console.log(`  ${doc.folio}: OK`)
      continue
    }
    try {
      const res = await c.get(`/documents/${doc.externalId}/details.json`, {
        params: { limit: Math.max(50, doc.lines.length) },
      })
      const items: any[] = (res.data?.items || []).slice()
      items.sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0))
      const sortedLocal = doc.lines.slice().sort((a, b) => (a.id < b.id ? -1 : 1))
      let updated = 0
      for (let i = 0; i < Math.min(items.length, sortedLocal.length); i++) {
        const local = sortedLocal[i]
        if (local.externalLineId) continue
        await prisma.taxDocumentLine.update({
          where: { id: local.id },
          data: { externalLineId: String(items[i].id) },
        })
        updated++
      }
      console.log(`  ${doc.folio} (${doc.externalId}): updated ${updated} line(s)`)
    } catch (e: any) {
      console.log(`  ${doc.folio}: ERROR ${e?.response?.data?.error || e?.message}`)
    }
  }
  await prisma.$disconnect()
}
run().catch((e) => { console.error(e); process.exit(1) })
