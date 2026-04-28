import Queue from 'bull'

const REDIS_HOST = process.env.REDIS_HOST || 'localhost'
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6380', 10)
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined

const TENANT_ID = process.env.TENANT_ID
const CONNECTION_ID = process.env.CONNECTION_ID
const DAYS = parseInt(process.env.DAYS || '7', 10)

if (!TENANT_ID || !CONNECTION_ID) {
  console.error('Missing TENANT_ID or CONNECTION_ID env')
  process.exit(1)
}

async function main() {
  const since = new Date(Date.now() - DAYS * 86400000)
  console.log(`Enqueue orders sync: tenant=${TENANT_ID} connection=${CONNECTION_ID} since=${since.toISOString()}`)

  const queue = new Queue('sync', {
    redis: { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD },
  })

  const job = await queue.add(
    'sync:orders:inbound',
    { tenantId: TENANT_ID, connectionId: CONNECTION_ID, since: since.toISOString() },
    { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
  )

  console.log(`Enqueued job ${job.id}`)
  await queue.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
