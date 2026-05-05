import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import {
  CreateWarehouseDto,
  UpdateWarehouseDto,
  StockTransferDto,
  WarehouseQueryDto,
  WarehouseType,
} from './dto/warehouse.dto'

@Injectable()
export class WarehousesService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, query: WarehouseQueryDto) {
    const where: any = { tenantId }
    if (query.warehouseType) where.warehouseType = query.warehouseType
    if (query.active !== undefined) where.active = query.active
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' }

    const warehouses = await this.prisma.warehouse.findMany({
      where,
      include: {
        _count: { select: { inventory: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { warehouseType: 'asc' }, { name: 'asc' }],
    })

    return warehouses
  }

  async findOne(tenantId: string, id: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id, tenantId },
      include: {
        inventory: {
          include: {
            product: { select: { id: true, name: true, sku: true, images: true } },
            variant: true,
          },
          orderBy: { updatedAt: 'desc' },
        },
      },
    })
    if (!warehouse) throw new NotFoundException('Bodega no encontrada')
    return warehouse
  }

  async create(tenantId: string, dto: CreateWarehouseDto) {
    if (dto.warehouseType !== WarehouseType.CUSTOM) {
      const existing = await this.prisma.warehouse.findFirst({
        where: { tenantId, warehouseType: dto.warehouseType, isDefault: true },
      })
      if (existing) {
        throw new ConflictException(
          `Ya existe una bodega predeterminada de tipo "${dto.warehouseType}". Solo se permiten múltiples bodegas del tipo "custom".`,
        )
      }
    }

    return this.prisma.warehouse.create({
      data: {
        tenantId,
        name: dto.name,
        warehouseType: dto.warehouseType ?? WarehouseType.CUSTOM,
        type: 'physical',
        address: dto.address,
        isDefault: dto.warehouseType !== WarehouseType.CUSTOM,
        active: true,
      },
    })
  }

  async update(tenantId: string, id: string, dto: UpdateWarehouseDto) {
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id, tenantId } })
    if (!warehouse) throw new NotFoundException('Bodega no encontrada')

    if (dto.isDefault && !warehouse.isDefault) {
      await this.prisma.warehouse.updateMany({
        where: { tenantId, warehouseType: warehouse.warehouseType, isDefault: true },
        data: { isDefault: false },
      })
    }

    return this.prisma.warehouse.update({
      where: { id },
      data: {
        name: dto.name,
        address: dto.address,
        active: dto.active,
        isDefault: dto.isDefault,
      },
    })
  }

  async deactivate(tenantId: string, id: string) {
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id, tenantId } })
    if (!warehouse) throw new NotFoundException('Bodega no encontrada')
    if (warehouse.isDefault) {
      throw new BadRequestException('No se puede desactivar una bodega predeterminada')
    }

    const hasStock = await this.prisma.inventory.findFirst({
      where: { warehouseId: id, quantity: { gt: 0 } },
    })
    if (hasStock) {
      throw new BadRequestException(
        'No se puede desactivar una bodega con stock. Transfiera el stock primero.',
      )
    }

    return this.prisma.warehouse.update({ where: { id }, data: { active: false } })
  }

  async transfer(tenantId: string, dto: StockTransferDto, userId: string) {
    const [from, to] = await Promise.all([
      this.prisma.warehouse.findFirst({ where: { id: dto.fromWarehouseId, tenantId, active: true } }),
      this.prisma.warehouse.findFirst({ where: { id: dto.toWarehouseId, tenantId, active: true } }),
    ])

    if (!from) throw new NotFoundException('Bodega de origen no encontrada o inactiva')
    if (!to) throw new NotFoundException('Bodega de destino no encontrada o inactiva')
    if (from.id === to.id) throw new BadRequestException('Las bodegas de origen y destino no pueden ser la misma')

    const product = await this.prisma.product.findFirst({ where: { id: dto.productId, tenantId } })
    if (!product) throw new NotFoundException('Producto no encontrado')

    const sourceInventory = await this.prisma.inventory.findFirst({
      where: {
        tenantId,
        productId: dto.productId,
        warehouseId: dto.fromWarehouseId,
        variantId: dto.variantId ?? null,
      },
    })

    if (!sourceInventory || sourceInventory.quantity < dto.quantity) {
      throw new BadRequestException('Stock insuficiente en la bodega de origen')
    }

    const destInventory = await this.prisma.inventory.findFirst({
      where: {
        tenantId,
        productId: dto.productId,
        warehouseId: dto.toWarehouseId,
        variantId: dto.variantId ?? null,
      },
    })

    await this.prisma.$transaction(async (tx) => {
      await tx.inventory.update({
        where: { id: sourceInventory.id },
        data: { quantity: { decrement: dto.quantity } },
      })

      await tx.stockMovement.create({
        data: {
          inventoryId: sourceInventory.id,
          type: 'transfer',
          quantity: dto.quantity,
          reason: dto.reason ?? 'Transferencia entre bodegas',
          reference: dto.reference,
          userId,
        },
      })

      if (destInventory) {
        await tx.inventory.update({
          where: { id: destInventory.id },
          data: { quantity: { increment: dto.quantity } },
        })
        await tx.stockMovement.create({
          data: {
            inventoryId: destInventory.id,
            type: 'in',
            quantity: dto.quantity,
            reason: dto.reason ?? 'Transferencia entre bodegas',
            reference: dto.reference,
            userId,
          },
        })
      } else {
        const created = await tx.inventory.create({
          data: {
            tenantId,
            productId: dto.productId,
            variantId: dto.variantId ?? null,
            warehouseId: dto.toWarehouseId,
            quantity: dto.quantity,
          },
        })
        await tx.stockMovement.create({
          data: {
            inventoryId: created.id,
            type: 'in',
            quantity: dto.quantity,
            reason: dto.reason ?? 'Transferencia entre bodegas',
            reference: dto.reference,
            userId,
          },
        })
      }

      await tx.stockTransfer.create({
        data: {
          tenantId,
          fromWarehouseId: dto.fromWarehouseId,
          toWarehouseId: dto.toWarehouseId,
          productId: dto.productId,
          variantId: dto.variantId ?? null,
          quantity: dto.quantity,
          reason: dto.reason,
          reference: dto.reference,
          userId,
          status: 'completed',
        },
      })
    })

    return { success: true, message: `Transferencia de ${dto.quantity} unidades completada` }
  }

  async getTransfers(tenantId: string, warehouseId?: string) {
    const where: any = { tenantId }
    if (warehouseId) {
      where.OR = [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }]
    }

    return this.prisma.stockTransfer.findMany({
      where,
      include: {
        fromWarehouse: { select: { id: true, name: true, warehouseType: true } },
        toWarehouse: { select: { id: true, name: true, warehouseType: true } },
        product: { select: { id: true, name: true, sku: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  }

  async ensureDefaultWarehouses(tenantId: string) {
    const defaults = [
      { name: 'Stock Online', warehouseType: WarehouseType.ONLINE },
      { name: 'Bodega Principal', warehouseType: WarehouseType.WAREHOUSE },
      { name: 'Tienda', warehouseType: WarehouseType.STORE },
    ]

    for (const def of defaults) {
      const exists = await this.prisma.warehouse.findFirst({
        where: { tenantId, warehouseType: def.warehouseType, isDefault: true },
      })
      if (!exists) {
        await this.prisma.warehouse.create({
          data: {
            tenantId,
            name: def.name,
            warehouseType: def.warehouseType,
            type: 'physical',
            isDefault: true,
            active: true,
          },
        })
      }
    }
  }
}
