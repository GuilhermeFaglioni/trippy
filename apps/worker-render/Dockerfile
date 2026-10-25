FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    ca-certificates \
    chromium \
    ffmpeg \
    fontconfig \
    fonts-noto-cjk \
  && fc-cache --force \
  && test "$(fc-match --format='%{family}' 'Noto Sans CJK SC')" != "" \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/worker-render/package.json apps/worker-render/package.json
COPY packages/dev-env/package.json packages/dev-env/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY patches/ patches/

RUN --mount=type=cache,id=trippy-worker-render-pnpm,target=/root/.local/share/pnpm/store \
  corepack enable \
  && pnpm install --frozen-lockfile --prod --filter @trippy/worker-render...

COPY . .

ENV NODE_ENV=production
WORKDIR /workspace/apps/worker-render
RUN node --import tsx -e "process.stdout.write('tsx do worker disponível\\n')"
CMD ["node", "--import", "tsx", "src/render-worker.ts"]
