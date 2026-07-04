# syntax=docker/dockerfile:1

# ─── Stage 1: dependency install ───────────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts

# Generate Prisma client (does NOT open a DB connection; only needs the schema)
RUN npx prisma generate


# ─── Stage 2: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# lib/db.ts initialises Prisma lazily (the client is instantiated at module
# load time but the first actual TCP connection is deferred until the first
# query).  next build never issues a query, so a non-empty placeholder is
# sufficient — no real database is needed at build time.
ARG DATABASE_URL=postgresql://placeholder:placeholder@placeholder/placeholder
ENV DATABASE_URL=$DATABASE_URL

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build


# ─── Stage 3: runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3009

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid  1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public       ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next        ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/prisma       ./prisma

USER nextjs

EXPOSE $PORT

# Secrets injected at runtime — never baked into the image:
#   DATABASE_URL  NEXTAUTH_SECRET  NEXTAUTH_URL
#   TOKEN_ENCRYPTION_KEY  CRON_SECRET

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:$PORT/login || exit 1

CMD ["npm", "start"]
