import { PrismaClient } from '@prisma/client'
import axios from 'axios'

async function run() {
  const prisma = new PrismaClient()
  const conn = await prisma.connection.findFirst({ where: { provider: 'mercadolibre' } })
  if (!conn) { console.log('NO_ML_CONN'); process.exit(1) }
  const creds = (conn.credentials as any) || {}
  const cfg = (conn.config as any) || {}

  console.log('Token expires:', cfg.tokenExpiresAt)
  console.log()
  console.log('Probando llamada simple a /users/me...')
  try {
    const res = await axios.get('https://api.mercadolibre.com/users/me', {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
      timeout: 10000,
    })
    console.log('OK. nickname:', res.data.nickname, 'id:', res.data.id)
  } catch (err: any) {
    console.log('ERROR:', err?.response?.status, err?.response?.data?.message || err?.message)
  }

  console.log()
  console.log('Intentando refresh con refreshToken actual...')
  try {
    const res = await axios.post('https://api.mercadolibre.com/oauth/token', {
      grant_type: 'refresh_token',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: creds.refreshToken,
    })
    console.log('Refresh OK. expires_in:', res.data.expires_in)
  } catch (err: any) {
    console.log('Refresh ERROR:', err?.response?.status, JSON.stringify(err?.response?.data))
  }

  await prisma.$disconnect()
}
run().catch((e) => { console.error(e?.message); process.exit(1) })
