FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
RUN npm install -g pnpm@12.3.4

FROM base AS builder
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @work-ai/shared run build
RUN pnpm --filter @work-ai/database run db:generate
RUN pnpm --filter @work-ai/database run build
RUN pnpm --filter @work-ai/api run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl libc6-compat
RUN npm install -g pnpm@12.3.4

COPY --from=builder /app ./

EXPOSE 3001
CMD ["sh", "-c", "mkdir -p /app/storage && node scripts/migrate.cjs && node apps/api/dist/main.js"]
