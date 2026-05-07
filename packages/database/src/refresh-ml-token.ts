// Refresca el access_token ML usando el refresh_token guardado.

import { PrismaClient } from '@prisma/client'
import axios from 'axios'

async function run() {
  const prisma = new PrismaClient()
  const conn = await prisma.connection.findFirst({ where: { provider: 'mercadolibre' } })
  if (!conn) { console.log('NO_ML_CONN'); process.exit(1) }
  const creds = (conn.credentials as any) || {}
  const cfg = (conn.config as any) || {}
  if (!creds.refreshToken) { console.log('NO_REFRESH_TOKEN'); process.exit(1) }
  if (!cfg.clientId || !cfg.clientSecret) {
    console.log('NO_CLIENT_CREDS_IN_CONFIG. Need clientId/clientSecret in config.')
    console.log('Config keys:', Object.keys(cfg))
    process.exit(1)
  }

  console.log('Refreshing ML token...')
  const res = await axios.post('https://api.mercadolibre.com/oauth/token', {
    grant_type: 'refresh_token',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: creds.refreshToken,
  })
  console.log('OK. expires_in:', res.data.expires_in)

  await prisma.connection.update({
    where: { id: conn.id },
    data: {
      credentials: {
        ...creds,
        accessToken: res.data.access_token,
        refreshToken: res.data.refresh_token || creds.refreshToken,
      } as any,
      status: 'connected',
      lastError: null,
    },
  })
  console.log('Updated connection.')
  await prisma.$disconnect()
}
run().catch((e) => { console.error(e?.response?.data || e?.message); process.exit(1) })
