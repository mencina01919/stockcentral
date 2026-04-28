import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { UpdateInventoryDto, StockMovementDto, InventoryQueryDto } from './dto/inventory.dto'
import { SyncService } from '../sync/sync.service'

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name)

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => SyncService)) private syncService: SyncService,
  ) {}

  // Encolar push de stock a todos los marketplaces vinculados al producto.
  // Llamado tras cambios de inventario o movimientos.
  private async pushStockToMarketplaces(tenantId: string, productId: string, totalStock: number) {
    const mappings = await this.prisma.marketplaceMapping.findMany({
      where: {
        productId,
        syncStatus: 'connected',
        marketplaceProductId: { not: null },
        connection: { syncEnabled: true, status: 'connected' },
      },
      include: { connection: true },
    })

    for (const m of mappings) {
      try {
        await this.syncService.enqueueStockSync(
          tenantId,
          m.connectionId,
          productId,
          m.marketplaceProductId!,
          totalStock,
        )
      } catch (err: any) {
        this.logger.error(`Failed to enqueue stock sync ${productId}@${m.connectionId}: ${err.message}`)
      }
    }
  }

  private async totalStockForProduct(tenantId: string, productId: string): Promise<number> {
    const agg = await this.prisma.inventory.aggregate({
      where: { tenantId, productId, warehouse: { type: 'physical' } },
      _sum: { quantity: true, reservedQuantity: true },
    })
    const qty = agg._sum.quantity || 0
    const reserved = agg._sum.reservedQuantity || 0
    return Math.max(0, qty - reserved)
  }

  async findAll(tenantId: string, query: InventoryQueryDto) {
    const { page = 1, limit = 20, search, lowStock, warehouseId } = query
    const skip = (page - 1) * limit

    // Inventario solo muestra stock maestro — bodegas físicas, no marketplaces.
    // Marketplaces consumen este stock vía sync, no se contabilizan aparte.
    const where: any = {
      tenantId,
      warehouse: { type: 'physical' },
    }
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

    // Push stock al/los marketplace(s) vinculados (fire-and-forget).
    const total = await this.totalStockForProduct(tenantId, inventory.productId)
    await this.pushStockToMarketplaces(tenantId, inventory.productId, total)

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

    const total = await this.totalStockForProduct(tenantId, inventory.productId)
    await this.pushStockToMarketplaces(tenantId, inventory.productId, total)

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
