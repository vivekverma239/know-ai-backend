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

# System deps for Chromium (Playwright). See
# https://playwright.dev/docs/docker#alternative-installation-via-manual-apt-get
# Keep apt lists around until after playwright install so `playwright
# install` can fetch any extra deps its version expects.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 \
    libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
    libcups2 libdrm2 libgbm1 libasound2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libpango-1.0-0 libcairo2 \
    libxshmfence1 libx11-xcb1 \
    fonts-liberation fonts-noto-color-emoji \
    ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/parse-engine/dist ./packages/parse-engine/dist
COPY --from=build /app/packages/parse-engine/node_modules ./packages/parse-engine/node_modules
COPY --from=build /app/packages/parse-engine/package.json ./packages/parse-engine/
COPY --from=build /app/packages/parse-engine/llms.txt ./packages/parse-engine/

# Pin Playwright's browser directory so the install + runtime use the same
# path. Without this, Playwright defaults to ~/.cache/ms-playwright, which
# breaks when the container runs under a different user or a read-only HOME.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# Install both `chromium` and `chromium-headless-shell`: Playwright 1.49+
# uses the lightweight headless shell by default for `{ headless: true }`,
# but some operations (download events, stealth plugin) still fall back to
# full Chromium. Installing both avoids any missing-binary surprises.
RUN mkdir -p /ms-playwright && \
    ./packages/parse-engine/node_modules/.bin/playwright install chromium chromium-headless-shell && \
    chmod -R a+rx /ms-playwright

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "packages/parse-engine/dist/server/index.js"]
