import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateConnectionDto, UpdateConnectionDto } from './dto/connection.dto'

@Injectable()
export class ConnectionsService {
  constructor(private prisma: PrismaService) {}

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

  async create(tenantId: string, dto: CreateConnectionDto) {
    const existing = await this.prisma.connection.findUnique({
      where: { tenantId_provider: { tenantId, provider: dto.provider } },
    })
    if (existing) {
      throw new ConflictException(`Ya existe una conexión con ${dto.provider}`)
    }

    return this.prisma.connection.create({
      data: {
        tenantId,
        type: dto.type,
        provider: dto.provider,
        name: dto.name,
        credentials: dto.credentials as any,
        config: dto.config as any,
        status: 'connected',
      },
    })
  }

  async update(tenantId: string, id: string, dto: UpdateConnectionDto) {
    await this.findOne(tenantId, id)
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
    const conn = await this.findOne(tenantId, id)

    await this.prisma.connection.update({
      where: { id },
      data: { status: 'syncing' },
    })

    await this.prisma.syncLog.create({
      data: {
        tenantId,
        connectionId: id,
        type: 'outbound',
        action: 'sync',
        entity: 'connection',
        entityId: id,
        status: 'pending',
      },
    })

    setTimeout(async () => {
      await this.prisma.connection.update({
        where: { id },
        data: { status: 'connected', lastSync: new Date() },
      })
    }, 3000)

    return { message: 'Sincronización iniciada', connectionId: id }
  }

  async getStatus(tenantId: string, id: string) {
    const conn = await this.findOne(tenantId, id)
    const recentLogs = await this.prisma.syncLog.findMany({
      where: { connectionId: id, tenantId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    })
    return { status: conn.status, lastSync: conn.lastSync, recentLogs }
  }
}
