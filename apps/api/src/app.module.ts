import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { ThrottlerModule } from '@nestjs/throttler'
import { BullModule } from '@nestjs/bull'
import { ScheduleModule } from '@nestjs/schedule'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './modules/auth/auth.module'
import { UsersModule } from './modules/users/users.module'
import { TenantsModule } from './modules/tenants/tenants.module'
import { ProductsModule } from './modules/products/products.module'
import { InventoryModule } from './modules/inventory/inventory.module'
import { OrdersModule } from './modules/orders/orders.module'
import { SalesModule } from './modules/sales/sales.module'
import { ConnectionsModule } from './modules/connections/connections.module'
import { DashboardModule } from './modules/dashboard/dashboard.module'
import { SyncModule } from './modules/sync/sync.module'
import { WebhooksModule } from './modules/webhooks/webhooks.module'
import { WarehousesModule } from './modules/warehouses/warehouses.module'
import { MediaModule } from './modules/media/media.module'
import { PublicationsModule } from './modules/publications/publications.module'
import { StockSyncModule } from './modules/stock-sync/stock-sync.module'
import { CatalogSourceModule } from './modules/catalog-source/catalog-source.module'
import { TaxDocumentsModule } from './modules/tax-documents/tax-documents.module'
import { BillingModule } from './modules/billing/billing.module'
import { InboundWebhooksModule } from './modules/inbound-webhooks/inbound-webhooks.module'
import { OffersModule } from './modules/offers/offers.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6380),
          password: config.get('REDIS_PASSWORD') || undefined,
        },
      }),
      inject: [ConfigService],
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    TenantsModule,
    ProductsModule,
    InventoryModule,
    OrdersModule,
    SalesModule,
    ConnectionsModule,
    DashboardModule,
    SyncModule,
    WebhooksModule,
    WarehousesModule,
    MediaModule,
    PublicationsModule,
    StockSyncModule,
    CatalogSourceModule,
    TaxDocumentsModule,
    BillingModule,
    InboundWebhooksModule,
    OffersModule,
  ],
})
export class AppModule {}
