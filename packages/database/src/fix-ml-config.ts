// Guarda clientId/clientSecret en Connection.config y refresca el access_token.

import { PrismaClient } from '@prisma/client'
import axios from 'axios'

const CLIENT_ID = process.argv[2]
const CLIENT_SECRET = process.argv[3]

async function run() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.log('Uso: ts-node fix-ml-config.ts <clientId> <clientSecret>')
    process.exit(1)
  }
  const prisma = new PrismaClient()
  const conn = await prisma.connection.findFirst({ where: { provider: 'mercadolibre' } })
  if (!conn) { console.log('NO_ML_CONN'); process.exit(1) }

  const creds = (conn.credentials as any) || {}
  const cfg = (conn.config as any) || {}

  // 1) Guardar clientId/clientSecret en config
  const newCfg = { ...cfg, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }

  // 2) Refresh token contra ML
  if (!creds.refreshToken) { console.log('NO_REFRESH_TOKEN'); process.exit(1) }
  console.log('Refreshing ML token con clientId nuevo...')
  let res
  try {
    res = await axios.post('https://api.mercadolibre.com/oauth/token', {
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: creds.refreshToken,
    })
    console.log('OK. expires_in:', res.data.expires_in, 'seconds')
  } catch (err: any) {
    console.error('Refresh failed:', err?.response?.data || err?.message)
    // Aún así guardamos clientId/clientSecret para que un futuro re-OAuth los tenga
    await prisma.connection.update({
      where: { id: conn.id },
      data: { config: newCfg as any },
    })
    console.log('Saved clientId/clientSecret. Token NOT refreshed — necesitas re-OAuth.')
    process.exit(1)
  }

  const expiresAt = new Date(Date.now() + res.data.expires_in * 1000)

  await prisma.connection.update({
    where: { id: conn.id },
    data: {
      credentials: {
        ...creds,
        accessToken: res.data.access_token,
        refreshToken: res.data.refresh_token || creds.refreshToken,
      } as any,
      config: { ...newCfg, tokenExpiresAt: expiresAt.toISOString() } as any,
      status: 'connected',
      lastError: null,
    },
  })
  console.log(`Connection updated. Token expira en ${expiresAt.toISOString()}`)
  await prisma.$disconnect()
}
run().catch((e) => { console.error(e?.response?.data || e?.message); process.exit(1) })
