import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { getDriver } from '@stockcentral/integrations'
import type { FalabellaDriver } from '@stockcentral/integrations'

export interface FBCategory {
  id: string
  name: string
  globalIdentifier?: string
  attributeSetId?: string
  parentId?: string
  parentPath?: string[]
  hasChildren: boolean
}

export interface FBAttribute {
  name: string         // internal name (e.g. "package_width")
  feedName: string     // XML tag name to use in ProductCreate (e.g. "PackageWidth")
  label: string
  description?: string
  groupName: string
  inputType: string    // textfield | textarea | numberfield | dropdown | multipleselect | datefield
  isMandatory: boolean
  isGlobalAttribute: boolean
  maxLength?: number
  exampleValue?: string
  productType?: string
  options: { id: string; name: string; isDefault: boolean }[]
}

interface CategoryCache { tree: any[]; flat: FBCategory[]; expiresAt: number }
interface BrandCache { items: any[]; expiresAt: number }

@Injectable()
export class FalabellaMetadataService {
  private readonly logger = new Logger(FalabellaMetadataService.name)
  private categoryCache = new Map<string, CategoryCache>() // key: tenantId
  private brandCache = new Map<string, BrandCache>()       // key: tenantId
  private readonly CACHE_TTL_MS = 60 * 60 * 1000           // 1 hour

  constructor(private prisma: PrismaService) {}

  private async getDriverWithCreds(tenantId: string): Promise<{
    driver: FalabellaDriver
    credentials: any
    config: any
  }> {
    const conn = await this.prisma.connection.findFirst({
      where: { tenantId, provider: 'falabella', status: 'connected' },
    })
    if (!conn) throw new NotFoundException('No hay conexión activa con Falabella')
    const driver = getDriver('falabella') as FalabellaDriver
    return {
      driver,
      credentials: conn.credentials as any,
      config: (conn.config ?? {}) as any,
    }
  }

  // ─── Category tree (cached) ──────────────────────────────────────────────────

  private flattenTree(nodes: any[], parentPath: string[] = []): FBCategory[] {
    const out: FBCategory[] = []
    const list = Array.isArray(nodes) ? nodes : (nodes ? [nodes] : [])
    for (const n of list) {
      const path = [...parentPath, n.Name]
      const childrenRaw = n.Children?.Category
      const children = childrenRaw
        ? (Array.isArray(childrenRaw) ? childrenRaw : [childrenRaw])
        : []
      out.push({
        id: String(n.CategoryId),
        name: String(n.Name),
        globalIdentifier: n.GlobalIdentifier,
        attributeSetId: n.AttributeSetId,
        parentPath: parentPath.length ? parentPath : undefined,
        hasChildren: children.length > 0,
      })
      if (children.length) {
        out.push(...this.flattenTree(children, path))
      }
    }
    return out
  }

  private async loadTree(tenantId: string): Promise<CategoryCache> {
    const cached = this.categoryCache.get(tenantId)
    if (cached && cached.expiresAt > Date.now()) return cached

    const { driver, credentials, config } = await this.getDriverWithCreds(tenantId)
    const tree = await driver.getCategoryTree(credentials, config)
    const flat = this.flattenTree(tree)
    const entry: CategoryCache = { tree, flat, expiresAt: Date.now() + this.CACHE_TTL_MS }
    this.categoryCache.set(tenantId, entry)
    this.logger.log(`Falabella tree loaded for tenant ${tenantId}: ${flat.length} categories`)
    return entry
  }

  async getCategoryTree(tenantId: string) {
    const { tree } = await this.loadTree(tenantId)
    return tree
  }

  async searchCategories(tenantId: string, query: string) {
    if (!query || query.length < 2) return []
    const { flat } = await this.loadTree(tenantId)

    // Normalize: lowercase + strip diacritics so "portatil" matches "Portátiles".
    // Also normalize "|" (Falabella uses "Audífonos|auriculares" as separators)
    const norm = (s: string) =>
      s.toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[|,]/g, ' ')

