import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import {
  CreateOrderDto,
  UpdateOrderStatusDto,
  UpdateOrderInternalStatusDto,
  OrderQueryDto,
  INTERNAL_ORDER_STATUSES,
} from './dto/order.dto'

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['fulfilled', 'cancelled'],
  fulfilled: ['completed'],
  completed: [],
  cancelled: [],
}

// Internal-only fulfillment flow. Operators move orders through these states
// independently of any marketplace status.
const VALID_INTERNAL_TRANSITIONS: Record<string, string[]> = {
  new:                ['in_preparation', 'cancelled_internal'],
  in_preparation:     ['ready_to_ship', 'cancelled_internal'],
  ready_to_ship:      ['cancelled_internal'],
  cancelled_internal: [],
}

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, query: OrderQueryDto) {
    // Default: ordenar por la fecha real del marketplace (placedAt). Para
    // órdenes legacy sin placedAt, Prisma con `nulls: 'last'` las pone al
    // final.
    const { page = 1, limit = 20, search, status, internalStatus, source, sourceChannel, placedFrom, placedTo, sortBy = 'placedAt', sortOrder = 'desc' } = query
    const skip = (page - 1) * limit
    const where: any = { tenantId }

    if (status) where.status = status
    if (internalStatus) where.internalStatus = internalStatus
    if (source) where.source = source
    if (sourceChannel) where.sourceChannel = sourceChannel
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
      ]
    }
    // Filtro por fecha real del marketplace (placedAt). Fallback a createdAt
    // para órdenes legacy sin placedAt.
    if (placedFrom || placedTo) {
      const range: Record<string, Date> = {}
      if (placedFrom) range.gte = new Date(placedFrom)
      if (placedTo) {
        const to = new Date(placedTo)
        if (placedTo.length <= 10) {
          to.setUTCHours(23, 59, 59, 999)
        }
        range.lte = to
      }
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

    const orderBy: any =
      sortBy === 'placedAt'
        ? { placedAt: { sort: sortOrder, nulls: 'last' } }
        : { [sortBy]: sortOrder }

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy,
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

  async updateInternalStatus(tenantId: string, id: string, dto: UpdateOrderInternalStatusDto) {
    const order = await this.findOne(tenantId, id)

    if (!INTERNAL_ORDER_STATUSES.includes(dto.internalStatus as any)) {
      throw new BadRequestException(`Estado interno inválido: "${dto.internalStatus}"`)
    }

    const allowed = VALID_INTERNAL_TRANSITIONS[order.internalStatus] || []
    if (!allowed.includes(dto.internalStatus)) {
      throw new BadRequestException(
        `No se puede cambiar el estado interno de "${order.internalStatus}" a "${dto.internalStatus}"`,
      )
    }

    return this.prisma.order.update({
      where: { id },
      data: { internalStatus: dto.internalStatus },
    })
  }

  async advanceInternal(tenantId: string, id: string) {
    const order = await this.findOne(tenantId, id)
    const nextMap: Record<string, string> = {
      new: 'in_preparation',
      in_preparation: 'ready_to_ship',
    }
    const next = nextMap[order.internalStatus]
    if (!next) {
      throw new BadRequestException(
        `No se puede avanzar el estado interno desde "${order.internalStatus}"`,
      )
    }
    return this.updateInternalStatus(tenantId, id, { internalStatus: next as any })
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
