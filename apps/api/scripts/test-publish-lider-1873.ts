/* eslint-disable */
// Smoke test: publish SKU 1873 (Gabinete Lian Li LANCOOL 217) to Lider production
// via the LiderDriver. Logs the feed response and the feedStatus 8 seconds later
// (Walmart needs a few seconds to process the feed and report itemsReceived/markets).

import { PrismaClient } from '@prisma/client'
import { LiderDriver } from '../../../packages/integrations/src/drivers/lider.driver'

async function main() {
  const prisma = new PrismaClient()
  const driver = new LiderDriver()

  const conn = await prisma.connection.findFirst({ where: { provider: 'lider' } })
  if (!conn) throw new Error('no Lider connection')
  const credentials = conn.credentials as Record<string, string>
  const config = (conn.config as Record<string, unknown>) || {}

  const product = await prisma.product.findUnique({
    where: { id: '26a51e8e-aa1a-465b-be4d-250ae2756d3e' },
  })
  if (!product) throw new Error('product 1873 not found')

  const images = (product.images as string[] | null) || []
  if (images.length === 0) throw new Error('product has no images')

  const formData = {
    sku: product.sku,
    productType: 'Computer Components',
    productName: product.name,
    brand: 'Lian Li',
    price: Number(product.basePrice),
    shippingWeightValue: 7,
    shippingWeightUnit: 'KG',
    productIdType: 'UPC',
    productId: product.sku,
    shortDescription: (product.description || product.name).slice(0, 4000),
    mainImageUrl: images[0],
    fulfillmentLagTime: '1',
    multipackQuantity: '1',
    availableQuantity: 7,
  }

  const input: any = {
    sku: product.sku,
    title: product.name,
    description: product.description,
    price: Number(product.basePrice),
    images,
    formData,
  }

  console.log('▶ enviando feed a Lider…')
  const result = await driver.createProduct(credentials, input, config)
  console.log('\n— createProduct result —')
  console.log('success:', result.success)
  console.log('externalId:', result.externalId)
  console.log('error:', result.error)
  console.log('rawResponse:', JSON.stringify(result.rawResponse, null, 2))

  // Try to grab the feedId and then poll status once
  const feedId =
    (result.rawResponse as any)?.feedId ||
    (result.rawResponse as any)?.MPItemFeedAcknowledgement?.feedId
  if (feedId) {
    console.log('\n⏳ esperando 8s para consultar feed status…')
    await new Promise((r) => setTimeout(r, 8000))
    const axios = (await import('axios')).default
    // Reuse driver auth pipeline: tap into a fresh client by calling a known driver method
    // (we want WM_SEC.ACCESS_TOKEN). Easiest: re-implement a thin auth here.
    const TOKEN_URL = 'https://marketplace.walmartapis.com/v3/token'
    const { randomUUID } = await import('crypto')
    const encoded = Buffer.from(
      `${credentials.clientId}:${credentials.clientSecret}`,
    ).toString('base64')
    const tokenRes = await axios.post(TOKEN_URL, 'grant_type=client_credentials', {
      headers: {
        Authorization: `Basic ${encoded}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        WM_MARKET: 'cl',
        'WM_SVC.NAME': 'Walmart Marketplace',
        'WM_QOS.CORRELATION_ID': randomUUID(),
        Accept: 'application/json',
      },
    })
    const accessToken =
      (tokenRes.data as any).access_token ||
      (tokenRes.data as any).accessToken
    const statusRes = await axios.get(
      `https://marketplace.walmartapis.com/v3/feeds/${feedId}?includeDetails=true`,
      {
        headers: {
          Authorization: `Basic ${encoded}`,
          'WM_SEC.ACCESS_TOKEN': accessToken,
          WM_MARKET: 'cl',
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': randomUUID(),
          Accept: 'application/json',
        },
      },
    )
    console.log('\n— feed status —')
    console.log(JSON.stringify(statusRes.data, null, 2))
  } else {
    console.log('\n(no feedId returned — nothing to poll)')
  }

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
