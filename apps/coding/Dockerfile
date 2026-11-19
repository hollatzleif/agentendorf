# syntax=docker/dockerfile:1
# Codehaus (E191): VS Code im Browser (openvscode-server, MIT) + derselbe Runner wie die Werkstatt im Profil „coding“
# + claude-CLI + Werkzeuge zum Programmieren. Bauen aus dem Repo-Wurzelverzeichnis:
#   docker build -f apps/coding/Dockerfile .
FROM node:24-bookworm-slim AS bau
RUN corepack enable
WORKDIR /bau
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/werkstatt/package.json apps/werkstatt/
COPY apps/browser/package.json apps/browser/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @dorf/werkstatt
COPY apps/werkstatt apps/werkstatt
RUN pnpm --filter @dorf/werkstatt build

FROM node:24-bookworm-slim
# Versionen bewusst festgelegt; Aktualisierung = diese Zeilen ändern und deployen.
# claude-CLI: dieselbe Version wie in apps/werkstatt/Dockerfile (ein Test prüft, dass beide gleich sind).
ARG CLAUDE_CODE_VERSION=2.1.325
ARG OPENVSCODE_VERSION=1.109.5
# sha256 der Release-Archive von github.com/gitpod-io/openvscode-server (am 19.11.2026 geladen und geprüft)
ARG OPENVSCODE_SHA256_X64=b433bf4f0227321a7014d8460d10a8f958adc0f45aa79bd889e84e65e8f88363
ARG OPENVSCODE_SHA256_ARM64=36d9c14036489b63de84ebace837fcacf7e60e669a0dc715802c5443684ea4dc

# Werkzeuge: git, gh (offizielles Paketarchiv von GitHub), Compiler, Python mit pip/venv, Kleinkram für den Alltag
RUN apt-get update -q \
 && apt-get install -y -q --no-install-recommends ca-certificates curl gnupg \
 && install -d -m 755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod a+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update -q \
 && apt-get install -y -q --no-install-recommends \
      git gh openssh-client build-essential pkg-config \
      python3 python3-pip python3-venv python3-dev \
      ripgrep jq less nano procps unzip zip xz-utils wget sqlite3 tini \
 && rm -rf /var/lib/apt/lists/*

RUN set -eu; \
    case "$(dpkg --print-architecture)" in \
      amd64) A=x64; S="$OPENVSCODE_SHA256_X64" ;; \
      arm64) A=arm64; S="$OPENVSCODE_SHA256_ARM64" ;; \
      *) echo "Architektur nicht unterstützt" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/ovs.tgz "https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v${OPENVSCODE_VERSION}/openvscode-server-v${OPENVSCODE_VERSION}-linux-${A}.tar.gz"; \
    echo "$S  /tmp/ovs.tgz" | sha256sum -c -; \
    mkdir -p /opt/openvscode-server; \
    tar -xzf /tmp/ovs.tgz -C /opt/openvscode-server --strip-components=1; \
    rm /tmp/ovs.tgz

RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force && corepack enable

# Alles Veränderliche liegt in den eingehängten Ordnern: /arbeit (Projekte + Heimordner mit VS-Code-Einstellungen,
# Erweiterungen, npm/pip des Benutzers) und /claude-konfig (Sitzungen des claude-CLI). Das Abbild selbst ist nur lesbar.
ENV HOME=/arbeit/.heim \
    CLAUDE_CONFIG_DIR=/claude-konfig/config \
    DISABLE_AUTOUPDATER=1 \
    RUNNER_PROFIL=coding \
    PORT=4000 \
    VSCODE_PORT=3000 \
    ARBEIT_DIR=/arbeit \
    TMPDIR=/arbeit/.tmp \
    NPM_CONFIG_PREFIX=/arbeit/.heim/.npm-global \
    COREPACK_HOME=/arbeit/.heim/.cache/corepack \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PATH=/arbeit/.heim/.npm-global/bin:/arbeit/.heim/.local/bin:/opt/openvscode-server/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C.UTF-8 \
    EDITOR=nano
WORKDIR /app
COPY --from=bau /bau/apps/werkstatt/dist ./
COPY apps/coding/start.sh apps/coding/gesund.sh ./
RUN chmod 755 start.sh gesund.sh && mkdir -p /claude-konfig /arbeit /vault && chown node:node /claude-konfig /arbeit
USER node
EXPOSE 3000 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD ["/app/gesund.sh"]
ENTRYPOINT ["tini", "--"]
CMD ["/app/start.sh"]
