# syntax=docker/dockerfile:1
# Werkstatt: unverändertes claude-CLI + Runner + MCP-Server "dorf". Bauen aus dem Repo-Wurzelverzeichnis:
#   docker build -f apps/werkstatt/Dockerfile .
FROM node:24-bookworm-slim AS bau
RUN corepack enable
WORKDIR /bau
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/werkstatt/package.json apps/werkstatt/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @dorf/werkstatt
COPY apps/werkstatt apps/werkstatt
RUN pnpm --filter @dorf/werkstatt build

FROM node:24-bookworm-slim
# Version bewusst festgelegt; Aktualisierung = diese Zeile ändern und deployen.
ARG CLAUDE_CODE_VERSION=2.1.325
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force
ENV CLAUDE_CONFIG_DIR=/claude-konfig/config \
    HOME=/claude-konfig/heim \
    DISABLE_AUTOUPDATER=1 \
    PORT=4000 \
    ARBEIT_DIR=/arbeit
WORKDIR /app
COPY --from=bau /bau/apps/werkstatt/dist ./
RUN mkdir -p /claude-konfig /arbeit && chown node:node /claude-konfig /arbeit
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:4000/gesundheit').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "mkdir -p \"$CLAUDE_CONFIG_DIR\" \"$HOME\" && exec node runner.js"]