    // Synonym map — Falabella uses different words than common search terms.
    // Each key maps to a list of equivalent tokens (already normalized).
    const SYNONYMS: Record<string, string[]> = {
      celular:    ['movil', 'telefono', 'smartphone'],
      celulares:  ['moviles', 'telefonos', 'smartphones'],
      laptop:     ['notebook', 'portatil'],
      laptops:    ['notebooks', 'portatiles'],
      pc:         ['computador', 'desktop', 'escritorio'],
      tele:       ['television', 'tv'],
      audifono:   ['auricular'],
      audifonos:  ['auriculares'],
    }

    const rawTokens = norm(query).split(/\s+/).filter(t => t.length >= 2)
    if (rawTokens.length === 0) return []
    // Expand each token with its synonyms; the search will match if ANY variant hits
    const tokenGroups = rawTokens.map(t => {
      const group = [t]
      if (SYNONYMS[t]) group.push(...SYNONYMS[t])
      return group
    })

    // Stem helper: relax "celular" -> matches "celulares", "computador" -> "computadores"
    const stem = (t: string) => t.replace(/(es|s)$/, '')

    // Short tokens (2 chars) must match as a whole word, not substring,
    // otherwise "pc" matches anything containing "pc" anywhere.
    const isShort = (t: string) => t.length <= 2

    const scored: { cat: FBCategory; score: number; matchedAll: boolean; nameMatch: boolean }[] = []
    for (const c of flat) {
      // Only return leaves — products can only be assigned to leaf categories
      if (c.hasChildren) continue
      const nameNorm = norm(c.name)
      const pathNorm = c.parentPath ? norm(c.parentPath.join(' ')) : ''
      const nameWords = nameNorm.split(/\s+/).filter(Boolean)
      const pathWords = pathNorm.split(/\s+/).filter(Boolean)

      let score = 0
      let matchedTokens = 0
      let nameMatchedAtLeastOne = false

      let wordMatchTokens = 0
      let synonymWordMatchTokens = 0
      for (const group of tokenGroups) {
        const original = group[0]
        const oStem = stem(original)
        const oShort = isShort(original)

        const origInName = nameWords.some(w => w === original || stem(w) === oStem || (!oShort && w.startsWith(original)))
        const origInPath = pathWords.some(w => w === original || stem(w) === oStem)
        const synInName = group.slice(1).some(s => nameWords.some(w => w === s || stem(w) === stem(s)))
        const synInPath = group.slice(1).some(s => pathWords.some(w => w === s || stem(w) === stem(s)))

        const matched = origInName || origInPath || synInName || synInPath
        if (!matched) continue
        matchedTokens++

        if (origInName) { score += 10; wordMatchTokens++; nameMatchedAtLeastOne = true }
        else if (synInName) { score += 6; synonymWordMatchTokens++; nameMatchedAtLeastOne = true }
        else if (origInPath) { score += 3 }
        else if (synInPath) { score += 1 }

        // Bonus: when the user's word has synonyms and TWO OR MORE variants of
        // the group appear in the haystack (name + path together), it's a much
        // stronger signal that we found the right semantic neighborhood.
        // E.g. "celular" -> group [celular, movil, telefono]:
        //   "Teléfonos móviles" hits BOTH 'movil' AND 'telefono' -> +5
        //   "Plataformas móviles" hits ONLY 'movil' -> no bonus
        if (group.length > 1) {
          const haystack = `${nameNorm} ${pathNorm}`.split(/\s+/).filter(Boolean)
          const variantsHit = group.filter(v =>
            haystack.some(w => w === v || stem(w) === stem(v))
          ).length
          if (variantsHit >= 2) score += 5
        }
      }

      if (wordMatchTokens === 0 && synonymWordMatchTokens === 0) continue

      const matchedAll = matchedTokens === tokenGroups.length
      if (!matchedAll) score = Math.max(1, score - 3 * (tokenGroups.length - matchedTokens))

      // Bonus: shallower path means more general (and usually more user-relevant) category
      const depth = c.parentPath ? c.parentPath.length : 0
      score += Math.max(0, 4 - depth)

      scored.push({ cat: c, score, matchedAll, nameMatch: nameMatchedAtLeastOne })
    }

