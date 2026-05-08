import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { SaleQueryDto } from './dto/sale.dto'

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, query: SaleQueryDto) {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      source,
      invoiceType,
      paymentStatus,
      multiOrder,
      pendingBilling,
      placedFrom,
      placedTo,
      // Por defecto ordenamos por la fecha real del marketplace (placedAt).
      // Para registros legacy sin placedAt, Prisma con `nulls: 'last'` los
      // pone al final. Si el caller pide otra cosa, se respeta.
      sortBy = 'placedAt',
      sortOrder = 'desc',
    } = query
    const skip = (page - 1) * limit
    const where: any = { tenantId }

    if (status) where.status = status
    if (source) where.source = source
    if (invoiceType) where.invoiceType = invoiceType
    if (paymentStatus) where.paymentStatus = paymentStatus
    if (multiOrder === 'true') {
      where.orders = { some: {} }
    }

    // Tab "Por facturar": ventas pagadas que aún NO tienen un documento
    // tributario emitido o en proceso. Excluye canceladas, huérfanas y
    // total=0 (defensa en profundidad — pueden venir mal del sync).
    if (pendingBilling === 'true') {
      where.paymentStatus = 'paid'
      where.status = { notIn: ['cancelled', 'canceled', 'failed'] }
      where.orders = { some: {} }
      where.total = { gt: 0 }
      where.taxDocuments = {
        none: {
          type: { in: ['boleta', 'factura'] },
          status: { in: ['issued', 'pending'] },
        },
      }
    }
    // Filtro por fecha real del marketplace. Caemos a `createdAt` como
    // fallback para sales legacy que aún no tienen placedAt seteado.
    if (placedFrom || placedTo) {
      const range: Record<string, Date> = {}
      if (placedFrom) range.gte = new Date(placedFrom)
      if (placedTo) {
        // Si solo viene la fecha sin hora, incluir todo el día final.
        const to = new Date(placedTo)
        if (placedTo.length <= 10) {
          to.setUTCHours(23, 59, 59, 999)
        }
        range.lte = to
      }
      // AND con un OR interno: filtra placedAt si existe, o createdAt si la
      // sale es legacy (placedAt null). Usar AND evita colisión con el OR
      // de búsqueda más abajo.
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { placedAt: range },
            { AND: [{ placedAt: null }, { createdAt: range }] },
          ],
        },
      ]
    }
    if (search) {
      where.OR = [
        { saleNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { externalGroupId: { contains: search, mode: 'insensitive' } },
        { billingDocNumber: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Para sortBy=placedAt (default) usamos `nulls: 'last'` para que las
    // ventas legacy sin placedAt queden al final del listado, no al principio.
    // Para otros campos no-nullables, sortOrder simple.
    const orderBy: any =
      sortBy === 'placedAt'
        ? { placedAt: { sort: sortOrder, nulls: 'last' } }
        : { [sortBy]: sortOrder }

    let [data, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          orders: {
            select: {
              id: true,
              orderNumber: true,
              externalOrderId: true,
              status: true,
              internalStatus: true,
              total: true,
              sourceChannel: true,
            },
          },
          // Traemos los DTE para que la UI sepa si la venta ya está facturada
          // y desactive selección/emisión.
          taxDocuments: {
            select: { id: true, type: true, status: true, folio: true },
            where: { status: { in: ['issued', 'pending'] } },
          },
        },
      }),
      this.prisma.sale.count({ where }),
    ])

    if (multiOrder === 'true') {
      data = data.filter((s) => (s.orders?.length || 0) > 1)
    }

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    }
  }

  async findOne(tenantId: string, id: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id, tenantId },
      include: {
        orders: {
          include: { items: true },
          orderBy: { createdAt: 'asc' },
        },
        // Incluimos los documentos tributarios para que el modal de detalle
        // pueda mostrar acciones contextuales (emitir, convertir, NC, links).
        taxDocuments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            status: true,
            folio: true,
            externalId: true,
            pdfUrl: true,
            xmlUrl: true,
            emittedAt: true,
            lastError: true,
            metadata: true,
          },
        },
      },
    })
    if (!sale) throw new NotFoundException('Venta no encontrada')
    return sale
  }

  async getStats(tenantId: string) {
    const today = new Date()
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

    const [total, pending, completed, cancelled, monthlyRevenue] = await Promise.all([
      this.prisma.sale.count({ where: { tenantId } }),
      this.prisma.sale.count({ where: { tenantId, status: 'pending' } }),
      this.prisma.sale.count({ where: { tenantId, status: 'completed' } }),
      this.prisma.sale.count({ where: { tenantId, status: 'cancelled' } }),
      this.prisma.sale.aggregate({
        where: { tenantId, createdAt: { gte: startOfMonth }, status: { not: 'cancelled' } },
        _sum: { total: true },
      }),
    ])

    return {
      total,
      pending,
      completed,
      cancelled,
      monthlyRevenue: Number(monthlyRevenue._sum.total || 0),
    }
  }
}
