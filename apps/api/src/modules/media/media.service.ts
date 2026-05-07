import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'
import * as sharp from 'sharp'

export interface UploadResult {
  url: string
  filename: string
  hash: string
  bytes: number
  width: number
  height: number
}

// Master output spec: 1600×1600 JPEG q=92.
// Marketplaces (Falabella/MELI/Paris/Lider/Shopify) descargan la imagen
// desde la URL y aplican sus propios resizes/recortes — un solo archivo
// bien generado les sirve a todos. Si en el futuro hace falta variantes
// pre-generadas por canal, se pueden derivar offline a partir del master.
const MASTER_MAX_DIM = 1600
const MASTER_QUALITY = 92

@Injectable()
export class MediaService {
  // On-disk root: <repo>/uploads/media/<hash>.<ext>
  // In production this folder gets symlinked to /media on the server,
  // and a CDN/proxy serves https://media.eylstore.cl/media/<file> directly.
  private readonly uploadsRoot: string
  // Public base URL — env-driven so dev → http://localhost:3001
  // and prod → https://media.eylstore.cl. URLs persisted in the DB
  // therefore only need the right env var to keep working in either env.
  private readonly mediaBaseUrl: string

  constructor(private config: ConfigService) {
    this.uploadsRoot = path.join(process.cwd(), 'uploads', 'media')
    if (!fs.existsSync(this.uploadsRoot)) fs.mkdirSync(this.uploadsRoot, { recursive: true })

    const explicit = this.config.get<string>('MEDIA_BASE_URL')
    const apiUrl = this.config.get<string>('APP_URL', 'http://localhost:3001')
    this.mediaBaseUrl = (explicit || apiUrl).replace(/\/$/, '')
  }

  // Path for a hashed file (e.g. uploads/media/abc123.jpg).
  private filePath(filename: string): string {
    return path.join(this.uploadsRoot, filename)
  }

  // Public URL for a hashed file. Matches the production layout:
  // https://media.eylstore.cl/media/<hash>.jpg
  private buildUrl(filename: string): string {
    return `${this.mediaBaseUrl}/media/${filename}`
  }

  // ───── Upload ────────────────────────────────────────────────────────────
  // The same image (byte-identical after resize) hashes to the same filename,
  // so re-uploading is idempotent — we don't bloat the disk with duplicates.
  async uploadProductImage(file: Express.Multer.File): Promise<UploadResult> {
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
    if (!ALLOWED.includes(file.mimetype)) {
      throw new BadRequestException('Formato de imagen no soportado. Use JPEG, PNG o WebP.')
    }
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Archivo vacío')
    }

    // Normalize to JPEG, max 1600×1600, fit:inside, no upscale.
    const processed = await (sharp as any)(file.buffer)
      .rotate() // honor EXIF orientation, then strip it
      .resize(MASTER_MAX_DIM, MASTER_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: MASTER_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })

    const buffer = processed.data as Buffer
    const info = processed.info as { width: number; height: number; size: number }

    const hash = crypto.createHash('sha256').update(buffer).digest('hex')
    const filename = `${hash}.jpg`
    const dest = this.filePath(filename)

    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, buffer)
    }

    return {
      url: this.buildUrl(filename),
      filename,
      hash,
      bytes: info.size,
      width: info.width,
      height: info.height,
    }
  }

  // ───── Serve / housekeeping ─────────────────────────────────────────────
  getImagePath(filename: string): string {
    // Reject path-traversal attempts.
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      throw new NotFoundException('Imagen no encontrada')
    }
    const filePath = this.filePath(filename)
    if (!fs.existsSync(filePath)) throw new NotFoundException('Imagen no encontrada')
    return filePath
  }

  // Legacy path used by older URLs persisted with the previous tenant/product
  // layout: uploads/media/<tenantId>/<productId>/<filename>. We still resolve
  // these so old URLs in DB don't 404. New uploads go to the flat hash layout.
  getLegacyImagePath(tenantId: string, productId: string, filename: string): string {
    if (
      [tenantId, productId, filename].some(
        (s) => s.includes('/') || s.includes('\\') || s.includes('..'),
      )
    ) {
      throw new NotFoundException('Imagen no encontrada')
    }
    const filePath = path.join(this.uploadsRoot, tenantId, productId, filename)
    if (!fs.existsSync(filePath)) throw new NotFoundException('Imagen no encontrada')
    return filePath
  }

  async deleteImageByUrl(url: string): Promise<void> {
    // Only delete files we actually own.
    if (!url.startsWith(this.mediaBaseUrl + '/media/')) return
    const filename = url.substring((this.mediaBaseUrl + '/media/').length)
    if (filename.includes('/') || filename.includes('..')) return
    const dest = this.filePath(filename)
    if (fs.existsSync(dest)) fs.unlinkSync(dest)
  }
}
