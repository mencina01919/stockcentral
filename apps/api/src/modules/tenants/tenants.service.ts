import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  async findMe(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true, name: true, slug: true, email: true, phone: true,
        country: true, timezone: true, currency: true, language: true,
        plan: true, status: true, trialEndsAt: true, createdAt: true,
        _count: { select: { users: true, products: true, connections: true } },
      },
    })
    if (!tenant) throw new NotFoundException('Tenant no encontrado')
    return tenant
  }

  async getUsage(tenantId: string) {
    const [products, connections, users, orders] = await Promise.all([
      this.prisma.product.count({ where: { tenantId } }),
      this.prisma.connection.count({ where: { tenantId } }),
      this.prisma.user.count({ where: { tenantId } }),
      this.prisma.order.count({ where: { tenantId } }),
    ])
    return { products, connections, users, orders }
  }
}
