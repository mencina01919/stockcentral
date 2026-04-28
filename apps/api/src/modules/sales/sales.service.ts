import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { SaleQueryDto } from './dto/sale.dto'

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, query: SaleQueryDto) {
    const { page = 1, limit = 20, search, status, source, sortBy = 'createdAt', sortOrder = 'desc' } = query
    const skip = (page - 1) * limit
    const where: any = { tenantId }

    if (status) where.status = status
    if (source) where.source = source
    if (search) {
      where.OR = [
        { saleNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { externalGroupId: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [data, total] = await Promise.all([
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
              total: true,
              sourceChannel: true,
            },
          },
        },
      }),
      this.prisma.sale.count({ where }),
    ])

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
