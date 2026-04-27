import { Controller, Get, Post, Patch, Delete, Body, Param, Query, ParseIntPipe, DefaultValuePipe, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { WebhooksService } from './webhooks.service'
import { CreateWebhookDto, UpdateWebhookDto, TestWebhookDto } from './dto/create-webhook.dto'

@ApiTags('Webhooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get()
  @ApiOperation({ summary: 'List webhooks' })
  findAll(
    @CurrentUser() user: any,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.webhooksService.findAll(user.tenantId, page, limit)
  }

  @Get('events')
  @ApiOperation({ summary: 'List available webhook events' })
  getEvents() {
    return {
      events: [
        { group: 'Órdenes', events: ['order.created', 'order.updated', 'order.cancelled', 'order.fulfilled'] },
        { group: 'Productos', events: ['product.created', 'product.updated', 'product.deleted'] },
        { group: 'Inventario', events: ['inventory.low_stock', 'inventory.out_of_stock'] },
        { group: 'Sincronización', events: ['sync.completed', 'sync.failed'] },
      ],
    }
  }

  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.webhooksService.findOne(user.tenantId, id)
  }

  @Get(':id/deliveries')
  @ApiOperation({ summary: 'Get delivery history for a webhook' })
  getDeliveries(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.webhooksService.getDeliveries(user.tenantId, id, page, limit)
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateWebhookDto) {
    return this.webhooksService.create(user.tenantId, dto)
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Send a test delivery' })
  test(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: TestWebhookDto) {
    return this.webhooksService.test(user.tenantId, id, dto.event)
  }

  @Post(':id/regenerate-secret')
  @ApiOperation({ summary: 'Regenerate webhook signing secret' })
  regenerateSecret(@CurrentUser() user: any, @Param('id') id: string) {
    return this.webhooksService.regenerateSecret(user.tenantId, id)
  }

  @Patch(':id')
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateWebhookDto) {
    return this.webhooksService.update(user.tenantId, id, dto)
  }

  @Delete(':id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.webhooksService.remove(user.tenantId, id)
  }
}
