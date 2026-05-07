import { PrismaClient } from '@prisma/client'
import axios from 'axios'

const RUT = process.argv[2] || '77444127-1'

async function run() {
  const prisma = new PrismaClient()
  const conn = await prisma.connection.findFirst({ where: { provider: 'bsale' } })
  if (!conn) { console.log('NO_BSALE'); process.exit(1) }
  const token = (conn.credentials as any).accessToken
  const c = axios.create({
    baseURL: 'https://api.bsale.io/v1',
    headers: { access_token: token },
  })
  const res = await c.get('/clients.json', { params: { code: RUT, limit: 5 } })
  console.log(`Buscando RUT ${RUT}:`)
  console.log(JSON.stringify(res.data, null, 2))
  await prisma.$disconnect()
}
run().catch((e) => { console.error(e?.response?.data || e?.message); process.exit(1) })
