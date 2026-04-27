import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { SyncService } from '../sync/sync.service'
import { getDriver, getSupportedProviders } from '@stockcentral/integrations'
import { CreateConnectionDto, UpdateConnectionDto } from './dto/connection.dto'

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

  async getAuthUrl(provider: string, config: Record<string, string>) {
    const driver = getDriver(provider)
    if (!driver.getAuthUrl) {
      throw new BadRequestException(`El proveedor ${provider} no usa OAuth`)
    }
    const redirectUri =
      config.redirectUri ||
      `${process.env.API_URL || 'http://localhost:3001'}/api/v1/connections/oauth/${provider}/callback`
    const url = driver.getAuthUrl({ ...config, redirectUri })
    return { url }
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

    const redirectUri =
      config.redirectUri ||
      `${process.env.API_URL || 'http://localhost:3001'}/api/v1/connections/oauth/${provider}/callback`

    const tokens = await driver.exchangeCode(code, { ...config, redirectUri })

    const credentials: Record<string, string> = { accessToken: tokens.accessToken }
    if (tokens.refreshToken) credentials.refreshToken = tokens.refreshToken
    if (tokens.sellerId) credentials.sellerId = tokens.sellerId

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

    const driver = getDriver(dto.provider)
    const testResult = await driver.testConnection(dto.credentials, dto.config)
    if (!testResult.success) {
      throw new BadRequestException(`Las credenciales no son válidas: ${testResult.error}`)
    }

    return this.prisma.connection.create({
      data: {
        tenantId,
        type: dto.type || this.getConnectionType(dto.provider),
        provider: dto.provider,
        name: dto.name || testResult.shopName || dto.provider,
        credentials: dto.credentials as any,
        config: (dto.config || {}) as any,
        status: 'connected',
      },
    })
  }

  async update(tenantId: string, id: string, dto: UpdateConnectionDto) {
    const conn = await this.findOne(tenantId, id)

    if (dto.credentials) {
      const driver = getDriver((conn as any).provider)
      const testResult = await driver.testConnection(dto.credentials, dto.config)
      if (!testResult.success) {
        throw new BadRequestException(`Las credenciales no son válidas: ${testResult.error}`)
      }
    }

    return this.prisma.connection.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.credentials && { credentials: dto.credentials as any }),
        ...(dto.config && { config: dto.config as any }),
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

  async testConnection(tenantId: string, id: string) {
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
    const marketplaces = ['mercadolibre', 'falabella', 'walmart', 'ripley', 'paris']
    if (marketplaces.includes(provider)) return 'marketplace'
    return 'ecommerce'
  }
}
