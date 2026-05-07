// Lista los impuestos disponibles en la cuenta Bsale del tenant para
// confirmar el ID real del IVA (que puede no ser 14 en cuentas distintas).

import { PrismaClient } from '@prisma/client'
import axios from 'axios'

async function run() {
  const prisma = new PrismaClient()
  const conn = await prisma.connection.findFirst({
    where: { provider: 'bsale' },
  })
  if (!conn) {
    console.log('NO_BSALE_CONNECTION')
    process.exit(0)
  }
  const creds = (conn.credentials || {}) as any
  const token = creds.accessToken
  if (!token) {
    console.log('NO_TOKEN')
    process.exit(0)
  }

  const client = axios.create({
    baseURL: 'https://api.bsale.io/v1',
    headers: { access_token: token },
  })

  console.log('Consultando /taxes.json...')
  const res = await client.get('/taxes.json', { params: { limit: 50 } })
  const items = res.data?.items || []
  console.log(`Total: ${res.data?.count}`)
  for (const t of items) {
    console.log(`  id=${t.id}  name="${t.name}"  percentage=${t.percentage ?? '-'}  forBuy=${t.forBuy ?? '-'}  forSell=${t.forSell ?? '-'}  forAllProducts=${t.forAllProducts ?? '-'}`)
  }
  await prisma.$disconnect()
}
run().catch((e) => {
  console.error('Error:', e?.response?.data || e?.message || e)
  process.exit(1)
})
