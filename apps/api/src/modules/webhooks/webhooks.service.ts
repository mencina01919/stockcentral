import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateWebhookDto, UpdateWebhookDto } from './dto/create-webhook.dto'
import * as crypto from 'crypto'
import axios from 'axios'

@Injectable()
export class WebhooksService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit
    const [data, total] = await Promise.all([
      this.prisma.webhook.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.webhook.count({ where: { tenantId } }),
    ])
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit), hasNextPage: page * limit < total, hasPrevPage: page > 1 },
    }
  }

  async findOne(tenantId: string, id: string) {
    const webhook = await this.prisma.webhook.findFirst({ where: { id, tenantId } })
    if (!webhook) throw new NotFoundException('Webhook not found')
    return webhook
  }

  async create(tenantId: string, dto: CreateWebhookDto) {
    const secret = crypto.randomBytes(32).toString('hex')
    return this.prisma.webhook.create({
      data: {
        tenantId,
        url: dto.url,
        events: dto.events,
        secret,
        active: dto.active ?? true,
      },
    })
  }

  async update(tenantId: string, id: string, dto: UpdateWebhookDto) {
    await this.findOne(tenantId, id)
    return this.prisma.webhook.update({ where: { id }, data: dto })
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id)
    await this.prisma.webhook.delete({ where: { id } })
  }

  async regenerateSecret(tenantId: string, id: string) {
    await this.findOne(tenantId, id)
    const secret = crypto.randomBytes(32).toString('hex')
    return this.prisma.webhook.update({ where: { id }, data: { secret } })
  }

  async getDeliveries(tenantId: string, webhookId: string, page = 1, limit = 20) {
    await this.findOne(tenantId, webhookId)
    const skip = (page - 1) * limit
    const [data, total] = await Promise.all([
      this.prisma.webhookDelivery.findMany({
        where: { webhookId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.webhookDelivery.count({ where: { webhookId } }),
    ])
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit), hasNextPage: page * limit < total, hasPrevPage: page > 1 },
    }
  }

  async test(tenantId: string, id: string, event: string) {
    const webhook = await this.findOne(tenantId, id)
    const payload = {
      event,
      timestamp: new Date().toISOString(),
      data: { test: true, message: 'This is a test webhook delivery from StockCentral' },
    }
    return this.dispatch(webhook, event, payload)
  }

  async dispatch(webhook: any, event: string, payload: object) {
    const body = JSON.stringify(payload)
    const signature = crypto.createHmac('sha256', webhook.secret).update(body).digest('hex')

    let responseStatus: number | null = null
    let responseBody: string | null = null
    let status = 'failed'

    try {
      const response = await axios.post(webhook.url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-StockCentral-Signature': `sha256=${signature}`,
          'X-StockCentral-Event': event,
        },
        timeout: 10000,
      })
      responseStatus = response.status
      responseBody = JSON.stringify(response.data).slice(0, 2000)
      status = response.status >= 200 && response.status < 300 ? 'success' : 'failed'
    } catch (err: any) {
      responseStatus = err?.response?.status || null
      responseBody = err?.message || 'Connection error'
    }

    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        event,
        payload,
        responseStatus,
        responseBody,
        status,
      },
    })

    if (status === 'success') {
      await this.prisma.webhook.update({
        where: { id: webhook.id },
        data: { lastTriggered: new Date() },
      })
    }

    return { delivery, status, responseStatus }
  }

  async dispatchEvent(tenantId: string, event: string, data: object) {
    const webhooks = await this.prisma.webhook.findMany({
      where: { tenantId, active: true, events: { has: event } },
    })
    const payload = { event, timestamp: new Date().toISOString(), data }
    await Promise.allSettled(webhooks.map((wh) => this.dispatch(wh, event, payload)))
  }
}
