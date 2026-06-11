import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { SyncService } from '../sync/sync.service'
import { getDriver, getSupportedProviders, BsaleDriver } from '@stockcentral/integrations'
import { CreateConnectionDto, UpdateConnectionDto } from './dto/connection.dto'

// Providers que son facturadores electrónicos (no marketplaces). Tienen su
// propia interfaz (ITaxDocumentEmitter) y no aparecen en el registry de
// drivers de marketplace.
const BILLING_PROVIDERS = new Set(['bsale'])

@Injectable()
export class ConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncService: SyncService,
  ) {}

  async findAll(tenantId: string) {
    return this.prisma.connection.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { marketplaceMappings: true, syncLogs: true } },
      },
    })
  }

  async findOne(tenantId: string, id: string) {
    const conn = await this.prisma.connection.findFirst({
      where: { id, tenantId },
      include: {
        syncLogs: { orderBy: { createdAt: 'desc' }, take: 10 },
        _count: { select: { marketplaceMappings: true } },
      },
    })
    if (!conn) throw new NotFoundException('Conexión no encontrada')
    return conn
  }

  getProviders() {
    return getSupportedProviders().map((provider) => ({
      provider,
      requiresOAuth: ['mercadolibre', 'shopify', 'jumpseller'].includes(provider),
    }))
  }

  private getRedirectUri(provider: string, overrideUri?: string): string {
    if (overrideUri) return overrideUri
    // ML requires a registered https:// URI — use the one registered in the ML app
    if (provider === 'mercadolibre') {
      return process.env.ML_REDIRECT_URI || 'https://stockcentral.app/api/v1/connections/oauth/mercadolibre/callback'
    }
    return `${process.env.API_URL || 'http://localhost:3001'}/api/v1/connections/oauth/${provider}/callback`
  }

  async getAuthUrl(provider: string, config: Record<string, string>) {
    const driver = getDriver(provider)
    if (!driver.getAuthUrl) {
      throw new BadRequestException(`El proveedor ${provider} no usa OAuth`)
    }
    const redirectUri = this.getRedirectUri(provider, config.redirectUri)
    const url = driver.getAuthUrl({ ...config, redirectUri })
    return { url, redirectUri }
  }

  async exchangeOAuthCode(
    provider: string,
    code: string,
    tenantId: string,
    config: Record<string, string>,
  ) {
    return this.handleOAuthCallback(provider, code, tenantId, config)
  }

  async handleOAuthCallback(
    provider: string,
    code: string,
    tenantId: string,
    config: Record<string, string>,
  ) {
    const driver = getDriver(provider)
    if (!driver.exchangeCode) {
      throw new BadRequestException(`El proveedor ${provider} no usa OAuth`)
    }

    const redirectUri = this.getRedirectUri(provider, config.redirectUri)

    let tokens: Awaited<ReturnType<typeof driver.exchangeCode>>
    try {
      tokens = await driver.exchangeCode(code, { ...config, redirectUri })
    } catch (err: any) {
      const mlMsg = err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Error desconocido'
      throw new BadRequestException(`Error al intercambiar código con ${provider}: ${mlMsg}`)
    }

    const credentials: Record<string, string> = { accessToken: tokens.accessToken }
    if (tokens.refreshToken) credentials.refreshToken = tokens.refreshToken
    if (tokens.sellerId) credentials.sellerId = tokens.sellerId
    // Persistir clientId + clientSecret para que refreshToken() pueda llamarse
    // después sin pedirlos de nuevo. Sin esto la conexión queda "huérfana"
    // cuando el access_token expira (ML access vive 6h).
    if (config.clientId) credentials.clientId = config.clientId
    if (config.clientSecret) credentials.clientSecret = config.clientSecret

    const testResult = await driver.testConnection(credentials)
    if (!testResult.success) {
      throw new BadRequestException(`No se pudo verificar la conexión: ${testResult.error}`)
    }

    const existing = await this.prisma.connection.findUnique({
      where: { tenantId_provider: { tenantId, provider } },
    })

    const connConfig: Record<string, unknown> = {}
    if (tokens.expiresAt) connConfig.tokenExpiresAt = tokens.expiresAt.toISOString()
    if (tokens.siteId) connConfig.siteId = tokens.siteId
    // Guardar también en config como respaldo / para inspección.
    if (config.clientId) connConfig.clientId = config.clientId

    if (existing) {
      return this.prisma.connection.update({
        where: { id: existing.id },
        data: {
          credentials: credentials as any,
          config: { ...((existing.config as any) || {}), ...connConfig },
          status: 'connected',
          lastError: null,
        },
      })
    }

    return this.prisma.connection.create({
      data: {
        tenantId,
        type: this.getConnectionType(provider),
        provider,
        name: testResult.shopName || provider,
        credentials: credentials as any,
        config: connConfig as any,
        status: 'connected',
      },
    })
  }

  async create(tenantId: string, dto: CreateConnectionDto) {
    const existing = await this.prisma.connection.findUnique({
      where: { tenantId_provider: { tenantId, provider: dto.provider } },
    })
    if (existing) {
      throw new ConflictException(`Ya existe una conexión con ${dto.provider}`)
    }

    // Test de credenciales antes de guardar — distinto según el tipo.
    let connectionName = dto.name
    if (BILLING_PROVIDERS.has(dto.provider)) {
      // Facturadores tienen su propia interfaz (ITaxDocumentEmitter).
      const emitter = new BsaleDriver()
      const result = await emitter.testConnection(dto.credentials, dto.config)
      if (!result.success) {
        throw new BadRequestException(`Las credenciales no son válidas: ${result.error}`)
      }
      connectionName = connectionName || result.accountName || dto.provider
    } else {
      const driver = getDriver(dto.provider)
      const testResult = await driver.testConnection(dto.credentials, dto.config)
      if (!testResult.success) {
        throw new BadRequestException(`Las credenciales no son válidas: ${testResult.error}`)
      }
      connectionName = connectionName || testResult.shopName || dto.provider
    }

    return this.prisma.connection.create({
      data: {
        tenantId,
        type: dto.type || this.getConnectionType(dto.provider),
        provider: dto.provider,
        name: connectionName,
        credentials: dto.credentials as any,
        config: (dto.config || {}) as any,
        status: 'connected',
      },
    })
  }

  async update(tenantId: string, id: string, dto: UpdateConnectionDto) {
    const conn = await this.findOne(tenantId, id)
    const provider = (conn as any).provider as string

    // Si llegan credenciales nuevas, validamos contra la API real. Para
    // facturadores usamos el driver específico (BsaleDriver) porque no está
    // en el registry de marketplace drivers.
    if (dto.credentials) {
      if (BILLING_PROVIDERS.has(provider)) {
        const emitter = new BsaleDriver()
        const result = await emitter.testConnection(
          dto.credentials,
          dto.config || ((conn as any).config as Record<string, unknown> | undefined),
        )
        if (!result.success) {
          throw new BadRequestException(`Las credenciales no son válidas: ${result.error}`)
        }
      } else {
        const driver = getDriver(provider)
        const testResult = await driver.testConnection(dto.credentials, dto.config)
        if (!testResult.success) {
          throw new BadRequestException(`Las credenciales no son válidas: ${testResult.error}`)
        }
      }
    }

    // Para config sin credenciales nuevas: hacemos merge con la config
    // existente para no perder otros campos.
    const mergedConfig = dto.config
      ? { ...((conn as any).config || {}), ...dto.config }
      : undefined

    return this.prisma.connection.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.credentials && { credentials: dto.credentials as any }),
        ...(mergedConfig && { config: mergedConfig as any }),
        ...(dto.syncEnabled !== undefined && { syncEnabled: dto.syncEnabled }),
      },
    })
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id)
    await this.prisma.connection.delete({ where: { id } })
    return { message: 'Conexión eliminada correctamente' }
  }

  async triggerSync(tenantId: string, id: string) {
    await this.findOne(tenantId, id)
    return this.syncService.triggerFullSync(tenantId, id)
  }

  // Sincronización masiva enfocada SOLO en precio + stock para todas las
  // conexiones marketplace activas del tenant. No corre orders inbound ni
  // refresh de cache (esos vienen por sus propios crons). Devuelve un
  // jobId por conexión para que la UI polleé progreso con el endpoint
  // sync-progress existente.
  //
  // Estrategia por driver:
  // - Lider: bulk-sync (feed XML inventory + feed XML price, 1 batch).
  // - ML/Paris/Falabella: enqueueProductsOutbound (cron-style worker que
  //   itera mappings y pushea por SKU, usa el path de pushProductToMarketplace
  //   con el fix de stock filtrado por online+store).
  async syncAllPriceStock(tenantId: string) {
    const connections = await this.prisma.connection.findMany({
      where: {
        tenantId,
        type: 'marketplace',
        syncEnabled: true,
        status: 'connected',
        isCatalogSource: false,
      },
      select: { id: true, name: true, provider: true },
    })

    const results: Array<{ connectionId: string; provider: string; name: string; jobId?: string; status: 'queued' | 'error'; error?: string }> = []

    for (const conn of connections) {
      try {
        // Lider tiene un endpoint dedicado de bulk con drift filter +
        // feeds XML (mucho más eficiente que enqueueProductsOutbound).
        if (conn.provider === 'lider') {
          const bulk = await this.syncService.bulkSyncStockAndPrice(tenantId, conn.id)
          results.push({
            connectionId: conn.id,
            provider: conn.provider,
            name: conn.name,
            jobId: bulk?.jobId,
            status: 'queued',
          })
        } else {
          // Otros markets: enqueueProductsOutbound encola un job que
          // itera mappings y hace pushProductToMarketplace por SKU.
          const job = await this.syncService.enqueueProductsOutbound(tenantId, conn.id)
          results.push({
            connectionId: conn.id,
            provider: conn.provider,
            name: conn.name,
            jobId: String(job.id),
            status: 'queued',
          })
        }
      } catch (err: any) {
        results.push({
          connectionId: conn.id,
          provider: conn.provider,
          name: conn.name,
          status: 'error',
          error: err?.message || 'error desconocido',
        })
      }
    }

    return {
      message: `Sincronización de precios y stock encolada en ${results.filter(r => r.status === 'queued').length}/${results.length} conexiones`,
      results,
    }
  }

  // Devuelve el estado agregado de un conjunto de jobs. El frontend invoca
  // este endpoint repetidamente con los IDs devueltos por triggerSync hasta
  // recibir `done: true`, momento en el que muestra el toast de cierre.
  async getSyncProgress(tenantId: string, id: string, jobsParam: string) {
    await this.findOne(tenantId, id) // valida que la conexión existe en el tenant
    const ids = (jobsParam || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (ids.length === 0) {
      throw new BadRequestException('Parametro "jobs" vacío')
    }
    return this.syncService.getJobsStatus(ids)
  }

  async testConnection(tenantId: string, id: string) {
    const connection = await this.findOne(tenantId, id)
    // Facturadores tienen su propia interfaz (ITaxDocumentEmitter) y no
    // pasan por el registry de marketplace drivers (sync). Los probamos
    // directamente.
    if (BILLING_PROVIDERS.has((connection as any).provider)) {
      const emitter = new BsaleDriver()
      const result = await emitter.testConnection(
        (connection as any).credentials as Record<string, string>,
        (connection as any).config as Record<string, unknown> | undefined,
      )
      await this.prisma.connection.update({
        where: { id },
        data: {
          status: result.success ? 'connected' : 'error',
          lastError: result.success ? null : result.error,
        },
      })
      // Devuelve el shape esperado por el frontend (mismo que sync.testConnection).
      return { ...result, shopName: result.accountName }
    }
    return this.syncService.testConnection(tenantId, id)
  }

  async getStatus(tenantId: string, id: string) {
    const conn = await this.findOne(tenantId, id)
    const recentLogs = await this.prisma.syncLog.findMany({
      where: { connectionId: id, tenantId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    const [pending, error, synced] = await Promise.all([
      this.prisma.marketplaceMapping.count({ where: { connectionId: id, syncStatus: 'pending' } }),
      this.prisma.marketplaceMapping.count({ where: { connectionId: id, syncStatus: 'error' } }),
      this.prisma.marketplaceMapping.count({ where: { connectionId: id, syncStatus: 'success' } }),
    ])
    return {
      status: (conn as any).status,
      lastSync: (conn as any).lastSync,
      lastError: (conn as any).lastError,
      recentLogs,
      mappings: { pending, error, synced },
    }
  }

  private getConnectionType(provider: string): string {
    const marketplaces = ['mercadolibre', 'falabella', 'walmart', 'ripley', 'paris', 'lider']
    if (BILLING_PROVIDERS.has(provider)) return 'billing'
    if (marketplaces.includes(provider)) return 'marketplace'
    return 'ecommerce'
  }
}
