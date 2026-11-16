# syntax=docker/dockerfile:1
# ---- Bauen ------------------------------------------------------------------------------------
FROM node:24-bookworm-slim AS bau
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /bau
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @dorf/web build && pnpm --filter @dorf/server build
# nur die Laufzeit-Abhängigkeiten des Servers (inkl. nativer Module)
RUN pnpm --filter @dorf/server deploy --prod --legacy /laufzeit

# ---- Laufzeit ---------------------------------------------------------------------------------
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    WEB_DIR=/app/web \
    VORLAGE_DIR=/app/vault-vorlage \
    DATEN_DIR=/daten \
    VAULT_DIR=/vault \
    HINTER_PROXY=true \
    PORT=3000
WORKDIR /app
COPY --from=bau /laufzeit/node_modules ./node_modules
COPY --from=bau /laufzeit/package.json ./package.json
COPY --from=bau /bau/apps/server/dist ./dist
COPY --from=bau /bau/apps/web/dist ./web
COPY --from=bau /bau/vault-vorlage ./vault-vorlage
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/gesundheit').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/start.js"]
