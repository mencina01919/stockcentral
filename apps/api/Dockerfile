
# Multi-stage build para apps/api en monorepo pnpm.
# - deps: instala TODAS las deps del monorepo desde pnpm-lock (cache-friendly)
# - builder: corre prisma generate + integrations build + api build
# - runner: imagen final delgada con solo lo necesario para correr
#
# Notas:
# - El package @stockcentral/database exporta src/index.ts directamente y
#   el cliente Prisma vive en node_modules/@prisma/client tras `prisma generate`.
# - @stockcentral/integrations sí buildea a dist; el API lo importa
#   compilado.
# - @stockcentral/types exporta src directamente.

FROM node:20-alpine AS base
RUN npm install -g pnpm@10.33.2
WORKDIR /app

# ─── Stage 1: deps ───────────────────────────────────────────────────────────
# Copiamos solo los manifests para aprovechar cache de Docker en re-builds
# cuando no cambiaron las deps.
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/database/package.json ./packages/database/
COPY packages/integrations/package.json ./packages/integrations/
COPY packages/types/package.json ./packages/types/
RUN pnpm install --frozen-lockfile

# ─── Stage 2: builder ────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=deps /app/packages/integrations/node_modules ./packages/integrations/node_modules

# Copiar el source del monorepo (excluyendo lo de .dockerignore)
COPY . .

# Generar Prisma client (necesita el schema.prisma de packages/database)
RUN pnpm --filter @stockcentral/database db:generate

# Buildear integrations antes que api (api importa el dist de integrations)
RUN pnpm --filter @stockcentral/integrations build

# Buildear el API
RUN pnpm --filter @stockcentral/api build

# ─── Stage 3: runner ─────────────────────────────────────────────────────────
# En vez de reinstalar deps + regenerar Prisma, copiamos el resultado del
# stage builder. Eso preserva el cliente Prisma ya generado y evita el
# bug "prisma: not found" cuando se hace pnpm install --prod (prisma vive
# en devDependencies). Imagen final ~400 MB pero sin pasos de rebuild.
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Manifests + workspace files
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/pnpm-lock.yaml ./

# node_modules raíz (incluye .pnpm con todos los binarios y el cliente
# Prisma generado en /app/node_modules/.pnpm/@prisma+client@.../...)
COPY --from=builder /app/node_modules ./node_modules

# App API + node_modules específico
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules

# Workspace packages que el API importa en runtime
COPY --from=builder /app/packages/database/package.json ./packages/database/
COPY --from=builder /app/packages/database/src ./packages/database/src
COPY --from=builder /app/packages/database/prisma ./packages/database/prisma
COPY --from=builder /app/packages/database/node_modules ./packages/database/node_modules

COPY --from=builder /app/packages/integrations/package.json ./packages/integrations/
COPY --from=builder /app/packages/integrations/dist ./packages/integrations/dist
COPY --from=builder /app/packages/integrations/node_modules ./packages/integrations/node_modules

COPY --from=builder /app/packages/types/package.json ./packages/types/
COPY --from=builder /app/packages/types/src ./packages/types/src

EXPOSE 3001
CMD ["node", "apps/api/dist/main"]
