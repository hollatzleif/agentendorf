# syntax=docker/dockerfile:1
# Moodle-Browser: Chromium (Playwright) + Runner. Bauen aus dem Repo-Wurzelverzeichnis:
#   docker build -f apps/browser/Dockerfile .
# Image-Kennung = Hash über Dockerfile, package.json und src/ (wird nur neu ausgeliefert, wenn sich das ändert).
FROM node:24-bookworm-slim AS bau
RUN corepack enable
WORKDIR /bau
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/browser/package.json apps/browser/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/werkstatt/package.json apps/werkstatt/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @dorf/browser
COPY apps/browser apps/browser
RUN pnpm --filter @dorf/browser build

FROM node:24-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NODE_ENV=production \
    PORT=4200 \
    HOME=/tmp
WORKDIR /app
# playwright-core genau in der Version aus package.json; Chromium samt Systembibliotheken
# package.json ausdrücklich als ES-Modul (npm init schreibt sonst "type": "commonjs" → der gebündelte Runner startet nicht)
RUN echo '{"name":"dorf-browser","private":true,"type":"module"}' > package.json \
 && npm install --omit=dev --no-audit --no-fund playwright-core@1.65.1 \
 && npx -y playwright@1.65.1 install --with-deps chromium \
 && npm cache clean --force && rm -rf /root/.npm /root/.cache /tmp/* /var/lib/apt/lists/*
COPY --from=bau /bau/apps/browser/dist ./
USER node
EXPOSE 4200
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:4200/gesundheit').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "runner.js"]
