import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

// Servicio simple para envolver crons con tracking de CronRun.
// Cada wrap() inserta una fila al arrancar y la cierra al terminar.
//
// Uso:
//   await monitor.wrap('catalog_source_sync', { tenantId, connectionId, provider }, async () => {
//     const stats = await this.runImport(...)
//     return { stats }
//   })

export interface CronRunContext {
  tenantId?: string
  connectionId?: string
  provider?: string
}

@Injectable()
export class CronMonitorService {
  private readonly logger = new Logger(CronMonitorService.name)

  constructor(private prisma: PrismaService) {}

  async wrap<T>(
    cron: string,
    ctx: CronRunContext,
    fn: () => Promise<{ stats?: unknown }> & Promise<T>,
  ): Promise<T> {
    const run = await this.prisma.cronRun.create({
      data: {
        cron,
        tenantId: ctx.tenantId ?? null,
        connectionId: ctx.connectionId ?? null,
        provider: ctx.provider ?? null,
        status: 'running',
      },
    })

    const startedAt = run.startedAt.getTime()
    try {
      const result = (await fn()) as { stats?: unknown } & T
      const finishedAt = new Date()
      await this.prisma.cronRun.update({
        where: { id: run.id },
        data: {
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt,
          status: 'success',
          stats: (result?.stats as any) ?? undefined,
        },
      })
      return result as T
    } catch (err: any) {
      const finishedAt = new Date()
      await this.prisma.cronRun.update({
        where: { id: run.id },
        data: {
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt,
          status: 'error',
          errorMessage: err?.message?.slice(0, 1000) || String(err).slice(0, 1000),
        },
      })
      throw err
    }
  }

  // Lista N runs recientes (con filtros opcionales).
  async listRecent(opts: { tenantId?: string; connectionId?: string; cron?: string; limit?: number }) {
    return this.prisma.cronRun.findMany({
      where: {
        tenantId: opts.tenantId,
        connectionId: opts.connectionId,
        cron: opts.cron,
      },
      orderBy: { startedAt: 'desc' },
      take: opts.limit ?? 50,
    })
  }

  // Stats agregados por cron en las últimas N horas.
  async stats(tenantId: string, hoursBack = 24) {
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000)
    const runs = await this.prisma.cronRun.findMany({
      where: { tenantId, startedAt: { gte: since } },
      select: { cron: true, status: true, durationMs: true, provider: true, startedAt: true },
    })
    const byCron = new Map<string, { total: number; success: number; error: number; avgMs: number; lastAt: Date | null }>()
    for (const r of runs) {
      const key = `${r.cron}:${r.provider ?? '*'}`
      const cur = byCron.get(key) ?? { total: 0, success: 0, error: 0, avgMs: 0, lastAt: null }
      cur.total++
      if (r.status === 'success') cur.success++
      if (r.status === 'error') cur.error++
      if (r.durationMs) cur.avgMs = (cur.avgMs * (cur.total - 1) + r.durationMs) / cur.total
      if (!cur.lastAt || r.startedAt > cur.lastAt) cur.lastAt = r.startedAt
      byCron.set(key, cur)
    }
    return Array.from(byCron.entries()).map(([key, s]) => ({
      cron: key.split(':')[0],
      provider: key.split(':')[1] === '*' ? null : key.split(':')[1],
      ...s,
      avgMs: Math.round(s.avgMs),
    }))
  }

  // Detecta crons "inactivos": catalog_source_sync que pasó más del threshold
  // sin un run exitoso. Devuelve lista para alertar.
  async checkHealth(tenantId: string) {
    const conns = await this.prisma.connection.findMany({
      where: { tenantId, isCatalogSource: true, syncEnabled: true },
      select: { id: true, provider: true, name: true },
    })
    const alerts: { connectionId: string; provider: string; name: string; lastSuccessAt: Date | null; minutesSinceLastSuccess: number | null; reason: string }[] = []
    // Catalog source corre cada 5 min. Threshold: 15 min sin éxito.
    const THRESHOLD_MS = 15 * 60 * 1000
    const now = Date.now()
    for (const c of conns) {
      const last = await this.prisma.cronRun.findFirst({
        where: { connectionId: c.id, cron: 'catalog_source_sync', status: 'success' },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true },
      })
      const minutesSinceLastSuccess = last ? Math.round((now - last.startedAt.getTime()) / 60000) : null
      const stale = !last || now - last.startedAt.getTime() > THRESHOLD_MS
      if (stale) {
        alerts.push({
          connectionId: c.id,
          provider: c.provider,
          name: c.name,
          lastSuccessAt: last?.startedAt ?? null,
          minutesSinceLastSuccess,
          reason: !last
            ? 'Nunca corrió exitosamente'
            : `Último éxito hace ${minutesSinceLastSuccess} min (threshold 15)`,
        })
      }
    }
    return { ok: alerts.length === 0, alerts }
  }
}
