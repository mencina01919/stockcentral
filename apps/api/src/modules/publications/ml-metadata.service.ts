import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import axios, { AxiosInstance } from 'axios'

const ML_API = 'https://api.mercadolibre.com'

interface MLAttribute {
  id: string
  name: string
  value_type: string
  tags?: Record<string, any>
  values?: { id: string; name: string; struct?: any }[]
  allowed_units?: { id: string; name: string }[]
  hint?: string
}

@Injectable()
export class MLMetadataService {
  private readonly logger = new Logger(MLMetadataService.name)

  constructor(private prisma: PrismaService) {}

  private async getMLClient(tenantId: string): Promise<AxiosInstance> {
    const conn = await this.prisma.connection.findFirst({
      where: { tenantId, provider: 'mercadolibre', status: 'connected' },
    })
    if (!conn) throw new NotFoundException('No hay conexión activa con MercadoLibre')
    const creds = conn.credentials as Record<string, any>
    const token = creds.accessToken || creds.access_token
    if (!token) throw new BadRequestException('Conexión sin access token')
    return axios.create({
      baseURL: ML_API,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    })
  }

  async searchCategories(query: string) {
    if (!query || query.length < 2) return []
    const res = await axios.get(
      `${ML_API}/sites/MLC/domain_discovery/search`,
      { params: { limit: 8, q: query }, timeout: 10000 },
    )
    const ids: string[] = (res.data || []).map((d: any) => d.category_id).filter(Boolean)
    const unique = Array.from(new Set(ids))
    const cats = await Promise.all(
      unique.slice(0, 8).map(async (id) => {
        try {
          const r = await axios.get(`${ML_API}/categories/${id}`, { timeout: 8000 })
          return {
            id: r.data.id,
            name: r.data.name,
            path_from_root: r.data.path_from_root || [],
          }
        } catch {
          return { id, name: id, path_from_root: [] }
        }
      }),
    )
    return cats
  }

  async getCategoryAttributes(categoryId: string) {
    const res = await axios.get(`${ML_API}/categories/${categoryId}/attributes`, { timeout: 10000 })
    const attrs: MLAttribute[] = res.data || []

    const required = attrs.filter(a => a.tags?.required || a.tags?.catalog_required)
    const sellerPackage = attrs.filter(a =>
      ['SELLER_PACKAGE_HEIGHT', 'SELLER_PACKAGE_WIDTH', 'SELLER_PACKAGE_LENGTH', 'SELLER_PACKAGE_WEIGHT'].includes(a.id),
    )
    const recommended = attrs.filter(a =>
      !required.find(r => r.id === a.id) &&
      !sellerPackage.find(s => s.id === a.id) &&
      ['BRAND', 'GTIN', 'MODEL', 'COLOR', 'LINE'].includes(a.id),
    )

    const mapAttr = (a: MLAttribute) => ({
      id: a.id,
      name: a.name,
      value_type: a.value_type,
      required: !!(a.tags?.required || a.tags?.catalog_required),
      values: a.values || [],
      allowed_units: a.allowed_units || [],
      hint: a.hint,
    })

    return {
      required: required.map(mapAttr),
      sellerPackage: sellerPackage.map(mapAttr),
      recommended: recommended.map(mapAttr),
    }
  }

  async searchCatalogProducts(tenantId: string, query: string, categoryId?: string) {
    if (!query || query.length < 2) return []
    const client = await this.getMLClient(tenantId)
    const params: Record<string, any> = { site_id: 'MLC', q: query, limit: 8, status: 'active' }
    if (categoryId) params.category = categoryId
    try {
      const res = await client.get(`/products/search`, { params })
      return (res.data?.results || []).map((r: any) => ({
        id: r.id,
        name: r.name,
        family_name: r.family_name,
        domain_id: r.domain_id,
        category_id: r.category_id,
        status: r.status,
        pictures: (r.pictures || []).slice(0, 5).map((p: any) => p.url || p),
        attributes: r.attributes || [],
      }))
    } catch (err: any) {
      this.logger.warn(`Catalog search failed: ${err.message}`)
      return []
    }
  }

  async getCatalogProduct(tenantId: string, productId: string) {
    const client = await this.getMLClient(tenantId)
    const res = await client.get(`/products/${productId}`)
    const d = res.data
    return {
      id: d.id,
      name: d.name,
      family_name: d.family_name,
      domain_id: d.domain_id,
      category_id: d.children_attributes?.[0]?.values?.[0]?.metadata?.category_id || d.parent_id || null,
      status: d.status,
      pictures: (d.pictures || []).map((p: any) => p.url || p),
      attributes: d.attributes || [],
      short_description: d.short_description?.content || d.description?.content || null,
    }
  }

  async validate(tenantId: string, payload: Record<string, any>) {
    const client = await this.getMLClient(tenantId)
    try {
      await client.post('/items/validate', payload)
      return { valid: true, errors: [] }
    } catch (err: any) {
      const data = err.response?.data
      const cause = Array.isArray(data?.cause) ? data.cause : []
      const errors = cause.map((c: any) => ({
        code: c.code,
        message: c.message,
        type: c.type,
        references: c.references,
      }))
      return {
        valid: errors.filter((e: any) => e.type === 'error').length === 0,
        errors,
        rawMessage: data?.message,
      }
    }
  }
}
