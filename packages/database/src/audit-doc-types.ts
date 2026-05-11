// Audita TaxDocuments emitidos: por tipo + invoiceType de la sale + si tienen
// BUSINESS_NAME/ECONOMIC_ACTIVITY en billing. Sirve para detectar boletas
// emitidas como factura por bug en decisión, o al revés.
import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  const docs = await prisma.taxDocument.findMany({
    where: { emitter: 'bsale', status: 'issued' },
    include: {
      sale: {
        select: {
          saleNumber: true,
          invoiceType: true,
          billingName: true,
          billingDocNumber: true,
          economicActivity: true,
          customerName: true,
          customerDocNumber: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  console.log(`Total docs emitidos (últimos 50): ${docs.length}`)
  console.log()

  let boletasOK = 0
  let facturasOK = 0
  let boletasMalcasFactura = 0 // doc=factura pero sale.invoiceType=boleta o vacío
  let facturasMalCasBoleta = 0 // doc=boleta pero sale.invoiceType=factura

  for (const d of docs) {
    const sale = d.sale
    const docType = d.type
    const saleType = sale?.invoiceType || '(null)'
    const hasBN = !!sale?.billingName
    const hasEA = !!sale?.economicActivity
    const docTime = d.createdAt.toISOString().replace('T', ' ').slice(0, 19)

    let flag = ''
    if (docType === 'factura' && saleType !== 'factura') {
      flag = ' ⚠ FACTURA emitida cuando sale.invoiceType=' + saleType
      boletasMalcasFactura++
    } else if (docType === 'boleta' && saleType === 'factura') {
      flag = ' ⚠ BOLETA emitida cuando sale.invoiceType=factura'
      facturasMalCasBoleta++
    } else if (docType === 'factura') {
      facturasOK++
    } else if (docType === 'boleta') {
      boletasOK++
    }

    console.log(
      `${docTime} folio=${(d.folio || '-').padEnd(8)} ${docType.padEnd(8)} sale=${sale?.saleNumber || '-'} saleType=${saleType.padEnd(8)} billingName=${(sale?.billingName || '-').slice(0, 22).padEnd(22)} EA=${hasEA ? 'sí' : 'no'}${flag}`,
    )
  }

  console.log()
  console.log('--- Resumen ---')
  console.log(`Boletas correctas: ${boletasOK}`)
  console.log(`Facturas correctas: ${facturasOK}`)
  console.log(`⚠ Facturas emitidas para boletas: ${boletasMalcasFactura}`)
  console.log(`⚠ Boletas emitidas para facturas: ${facturasMalCasBoleta}`)

  await prisma.$disconnect()
}
run().catch((e) => { console.error(e?.message || e); process.exit(1) })
