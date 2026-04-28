import axios from 'axios'
import { PrismaClient } from '@prisma/client'

const ML_API = 'https://api.mercadolibre.com'
const prisma = new PrismaClient()

const CONNECTION_ID = process.env.CONNECTION_ID
if (!CONNECTION_ID) {
  console.error('Missing CONNECTION_ID env')
  process.exit(1)
}

async function main() {
  const conn = await prisma.connection.findUnique({ where: { id: CONNECTION_ID } })
  if (!conn) throw new Error('Connection not found')

  const cred = conn.credentials as Record<string, string>
  const cfg = conn.config as Record<string, string>

  if (!cred.refreshToken) throw new Error('No refreshToken on connection')
  if (!cfg.clientId || !cfg.clientSecret) throw new Error('No clientId/clientSecret in config')

  console.log('Refreshing ML token…')
  const res = await axios.post(`${ML_API}/oauth/token`, {
    grant_type: 'refresh_token',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: cred.refreshToken,
  })

  const newCred = {
    ...cred,
    accessToken: res.data.access_token,
    refreshToken: res.data.refresh_token,
  }
  const newCfg = {
    ...cfg,
    tokenExpiresAt: new Date(Date.now() + res.data.expires_in * 1000).toISOString(),
  }

  await prisma.connection.update({
    where: { id: CONNECTION_ID },
    data: { credentials: newCred as any, config: newCfg as any, status: 'connected', lastError: null },
  })

  console.log('Token refreshed. Expires:', newCfg.tokenExpiresAt)
}

main()
  .catch((err) => {
    console.error('Refresh failed:', err?.response?.data || err.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
