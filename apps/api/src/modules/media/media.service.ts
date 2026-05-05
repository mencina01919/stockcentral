import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as path from 'path'
import * as fs from 'fs'
import * as sharp from 'sharp'
import { MARKETPLACE_IMAGE_SPECS } from './media.config'

export interface ProductImageSet {
  original: string
  variants: Record<string, string>
}

@Injectable()
export class MediaService {
  private readonly uploadsRoot: string
  private readonly baseUrl: string

  constructor(private config: ConfigService) {
    this.uploadsRoot = path.join(process.cwd(), 'uploads', 'media')
    this.baseUrl = this.config.get('APP_URL', 'http://localhost:3001')
  }

  private tenantDir(tenantId: string, productId: string): string {
    return path.join(this.uploadsRoot, tenantId, productId)
  }

  private ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }

  async uploadProductImage(
    tenantId: string,
    productId: string,
    file: Express.Multer.File,
  ): Promise<ProductImageSet> {
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
    if (!ALLOWED.includes(file.mimetype)) {
      throw new BadRequestException('Formato de imagen no soportado. Use JPEG, PNG o WebP.')
    }

    const dir = this.tenantDir(tenantId, productId)
    this.ensureDir(dir)

    const baseName = `${Date.now()}`
    const masterSpec = MARKETPLACE_IMAGE_SPECS['master']

    const masterFile = `${baseName}_master.jpg`
    const masterPath = path.join(dir, masterFile)

    await (sharp as any)(file.buffer)
      .resize(masterSpec.width, masterSpec.height, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: masterSpec.quality })
      .toFile(masterPath)

    const variants: Record<string, string> = {}

    for (const [market, spec] of Object.entries(MARKETPLACE_IMAGE_SPECS)) {
      if (market === 'master') continue

      const variantFile = `${baseName}_${market}.jpg`
      const variantPath = path.join(dir, variantFile)

      await (sharp as any)(file.buffer)
        .resize(spec.width, spec.height, { fit: 'cover', position: 'center' })
        .jpeg({ quality: spec.quality })
        .toFile(variantPath)

      variants[market] = this.buildUrl(tenantId, productId, variantFile)
    }

    return {
      original: this.buildUrl(tenantId, productId, masterFile),
      variants,
    }
  }

  async deleteProductImage(tenantId: string, productId: string, filename: string) {
    const dir = this.tenantDir(tenantId, productId)
    const baseName = filename.replace(/_master\.jpg$/, '').replace(/_\w+\.jpg$/, '')

    const files = fs.readdirSync(dir).filter((f) => f.startsWith(baseName))
    for (const f of files) {
      fs.unlinkSync(path.join(dir, f))
    }
  }

  getImagePath(tenantId: string, productId: string, filename: string): string {
    const filePath = path.join(this.uploadsRoot, tenantId, productId, filename)
    if (!fs.existsSync(filePath)) throw new NotFoundException('Imagen no encontrada')
    return filePath
  }

  listProductImages(tenantId: string, productId: string): ProductImageSet[] {
    const dir = this.tenantDir(tenantId, productId)
    if (!fs.existsSync(dir)) return []

    const files = fs.readdirSync(dir)
    const masterFiles = files.filter((f) => f.endsWith('_master.jpg'))

    return masterFiles.map((masterFile) => {
      const baseName = masterFile.replace('_master.jpg', '')
      const variants: Record<string, string> = {}

      for (const market of Object.keys(MARKETPLACE_IMAGE_SPECS)) {
        if (market === 'master') continue
        const variantFile = `${baseName}_${market}.jpg`
        if (files.includes(variantFile)) {
          variants[market] = this.buildUrl(tenantId, productId, variantFile)
        }
      }

      return {
        original: this.buildUrl(tenantId, productId, masterFile),
        variants,
      }
    })
  }

  private buildUrl(tenantId: string, productId: string, filename: string): string {
    return `${this.baseUrl}/media/${tenantId}/${productId}/${filename}`
  }
}
