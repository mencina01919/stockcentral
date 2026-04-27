import { Controller, Get } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { TenantsService } from './tenants.service'
import { TenantId } from '../../common/decorators/tenant-id.decorator'

@ApiTags('Tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private tenantsService: TenantsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Información del tenant actual' })
  findMe(@TenantId() tenantId: string) {
    return this.tenantsService.findMe(tenantId)
  }

  @Get('me/usage')
  @ApiOperation({ summary: 'Uso del plan actual' })
  getUsage(@TenantId() tenantId: string) {
    return this.tenantsService.getUsage(tenantId)
  }
}
