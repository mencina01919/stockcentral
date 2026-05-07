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

  // /document_types.json devuelve los tipos de documento de la cuenta.
  const res = await c.get('/document_types.json', { params: { limit: 50 } })
  const items = res.data?.items || []
  console.log(`Total: ${res.data?.count}`)
  console.log()
  for (const t of items) {
    console.log(`id=${t.id}  codeSii=${t.codeSii}  name="${t.name}"  use=${t.use ?? '-'}`)
  }
  await prisma.$disconnect()
}
run().catch((e) => { console.error(e?.response?.data || e?.message); process.exit(1) })
