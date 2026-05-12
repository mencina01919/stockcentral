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
  // Encola sync de stock hacia cada marketplace vinculado del producto.
  // skipConnectionId permite excluir uno (típicamente el que originó una
  // venta — ese sistema ya descontó por su lado).
  private async pushStockToMarketplaces(
    tenantId: string,
    productId: string,
    totalStock: number,
    skipConnectionId?: string,
  ) {
    const mappings = await this.prisma.marketplaceMapping.findMany({
      where: {
        productId,
        syncStatus: { in: ['connected', 'success', 'error'] },
        marketplaceProductId: { not: null },
        connection: { syncEnabled: true, status: 'connected', isCatalogSource: false },
        ...(skipConnectionId ? { connectionId: { not: skipConnectionId } } : {}),
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

  // Consumo de stock al recibir una orden desde un marketplace.
  // Se llama desde syncService.upsertOrderFromMarketplace cuando se crea
  // una orden nueva (no para updates de orden existente — Walmart no nos
  // avisa de cambios de qty, solo de status).
  //
  // Estrategia por item:
  //   1. Buscar producto local por SKU
  //   2. Descontar del warehouse 'online' (preferido) o el primero disponible
  //   3. Crear StockMovement tipo 'out' con la referencia de la orden
  //   4. Trigger sync hacia los OTROS marketplaces (excluye el originador
  //      del descuento — ese ya descontó por su lado al confirmar la venta)
  //
  // skipConnectionId: el marketplace que originó la orden — no le re-pushamos
  // stock porque su sistema ya descontó la unidad al cerrar la venta.
  async consumeStockForOrder(opts: {
    tenantId: string
    items: Array<{ sku: string; quantity: number }>
    orderReference: string  // ej. "ML#123456" para auditoría en StockMovement
    skipConnectionId?: string
  }): Promise<{ consumed: number; missing: string[] }> {
    let consumed = 0
    const missing: string[] = []

    for (const item of opts.items) {
      const sku = item.sku?.trim()
      if (!sku || !item.quantity) continue

      // Buscar producto local
      const product = await this.prisma.product.findFirst({
        where: { tenantId: opts.tenantId, sku },
        select: { id: true, sku: true },
      })
      if (!product) {
        missing.push(sku)
        continue
      }

      // Buscar inventory del warehouse online (preferido) o el primero disponible
      // que tenga stock suficiente.
      const inventories = await this.prisma.inventory.findMany({
        where: {
          tenantId: opts.tenantId,
          productId: product.id,
          variantId: null,
          warehouse: { warehouseType: { in: ['online', 'store'] } },
        },
        include: { warehouse: { select: { warehouseType: true } } },
        orderBy: { warehouse: { warehouseType: 'asc' } }, // 'online' antes que 'store'
      })

      // Preferir online; si no, agarra el primero con stock
      let target = inventories.find((i) => i.warehouse.warehouseType === 'online' && i.quantity >= item.quantity)
      if (!target) target = inventories.find((i) => i.quantity >= item.quantity)
      if (!target) {
        // No hay stock suficiente — descontamos del primero igual y dejamos
        // negativo (mejor sobreventa visible que silenciar el problema).
        target = inventories[0]
      }
      if (!target) {
        missing.push(`${sku} (sin inventory)`)
        continue
      }

      await this.prisma.$transaction([
        this.prisma.inventory.update({
          where: { id: target.id },
          data: { quantity: { decrement: item.quantity } },
        }),
        this.prisma.stockMovement.create({
          data: {
            inventoryId: target.id,
            type: 'out',
            quantity: item.quantity,
            reason: 'Venta marketplace',
            reference: opts.orderReference,
          },
        }),
      ])
      consumed++

      // Push stock a otros marketplaces (excluye el que originó la orden)
      const newTotal = await this.totalStockForProduct(opts.tenantId, product.id)
      await this.pushStockToMarketplaces(
        opts.tenantId,
        product.id,
        newTotal,
        opts.skipConnectionId,
      )
    }

    return { consumed, missing }
  }

  private async totalStockForProduct(tenantId: string, productId: string): Promise<number> {
    const agg = await this.prisma.inventory.aggregate({
      where: { tenantId, productId, warehouse: { warehouseType: { in: ['online', 'store'] } } },
      _sum: { quantity: true },
    })
    return agg._sum.quantity || 0
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
