import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { getDriver } from '@stockcentral/integrations'
import { PublishProductDto } from './dto/publication.dto'
import { MARKETPLACE_FORMS } from './publications.forms'

@Injectable()
export class PublicationsService {
  private readonly logger = new Logger(PublicationsService.name)

  constructor(private prisma: PrismaService) {}

  getFormSchema(provider: string) {
    const schema = MARKETPLACE_FORMS[provider.toLowerCase()]
    if (!schema) throw new NotFoundException(`No existe formulario para el proveedor "${provider}"`)
    return schema
  }

  getAllFormSchemas() {
    return Object.values(MARKETPLACE_FORMS)
  }

  async getProductPublications(tenantId: string, productId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId } })
    if (!product) throw new NotFoundException('Producto no encontrado')

    const mappings = await this.prisma.marketplaceMapping.findMany({
      where: { productId },
      include: {
        connection: {
          select: { id: true, name: true, provider: true, status: true, lastSync: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    })

    return mappings.map((m) => ({
      ...m,
      formSchema: MARKETPLACE_FORMS[m.connection.provider] ?? null,
    }))
  }

  async publish(tenantId: string, productId: string, connectionId: string, dto: PublishProductDto) {
    const [product, connection] = await Promise.all([
      this.prisma.product.findFirst({
        where: { id: productId, tenantId },
        include: { inventory: { include: { warehouse: true } } },
        // marketplacePricing is selected by default (no select restriction)
      }),
      this.prisma.connection.findFirst({ where: { id: connectionId, tenantId } }),
    ])

    if (!product) throw new NotFoundException('Producto no encontrado')
    if (!connection) throw new NotFoundException('Conexión no encontrada')
    if (connection.status !== 'connected') {
      throw new BadRequestException('La conexión no está activa')
    }

    const driver = getDriver(connection.provider)
    const credentials = connection.credentials as Record<string, any>
    const config = (connection.config ?? {}) as Record<string, any>

    const totalStock = product.inventory.reduce((sum, inv) => sum + inv.quantity, 0)

    // Merge image sources: explicit imageUrls > formData.images > product.images
    const formImages: string[] = Array.isArray(dto.formData.images)
      ? dto.formData.images.filter((u: any) => typeof u === 'string' && u.trim())
      : []
    const productImages: string[] = Array.isArray(product.images) ? (product.images as string[]) : []
    const images = dto.imageUrls?.length
      ? dto.imageUrls
      : formImages.length
        ? formImages
        : productImages

    // Strip images from formData to avoid sending it twice in the driver payload
    const { images: _imgs, ...restFormData } = dto.formData

    // Use calculated marketplace price if configured, otherwise fallback to formData price or basePrice
    const pricing = (product as any).marketplacePricing as Record<string, any> | null
    const providerPricing = pricing?.[connection.provider]
    const calculatedPrice = providerPricing?.calculatedPrice
    const finalPrice = calculatedPrice
      ? Number(calculatedPrice)
      : Number(restFormData.price ?? product.basePrice)

    const syncInput = {
      sku: product.sku,
      title: restFormData.title ?? restFormData.name ?? restFormData.Name ?? product.name,
      description: restFormData.description ?? restFormData.Description ?? product.description ?? undefined,
      stock: restFormData.availableQuantity ?? restFormData.Stock ?? restFormData.Quantity ?? totalStock,
      images,
      categoryId: restFormData.categoryId ?? restFormData.PrimaryCategory,
      ...restFormData,
      // Drivers that need the original formData (Falabella, ML attributes) read from here
      formData: restFormData,
      price: finalPrice,
    }

    let externalId: string | undefined
    let existingMapping = await this.prisma.marketplaceMapping.findUnique({
      where: { productId_connectionId: { productId, connectionId } },
    })

    try {
      if (existingMapping?.marketplaceProductId) {
        const updateResult = await driver.updateProduct(credentials, existingMapping.marketplaceProductId, syncInput, config)
        if (!updateResult.success) throw new Error(updateResult.error || 'Error al actualizar en el marketplace')
        externalId = existingMapping.marketplaceProductId
      } else {
        const result = await driver.createProduct(credentials, syncInput, config)
        if (!result.success) throw new Error(result.error || 'Error al crear en el marketplace')
        externalId = result.externalId
      }

      const savedFormData = { ...dto.formData, images }

      const mapping = await this.prisma.marketplaceMapping.upsert({
        where: { productId_connectionId: { productId, connectionId } },
        create: {
          productId,
          connectionId,
          marketplaceProductId: externalId,
          marketplaceSku: restFormData.sku ?? product.sku,
          marketplaceCategoryId: dto.formData.categoryId ?? dto.formData.productType,
          marketplacePrice: Number(dto.formData.price ?? product.basePrice),
          syncStatus: 'connected',
          lastSyncAt: new Date(),
          formData: savedFormData,
        },
        update: {
          marketplaceProductId: externalId,
          marketplaceSku: restFormData.sku ?? product.sku,
          marketplaceCategoryId: dto.formData.categoryId ?? dto.formData.productType,
          marketplacePrice: Number(dto.formData.price ?? product.basePrice),
          syncStatus: 'connected',
          lastSyncAt: new Date(),
          errorMessage: null,
          formData: savedFormData,
        },
      })

      this.logger.log(`Published product ${productId} to ${connection.provider}: ${externalId}`)
      return { success: true, mapping }
    } catch (err: any) {
      this.logger.error(`Failed to publish ${productId} to ${connection.provider}: ${err.message}`)

      await this.prisma.marketplaceMapping.upsert({
        where: { productId_connectionId: { productId, connectionId } },
        create: {
          productId,
          connectionId,
          syncStatus: 'error',
          errorMessage: err.message,
          lastSyncAt: new Date(),
        },
        update: {
          syncStatus: 'error',
          errorMessage: err.message,
          lastSyncAt: new Date(),
        },
      })

      throw new BadRequestException(`Error al publicar: ${err.message}`)
    }
  }

  async unpublish(tenantId: string, productId: string, connectionId: string) {
    const mapping = await this.prisma.marketplaceMapping.findUnique({
      where: { productId_connectionId: { productId, connectionId } },
      include: { connection: true },
    })

    if (!mapping) throw new NotFoundException('Publicación no encontrada')
    if (mapping.connection.tenantId !== tenantId) throw new NotFoundException('Publicación no encontrada')

    await this.prisma.marketplaceMapping.delete({
      where: { productId_connectionId: { productId, connectionId } },
    })

    return { success: true }
  }
}
