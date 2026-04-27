import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateProductDto, UpdateProductDto, ProductQueryDto } from './dto/product.dto'

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, query: ProductQueryDto) {
    const { page = 1, limit = 20, search, status, sortBy = 'createdAt', sortOrder = 'desc' } = query
    const skip = (page - 1) * limit

    const where: any = { tenantId }
    if (status) where.status = status
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
    await this.findOne(tenantId, id)
    return this.prisma.product.update({ where: { id }, data: dto })
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
}
