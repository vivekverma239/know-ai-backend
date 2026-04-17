FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
RUN pnpm install --frozen-lockfile

COPY . .

ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN pnpm build

# --- Production: serve static files ---
FROM node:20-alpine AS runner

RUN npm i -g serve@14

COPY --from=builder /app/dist /app/dist

EXPOSE 4173

CMD ["sh", "-c", "serve -s /app/dist -l tcp://0.0.0.0:${PORT:-4173}"]
