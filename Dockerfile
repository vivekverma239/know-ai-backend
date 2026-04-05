# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
# System deps for mupdf (parse-engine) and sharp
RUN apk add --no-cache python3 make g++ libstdc++
WORKDIR /app

# Build stage
FROM base AS builder
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY packages/parse-engine/package.json packages/parse-engine/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter parse-engine build && pnpm run build

# Production stage
FROM base AS production
ENV NODE_ENV=production

# Install only production dependencies
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY packages/parse-engine/package.json packages/parse-engine/
RUN pnpm install --prod --frozen-lockfile

# Copy built application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/packages/parse-engine/dist ./packages/parse-engine/dist
COPY --from=builder /app/packages/parse-engine/package.json ./packages/parse-engine/

EXPOSE 3000

# Run the compiled JavaScript
CMD ["node", "dist/server.js"]
