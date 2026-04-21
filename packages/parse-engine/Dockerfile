# ── Build stage ──
FROM node:22-slim AS build

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Copy root workspace files for pnpm install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/parse-engine/package.json packages/parse-engine/

RUN pnpm install --frozen-lockfile --filter parse-engine

COPY packages/parse-engine packages/parse-engine

RUN pnpm --filter parse-engine run build

# ── Runtime stage ──
FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@10 --activate

# System deps for Chromium (Playwright)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 libxdamage1 \
    libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 \
    libxshmfence1 libx11-xcb1 fonts-liberation fonts-noto-color-emoji \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/parse-engine/dist ./packages/parse-engine/dist
COPY --from=build /app/packages/parse-engine/node_modules ./packages/parse-engine/node_modules
COPY --from=build /app/packages/parse-engine/package.json ./packages/parse-engine/
COPY --from=build /app/packages/parse-engine/llms.txt ./packages/parse-engine/

# Install Chromium for Playwright
RUN ./packages/parse-engine/node_modules/.bin/playwright install chromium

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "packages/parse-engine/dist/server/index.js"]
