# StockCentral

**Plataforma SaaS omnicanal para gestión centralizada de productos, inventario y ventas en múltiples canales digitales.**

> Competidor directo de Multivende — diseñado para el mercado LATAM.

## Stack

| Capa | Tecnología |
|------|-----------|
| Backend | NestJS + TypeScript + Prisma |
| Frontend | Next.js 14 + Tailwind CSS + shadcn/ui |
| Base de datos | PostgreSQL 16 |
| Cache / Colas | Redis 7 |
| Monorepo | Turborepo + pnpm workspaces |

## Estructura

```
stockcentral/
├── apps/
│   ├── api/          ← NestJS API (puerto 3001)
│   └── web/          ← Next.js frontend (puerto 3000)
├── packages/
│   ├── database/     ← Prisma schema + client
│   └── types/        ← TypeScript compartidos
├── docker-compose.yml
└── turbo.json
```

## Inicio rápido

### Prerrequisitos
- Node.js 20+
- pnpm 9+
- Docker + Docker Compose

### 1. Clonar y configurar

```bash
git clone https://github.com/mencina01919/stockcentral.git
cd stockcentral
cp .env.example .env
cp apps/web/.env.local.example apps/web/.env.local
```

### 2. Levantar base de datos

```bash
docker-compose up -d
```

### 3. Instalar dependencias y migrar

```bash
pnpm install
pnpm db:push
pnpm db:seed
```

### 4. Iniciar en desarrollo

```bash
pnpm dev
```

- Frontend: http://localhost:3000
- API: http://localhost:3001
- Swagger: http://localhost:3001/api/docs

### Credenciales demo

```
Email: admin@demo-store.com
Password: Admin1234!
```

## API Endpoints

| Recurso | Métodos |
|---------|---------|
| `/api/v1/auth` | POST login, register, refresh |
| `/api/v1/products` | GET, POST, PATCH, DELETE |
| `/api/v1/inventory` | GET, PATCH, POST movements |
| `/api/v1/orders` | GET, POST, PATCH status |
| `/api/v1/connections` | GET, POST, PATCH, DELETE, sync |
| `/api/v1/dashboard/stats` | GET |

Documentación completa: http://localhost:3001/api/docs

## Integraciones planificadas

**E-commerce:** Shopify, WooCommerce, Jumpseller, PrestaShop  
**Marketplaces:** Mercado Libre, Falabella, Walmart, Ripley, Paris  
**Logística:** Shipit, Chilexpress, DHL, FedEx

## Roadmap

- [x] MVP: Auth, Products, Inventory, Orders, Connections
- [x] Dashboard con métricas en tiempo real
- [ ] Motor de sincronización bidireccional (BullMQ)
- [ ] Driver Shopify y Mercado Libre
- [ ] Billing con Stripe
- [ ] API pública con webhooks
- [ ] Mobile app

## Licencia

Privado — todos los derechos reservados.
