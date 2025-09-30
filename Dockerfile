# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# Install dependencies
COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Set production env
ENV NODE_ENV=production
EXPOSE 3000

# Run server with tsx (TypeScript runtime)
CMD ["pnpm", "exec", "tsx", "src/server.ts"]


