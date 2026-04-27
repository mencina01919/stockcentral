import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getStats(tenantId: string) {
    const today = new Date()
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0)

    const [
      totalProducts,
      activeConnections,
      currentMonthOrders,
      lastMonthOrders,
      currentMonthRevenue,
      lastMonthRevenue,
      recentOrders,
      connectionStatuses,
      lowStockCount,
    ] = await Promise.all([
      this.prisma.product.count({ where: { tenantId, status: 'active' } }),
      this.prisma.connection.count({ where: { tenantId, status: 'connected' } }),
      this.prisma.order.count({
        where: { tenantId, createdAt: { gte: startOfMonth }, status: { not: 'cancelled' } },
      }),
      this.prisma.order.count({
        where: {
          tenantId,
          createdAt: { gte: startOfLastMonth, lte: endOfLastMonth },
          status: { not: 'cancelled' },
        },
      }),
      this.prisma.order.aggregate({
        where: { tenantId, createdAt: { gte: startOfMonth }, status: { not: 'cancelled' } },
        _sum: { total: true },
      }),
      this.prisma.order.aggregate({
        where: {
          tenantId,
          createdAt: { gte: startOfLastMonth, lte: endOfLastMonth },
          status: { not: 'cancelled' },
        },
        _sum: { total: true },
      }),
      this.prisma.order.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          orderNumber: true,
          sourceChannel: true,
          total: true,
          status: true,
          customerName: true,
          createdAt: true,
        },
      }),
      this.prisma.connection.findMany({
        where: { tenantId },
        select: { id: true, name: true, provider: true, status: true, lastSync: true },
      }),
      this.prisma.inventory.count({
        where: { tenantId, quantity: { lte: this.prisma.inventory.fields.minStock } },
      }).catch(() => 0),
    ])

    const salesChange =
      lastMonthRevenue._sum.total && Number(lastMonthRevenue._sum.total) > 0
        ? ((Number(currentMonthRevenue._sum.total || 0) - Number(lastMonthRevenue._sum.total)) /
            Number(lastMonthRevenue._sum.total)) *
          100
        : 0

    const ordersChange =
      lastMonthOrders > 0
        ? ((currentMonthOrders - lastMonthOrders) / lastMonthOrders) * 100
        : 0

    const salesByChannel = await this.getSalesByChannel(tenantId, startOfMonth)

    return {
      totalSales: Number(currentMonthRevenue._sum.total || 0),
      totalOrders: currentMonthOrders,
      totalProducts,
      totalConnections: activeConnections,
      salesChange: Math.round(salesChange * 10) / 10,
      ordersChange: Math.round(ordersChange * 10) / 10,
      lowStockCount,
      recentOrders,
      salesByChannel,
      connectionStatus: connectionStatuses,
    }
  }

  private async getSalesByChannel(tenantId: string, since: Date) {
    const orders = await this.prisma.order.groupBy({
      by: ['sourceChannel'],
      where: { tenantId, createdAt: { gte: since }, status: { not: 'cancelled' } },
      _sum: { total: true },
      _count: { id: true },
    })

    return orders.map((o) => ({
      channel: o.sourceChannel,
      sales: Number(o._sum.total || 0),
      orders: o._count.id,
    }))
  }
}
