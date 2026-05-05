/**
 * Script temporal para inspeccionar la API de ML.
 * Ejecutar: npx ts-node -e "require('./src/scripts/ml-inspect')"
 * o pegar en un endpoint temporal.
 */
import axios from 'axios'

const TOKEN = 'ACL4bXCIAw7KSARAINmATs7rsrxWURqE'
const ML = 'https://api.mercadolibre.com'

async function main() {
  const client = axios.create({ baseURL: ML, headers: { Authorization: `Bearer ${TOKEN}` } })

  // 1. User info
  const user = await client.get('/users/me')
  console.log('\n=== USER ===')
  console.log(JSON.stringify({ id: user.data.id, nickname: user.data.nickname, site_id: user.data.site_id }, null, 2))

  // 2. Top categories MLC
  const cats = await client.get('/sites/MLC/categories')
  console.log('\n=== CATEGORIES MLC ===')
  console.log(JSON.stringify(cats.data.slice(0, 5), null, 2))

  // 3. Listing types
  const lt = await client.get('/sites/MLC/listing_types')
  console.log('\n=== LISTING TYPES ===')
  console.log(JSON.stringify(lt.data, null, 2))

  // 4. Required fields for a category (Celulares y Smartphones = MLC1051)
  const attrs = await client.get('/categories/MLC1051/attributes')
  const required = attrs.data.filter((a: any) => a.tags?.required || a.tags?.catalog_required)
  console.log('\n=== REQUIRED ATTRS FOR MLC1051 (Celulares) ===')
  console.log(JSON.stringify(required.map((a: any) => ({ id: a.id, name: a.name, type: a.value_type, required: a.tags })), null, 2))

  // 5. Try to post a minimal item to see what fields ML requires
  try {
    await client.post('/items', {
      title: 'Test',
      category_id: 'MLC1051',
      price: 1000,
      currency_id: 'CLP',
      available_quantity: 1,
      buying_mode: 'buy_it_now',
      listing_type_id: 'gold_special',
      condition: 'new',
    })
  } catch (err: any) {
    console.log('\n=== POST /items ERROR (expected — shows required fields) ===')
    console.log(JSON.stringify(err?.response?.data, null, 2))
  }
}

main().catch(console.error)
