import { Controller, Get } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { DashboardService } from './dashboard.service'
import { TenantId } from '../../common/decorators/tenant-id.decorator'

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Estadísticas del dashboard' })
  getStats(@TenantId() tenantId: string) {
    return this.dashboardService.getStats(tenantId)
  }
}
