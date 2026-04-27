import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { UpdateInventoryDto, StockMovementDto, InventoryQueryDto } from './dto/inventory.dto'

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, query: InventoryQueryDto) {
    const { page = 1, limit = 20, search, lowStock, warehouseId } = query
    const skip = (page - 1) * limit

    const where: any = { tenantId }
    if (warehouseId) where.warehouseId = warehouseId
    if (search) {
      where.product = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
        ],
      }
    }

    const inventory = await this.prisma.inventory.findMany({
      where,
      skip,
      take: limit,
      include: {
        product: { select: { id: true, name: true, sku: true, status: true, images: true } },
        variant: true,
        warehouse: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })

    const enriched = inventory.map((item) => ({
      ...item,
      availableQuantity: item.quantity - item.reservedQuantity,
      isLowStock: item.quantity <= item.minStock,
      isOutOfStock: item.quantity === 0,
    }))

    const filtered = lowStock === 'true' ? enriched.filter((i) => i.isLowStock) : enriched
    const total = await this.prisma.inventory.count({ where })

    return {
      data: filtered,
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

  async findByProduct(tenantId: string, productId: string) {
    return this.prisma.inventory.findMany({
      where: { tenantId, productId },
      include: {
        product: true,
        variant: true,
        warehouse: true,
        movements: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    })
  }

  async update(tenantId: string, inventoryId: string, dto: UpdateInventoryDto, userId: string) {
    const inventory = await this.prisma.inventory.findFirst({
      where: { id: inventoryId, tenantId },
    })
    if (!inventory) throw new NotFoundException('Inventario no encontrado')

    const diff = dto.quantity - inventory.quantity
    const type = diff > 0 ? 'in' : diff < 0 ? 'out' : 'adjustment'

    const [updated] = await this.prisma.$transaction([
      this.prisma.inventory.update({
        where: { id: inventoryId },
        data: { quantity: dto.quantity },
      }),
      this.prisma.stockMovement.create({
        data: {
          inventoryId,
          type,
          quantity: Math.abs(diff),
          reason: dto.reason || 'Ajuste manual',
          userId,
        },
      }),
    ])

    return updated
  }

  async createMovement(tenantId: string, dto: StockMovementDto, userId: string) {
    const inventory = await this.prisma.inventory.findFirst({
      where: { id: dto.inventoryId, tenantId },
    })
    if (!inventory) throw new NotFoundException('Inventario no encontrado')

    if (dto.type === 'out' && inventory.quantity < dto.quantity) {
      throw new BadRequestException('Stock insuficiente')
    }

    const quantityChange = dto.type === 'in' ? dto.quantity : -dto.quantity

    const [movement] = await this.prisma.$transaction([
      this.prisma.stockMovement.create({
        data: {
          inventoryId: dto.inventoryId,
          type: dto.type,
          quantity: dto.quantity,
          reason: dto.reason,
          reference: dto.reference,
          userId,
        },
      }),
      this.prisma.inventory.update({
        where: { id: dto.inventoryId },
        data: { quantity: { increment: quantityChange } },
      }),
    ])

    return movement
  }

  async getMovements(tenantId: string, inventoryId: string) {
    const inventory = await this.prisma.inventory.findFirst({ where: { id: inventoryId, tenantId } })
    if (!inventory) throw new NotFoundException('Inventario no encontrado')

    return this.prisma.stockMovement.findMany({
      where: { inventoryId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  }

  async getLowStockAlerts(tenantId: string) {
    const items = await this.prisma.inventory.findMany({
      where: { tenantId },
      include: { product: { select: { name: true, sku: true } }, warehouse: { select: { name: true } } },
    })

    return items
      .filter((i) => i.quantity <= i.minStock)
      .map((i) => ({
        ...i,
        availableQuantity: i.quantity - i.reservedQuantity,
        isOutOfStock: i.quantity === 0,
      }))
  }
}