    // Sort: full matches first, then by score desc
    scored.sort((a, b) =>
      Number(b.matchedAll) - Number(a.matchedAll) || b.score - a.score
    )
    return scored.slice(0, 50).map(s => s.cat)
  }

  async getCategoryById(tenantId: string, categoryId: string) {
    const { flat } = await this.loadTree(tenantId)
    return flat.find(c => c.id === String(categoryId)) || null
  }

  // ─── Attributes ──────────────────────────────────────────────────────────────

  async getCategoryAttributes(tenantId: string, categoryId: string) {
    const { driver, credentials, config } = await this.getDriverWithCreds(tenantId)
    const raw = await driver.getCategoryAttributes(credentials, categoryId, config)

    const attrs: FBAttribute[] = raw.map((a: any) => {
      // Options can be { Option: [...] } or { Option: {...} } or '' (empty)
      let options: FBAttribute['options'] = []
      const opts = a.Options
      if (opts && typeof opts === 'object') {
        const list = opts.Option
        const arr = Array.isArray(list) ? list : (list ? [list] : [])
        options = arr.map((o: any) => ({
          id: String(o.id ?? o.GlobalIdentifier ?? o.Name),
          name: String(o.Name),
          isDefault: o.isDefault === '1',
        }))
      }
      return {
        name: String(a.Name),
        feedName: String(a.FeedName || a.Name),
        label: String(a.Label || a.Name),
        description: a.Description ? String(a.Description) : undefined,
        groupName: String(a.GroupName || 'General'),
        inputType: String(a.InputType || 'textfield'),
        isMandatory: a.isMandatory === '1' || a.IsMandatory === '1',
        isGlobalAttribute: a.IsGlobalAttribute === '1',
        maxLength: a.MaxLength ? parseInt(String(a.MaxLength), 10) : undefined,
        exampleValue: a.ExampleValue ? String(a.ExampleValue) : undefined,
        productType: a.ProductType ? String(a.ProductType) : undefined,
        options,
      }
    })

    // Group by GroupName, mandatory first within each group
    const groups: Record<string, FBAttribute[]> = {}
    for (const a of attrs) {
      const g = a.groupName || 'General'
      if (!groups[g]) groups[g] = []
      groups[g].push(a)
    }
    for (const g of Object.values(groups)) {
      g.sort((a, b) => Number(b.isMandatory) - Number(a.isMandatory))
    }

    return {
      categoryId,
      total: attrs.length,
      mandatoryCount: attrs.filter(a => a.isMandatory).length,
      groups: Object.entries(groups).map(([name, items]) => ({ name, items })),
      attributes: attrs,
    }
  }

  // ─── Brands (paginated, cached) ──────────────────────────────────────────────

  private async loadAllBrands(tenantId: string): Promise<BrandCache> {
    const cached = this.brandCache.get(tenantId)
    if (cached && cached.expiresAt > Date.now()) return cached

    const { driver, credentials, config } = await this.getDriverWithCreds(tenantId)
    const items: any[] = []
    let offset = 0
    const limit = 1000
    // Falabella has thousands of brands; load page by page until exhausted
    while (true) {
      const page = await driver.getBrands(credentials, config, offset, limit)
      items.push(...page.items)
      if (items.length >= page.total || page.items.length === 0) break
      offset += limit
      if (offset > 100000) break // hard safety stop
    }
    const entry: BrandCache = { items, expiresAt: Date.now() + this.CACHE_TTL_MS }
    this.brandCache.set(tenantId, entry)
    this.logger.log(`Falabella brands loaded for tenant ${tenantId}: ${items.length}`)
    return entry
  }

  async searchBrands(tenantId: string, query: string) {
    const { items } = await this.loadAllBrands(tenantId)
    if (!query || query.length < 2) {
      // Return first 30 alphabetically when no query
      return items
        .slice()
        .sort((a, b) => String(a.Name).localeCompare(String(b.Name)))
        .slice(0, 30)
        .map(b => ({ id: String(b.BrandId), name: String(b.Name), globalIdentifier: b.GlobalIdentifier }))
    }
    const q = query.toLowerCase()
    return items
      .filter(b => String(b.Name).toLowerCase().includes(q))
      .slice(0, 30)
      .map(b => ({ id: String(b.BrandId), name: String(b.Name), globalIdentifier: b.GlobalIdentifier }))
  }

  // ─── Force-refresh caches (for admin) ────────────────────────────────────────

  async refreshCaches(tenantId: string) {
    this.categoryCache.delete(tenantId)
    this.brandCache.delete(tenantId)
    return { ok: true }
  }
}
