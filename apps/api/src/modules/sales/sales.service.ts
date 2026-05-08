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
      sortBy = 'createdAt',
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
    if (search) {
      where.OR = [
        { saleNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { externalGroupId: { contains: search, mode: 'insensitive' } },
        { billingDocNumber: { contains: search, mode: 'insensitive' } },
      ]
    }

    let [data, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
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
