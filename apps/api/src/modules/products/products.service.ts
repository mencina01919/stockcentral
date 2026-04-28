import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateProductDto, UpdateProductDto, ProductQueryDto } from './dto/product.dto'
import { getDriver } from '@stockcentral/integrations'

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, query: ProductQueryDto & { connectionId?: string }) {
    const { page = 1, limit = 20, search, status, connectionId, sortBy = 'createdAt', sortOrder = 'desc' } = query
    const skip = (page - 1) * limit

    const where: any = { tenantId }
    if (status) where.status = status
    if (connectionId) where.marketplaceMappings = { some: { connectionId } }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          variants: true,
          inventory: {
            include: { warehouse: { select: { name: true } } },
          },
          _count: { select: { marketplaceMappings: true } },
        },
      }),
      this.prisma.product.count({ where }),
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
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
      include: {
        variants: true,
        inventory: { include: { warehouse: true } },
        marketplaceMappings: { include: { connection: true } },
      },
    })
    if (!product) throw new NotFoundException('Producto no encontrado')
    return product
  }

  async create(tenantId: string, dto: CreateProductDto) {
    const existing = await this.prisma.product.findUnique({
      where: { tenantId_sku: { tenantId, sku: dto.sku } },
    })
    if (existing) throw new ConflictException(`El SKU "${dto.sku}" ya existe`)

    const product = await this.prisma.product.create({
      data: { ...dto, tenantId },
    })

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { tenantId, active: true },
    })

    if (warehouse) {
      await this.prisma.inventory.create({
        data: {
          tenantId,
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: 0,
        },
      })
    }

    return product
  }

  async update(tenantId: string, id: string, dto: UpdateProductDto) {
    const product = await this.findOne(tenantId, id)

    const { stock, ...productFields } = dto

    const updated = await this.prisma.product.update({ where: { id }, data: productFields })

    if (stock !== undefined) {
      const inv = await this.prisma.inventory.findFirst({ where: { productId: id, variantId: null } })
      if (inv) {
        await this.prisma.inventory.update({ where: { id: inv.id }, data: { quantity: stock } })
      } else {
        const warehouse = await this.prisma.warehouse.findFirst({ where: { tenantId, active: true } })
        if (warehouse) {
          await this.prisma.inventory.create({ data: { tenantId, productId: id, warehouseId: warehouse.id, quantity: stock, reservedQuantity: 0 } })
        }
      }
    }

    return this.findOne(tenantId, id)
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id)
    await this.prisma.product.update({
      where: { id },
      data: { status: 'archived' },
    })
    return { message: 'Producto archivado correctamente' }
  }

  async getStats(tenantId: string) {
    const [total, active, draft, archived] = await Promise.all([
      this.prisma.product.count({ where: { tenantId } }),
      this.prisma.product.count({ where: { tenantId, status: 'active' } }),
      this.prisma.product.count({ where: { tenantId, status: 'draft' } }),
      this.prisma.product.count({ where: { tenantId, status: 'archived' } }),
    ])
    return { total, active, draft, archived }
  }

  // ─── Marketplace mappings ──────────────────────────────────────────────────

  async marketplaceStatus(tenantId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      include: {
        marketplaceMappings: {
          include: { connection: { select: { id: true, provider: true, name: true } } },
        },
      },
    })
    if (!product) throw new NotFoundException('Producto no encontrado')

    const connections = await this.prisma.connection.findMany({
      where: { tenantId, type: { in: ['marketplace', 'ecommerce'] } },
      select: { id: true, provider: true, name: true, status: true },
    })

    return connections.map((conn) => {
      const mapping = product.marketplaceMappings.find((m) => m.connectionId === conn.id)
      return {
        connectionId: conn.id,
        provider: conn.provider,
        connectionName: conn.name,
        connectionStatus: conn.status,
        linked: !!mapping,
        marketplaceProductId: mapping?.marketplaceProductId || null,
        syncStatus: mapping?.syncStatus || 'unlinked',
        errorMessage: mapping?.errorMessage || null,
        lastSyncAt: mapping?.lastSyncAt || null,
      }
    })
  }

  async detectMarketplace(tenantId: string, productId: string, connectionId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId } })
    if (!product) throw new NotFoundException('Producto no encontrado')

    const connection = await this.prisma.connection.findFirst({
      where: { id: connectionId, tenantId },
    })
    if (!connection) throw new NotFoundException('Conexión no encontrada')

    const driver = getDriver(connection.provider)
    if (!driver.findBySku) {
      throw new ConflictException(`El driver ${connection.provider} no soporta detección por SKU`)
    }

    const matches = await driver.findBySku(
      connection.credentials as Record<string, string>,
      product.sku,
      connection.config as Record<string, unknown> | undefined,
    )

    if (matches.length === 0) {
      // Mark as not_found for visibility, but don't create the mapping
      await this.prisma.marketplaceMapping.upsert({
        where: { productId_connectionId: { productId, connectionId } },
        update: { syncStatus: 'sku_not_found', errorMessage: `SKU "${product.sku}" no encontrado en ${connection.name}` },
        create: {
          productId,
          connectionId,
          syncStatus: 'sku_not_found',
          errorMessage: `SKU "${product.sku}" no encontrado en ${connection.name}`,
        },
      })
      return { matched: 0, status: 'sku_not_found' }
    }

    if (matches.length > 1) {
      await this.prisma.marketplaceMapping.upsert({
        where: { productId_connectionId: { productId, connectionId } },
        update: { syncStatus: 'sku_duplicate', errorMessage: `SKU "${product.sku}" duplicado en ${connection.name} (${matches.length} publicaciones)` },
        create: {
          productId,
          connectionId,
          syncStatus: 'sku_duplicate',
          errorMessage: `SKU "${product.sku}" duplicado en ${connection.name} (${matches.length} publicaciones)`,
        },
      })
      return { matched: matches.length, status: 'sku_duplicate', candidates: matches.map((m) => ({ id: m.externalId, title: m.title })) }
    }

    // Exactly 1 match — link it
    const m = matches[0]
    await this.prisma.marketplaceMapping.upsert({
      where: { productId_connectionId: { productId, connectionId } },
      update: {
        marketplaceProductId: m.externalId,
        marketplaceSku: m.externalSku || product.sku,
        marketplacePrice: m.price,
        syncStatus: 'connected',
        errorMessage: null,
        lastSyncAt: new Date(),
      },
      create: {
        productId,
        connectionId,
        marketplaceProductId: m.externalId,
        marketplaceSku: m.externalSku || product.sku,
        marketplacePrice: m.price,
        syncStatus: 'connected',
        lastSyncAt: new Date(),
      },
    })
    return { matched: 1, status: 'connected', marketplaceProductId: m.externalId, title: m.title }
  }

  async unlinkMarketplace(tenantId: string, productId: string, connectionId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId } })
    if (!product) throw new NotFoundException('Producto no encontrado')

    await this.prisma.marketplaceMapping.deleteMany({
      where: { productId, connectionId },
    })
    return { unlinked: true }
  }
}
