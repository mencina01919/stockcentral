// Verifica un documento Bsale con todos los campos relevantes incluyendo
// estado SII (informedSii, responseMsgSii, etc.).

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
  for (const id of ids) {
    const res = await c.get(`/documents/${id}.json`)
    const d = res.data
    console.log(`Documento ${id} (folio ${d.number}):`)
    console.log(`  totalAmount:      ${d.totalAmount}`)
    console.log(`  netAmount:        ${d.netAmount}`)
    console.log(`  taxAmount:        ${d.taxAmount}`)
    console.log(`  exemptAmount:     ${d.exemptAmount}`)
    console.log(`  state:            ${d.state}`)
    console.log(`  commercialState:  ${d.commercialState}`)
    console.log(`  informedSii:      ${d.informedSii}`)
    console.log(`  responseMsgSii:   ${d.responseMsgSii}`)
    console.log(`  cancellationStatus: ${d.cancellationStatus}`)
    console.log(`  urlPdf:           ${d.urlPdf}`)
    console.log(`  urlXml:           ${d.urlXml}`)
    console.log(`  urlPublicView:    ${d.urlPublicView}`)
  }
  await prisma.$disconnect()
}
run().catch((e) => { console.error(e?.response?.data || e?.message); process.exit(1) })
