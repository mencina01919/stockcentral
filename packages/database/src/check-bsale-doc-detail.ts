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

  const docId = process.argv[2] || '22142'
  console.log(`Fetching /v1/documents/${docId}.json...`)
  const res = await c.get(`/documents/${docId}.json`)
  console.log('Top-level keys:', Object.keys(res.data))
  console.log('details:', JSON.stringify(res.data.details, null, 2))

  // También probar el endpoint específico de details
  try {
    console.log(`\nFetching /v1/documents/${docId}/details.json...`)
    const res2 = await c.get(`/documents/${docId}/details.json`)
    console.log(JSON.stringify(res2.data, null, 2))
  } catch (e: any) {
    console.log('Detail endpoint err:', e?.response?.data || e?.message)
  }

  await prisma.$disconnect()
}
run().catch((e) => { console.error(e?.response?.data || e?.message); process.exit(1) })
