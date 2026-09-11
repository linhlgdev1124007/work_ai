FROM node:20-alpine AS base
WORKDIR /app
RUN npm install -g pnpm@12.3.4

FROM base AS builder
ARG NEXT_PUBLIC_API_URL=/api/v1
ARG NEXT_PUBLIC_SOCKET_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/database/package.json ./packages/database/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @work-ai/shared run build
RUN pnpm --filter @work-ai/web run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app ./
USER nextjs

WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
