import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateOrderDto, UpdateOrderStatusDto, OrderQueryDto } from './dto/order.dto'

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['fulfilled', 'cancelled'],
  fulfilled: ['completed'],
  completed: [],
  cancelled: [],
}

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, query: OrderQueryDto) {
    const { page = 1, limit = 20, search, status, source, sourceChannel, sortBy = 'createdAt', sortOrder = 'desc' } = query
    const skip = (page - 1) * limit
    const where: any = { tenantId }

    if (status) where.status = status
    if (source) where.source = source
    if (sourceChannel) where.sourceChannel = sourceChannel
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: { items: true },
      }),
      this.prisma.order.count({ where }),
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
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: { items: true },
    })
    if (!order) throw new NotFoundException('Orden no encontrada')
    return order
  }

  async create(tenantId: string, dto: CreateOrderDto) {
    const count = await this.prisma.order.count({ where: { tenantId } })
    const orderNumber = `ORD-${String(count + 1).padStart(6, '0')}`

    return this.prisma.order.create({
      data: {
        tenantId,
        orderNumber,
        source: dto.source,
        sourceChannel: dto.sourceChannel,
        externalOrderId: dto.externalOrderId,
        customerName: dto.customerName,
        customerEmail: dto.customerEmail,
        customerPhone: dto.customerPhone,
        subtotal: dto.subtotal,
        total: dto.total,
        currency: dto.currency || 'CLP',
        notes: dto.notes,
        items: { create: dto.items },
      },
      include: { items: true },
    })
  }

  async updateStatus(tenantId: string, id: string, dto: UpdateOrderStatusDto) {
    const order = await this.findOne(tenantId, id)
    const allowed = VALID_TRANSITIONS[order.status] || []

    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `No se puede cambiar de "${order.status}" a "${dto.status}"`,
      )
    }

    return this.prisma.order.update({
      where: { id },
      data: { status: dto.status },
    })
  }

  async cancel(tenantId: string, id: string, reason?: string) {
    return this.updateStatus(tenantId, id, { status: 'cancelled', reason })
  }

  async advance(tenantId: string, id: string) {
    const order = await this.findOne(tenantId, id)
    const nextMap: Record<string, string> = {
      pending: 'confirmed',
      confirmed: 'processing',
      processing: 'fulfilled',
      fulfilled: 'completed',
    }
    const next = nextMap[order.status]
    if (!next) throw new BadRequestException(`Cannot advance order from status '${order.status}'`)
    return this.updateStatus(tenantId, id, { status: next })
  }

  async getStats(tenantId: string) {
    const today = new Date()
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

    const [total, pending, processing, completed, cancelled, monthlyRevenue] = await Promise.all([
      this.prisma.order.count({ where: { tenantId } }),
      this.prisma.order.count({ where: { tenantId, status: 'pending' } }),
      this.prisma.order.count({ where: { tenantId, status: 'processing' } }),
      this.prisma.order.count({ where: { tenantId, status: 'completed' } }),
      this.prisma.order.count({ where: { tenantId, status: 'cancelled' } }),
      this.prisma.order.aggregate({
        where: { tenantId, createdAt: { gte: startOfMonth }, status: { not: 'cancelled' } },
        _sum: { total: true },
      }),
    ])

    return {
      total,
      pending,
      processing,
      completed,
      cancelled,
      monthlyRevenue: Number(monthlyRevenue._sum.total || 0),
    }
  }
}
