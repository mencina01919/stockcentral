import { Controller, Get } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { PrismaService } from '../../prisma/prisma.service'

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Healthcheck — Railway lo consulta para confirmar que el contenedor está vivo' })
  async check() {
    let dbOk = false
    try {
      await this.prisma.$queryRaw`SELECT 1`
      dbOk = true
    } catch {}
    return {
      status: dbOk ? 'ok' : 'degraded',
      db: dbOk,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    }
  }
}
