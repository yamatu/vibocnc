# FANUC Next.js Dockerfile（Next.js Standalone）
# Optional registry/mirror prefix for base images.
# Examples:
# - docker.io (default)
# - dockerproxy.net
# - docker.m.daocloud.io
ARG BASE_REGISTRY=docker.io

# 固定到 2026-10-21 安全版本的 Node 24 LTS（修复 Brotli RCE / TLS·DNS 高危等 10 个漏洞）
# 旧值 node:24-alpine 拉到的 24.22.0 受影响
FROM ${BASE_REGISTRY}/library/node:24.22.1-alpine AS base

WORKDIR /app
RUN apk add --no-cache libc6-compat

FROM base AS deps

COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 通过 build args 注入构建期需要的环境变量（避免依赖未提交的 .env.production）
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SITE_NAME
ARG NEXT_PUBLIC_SITE_DESCRIPTION
ARG NEXT_PUBLIC_PAYPAL_CLIENT_ID
ARG NEXT_PUBLIC_PAYPAL_ENVIRONMENT
ARG NEXT_BUILD_WORKER_COUNT=1
ARG NEXT_BUILD_NODE_OPTIONS=--max-old-space-size=768

ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_SITE_NAME=${NEXT_PUBLIC_SITE_NAME}
ENV NEXT_PUBLIC_SITE_DESCRIPTION=${NEXT_PUBLIC_SITE_DESCRIPTION}
ENV NEXT_PUBLIC_PAYPAL_CLIENT_ID=${NEXT_PUBLIC_PAYPAL_CLIENT_ID}
ENV NEXT_PUBLIC_PAYPAL_ENVIRONMENT=${NEXT_PUBLIC_PAYPAL_ENVIRONMENT}
ENV NEXT_BUILD_WORKER_COUNT=${NEXT_BUILD_WORKER_COUNT}
ENV NEXT_TELEMETRY_DISABLED=1

RUN NODE_OPTIONS="${NEXT_BUILD_NODE_OPTIONS}" npm run build

FROM base AS runner

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

RUN mkdir .next && chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Some Next.js standalone outputs end up nested under /app/app (monorepo-like output tracing).
# Ensure the runtime server can always find `.next/static` and `public` next to its server.js.
RUN if [ -d /app/app ] && [ ! -e /app/app/public ]; then ln -s /app/public /app/app/public; fi \
 && if [ -d /app/app/.next ] && [ ! -e /app/app/.next/static ]; then ln -s /app/.next/static /app/app/.next/static; fi

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Next.js standalone output path can differ depending on outputFileTracingRoot.
# Prefer /app/server.js, fallback to /app/app/server.js.
CMD ["sh", "-lc", "if [ -f /app/server.js ]; then exec node /app/server.js; elif [ -f /app/app/server.js ]; then exec node /app/app/server.js; else echo \"server.js not found\"; ls -la /app; exit 1; fi"]
