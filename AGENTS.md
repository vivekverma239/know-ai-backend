# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains the Fastify + TypeScript application (entrypoint: `src/server.ts`).
- `test/` holds ad-hoc test runners (e.g., `test/docParsing.ts`, `test/chatStream.test.ts`).
- `drizzle/` stores SQL migrations and `drizzle/meta/` metadata.
- `dist/` is the compiled output from `pnpm build`.
- `scripts/` includes helper scripts used during development.
- `data/` contains local assets such as credentials or sample data (treat as sensitive).

## Build, Test, and Development Commands
- `pnpm dev` runs the server with `dotenvx` + `nodemon` for local development.
- `pnpm build` compiles TypeScript and rewrites path aliases (`tsc` + `tsc-alias`).
- `pnpm start` runs the compiled server from `dist/server.js`.
- `pnpm lint` runs Biome over `src/**/*.ts`.
- `pnpm test:doc-parsing` executes the document parsing test harness.
- `pnpm test:chat-stream` runs the chat streaming test.
- `pnpm test:all` runs both test scripts in sequence.

## Coding Style & Naming Conventions
- TypeScript only in `src/`; Biome checks `src/**/*.ts`.
- Use 2-space indentation and standard TypeScript conventions (`camelCase` for functions/vars, `PascalCase` for types/classes).
- Prefer `type` imports (`import type { X } from "..."`) per ESLint config.
- `any` is disallowed by lint rules; use `unknown` + narrowing when needed.
- Drizzle access must include `WHERE` clauses for updates/deletes (`db` or `ctx.db`).

## Testing Guidelines
- Tests are executed via `tsx` against files in `test/`.
- Naming is flexible but keep runnable entrypoints in `test/*.ts` or `test/*.test.ts`.
- There is no global coverage gate; add new tests for API or parsing logic you touch.

## Commit & Pull Request Guidelines
- Recent commits use short, plain-language subjects (e.g., “Bug fixes”, “WIP”); keep messages concise and descriptive.
- PRs should include a brief summary, the affected endpoints/modules, and any env var changes.
- Link related issues/tickets if available and note any required data migrations.

## Security & Configuration Tips
- Local auth requires `BACKEND_TOKEN` plus `x-user-id`/`x-org-id` headers.
- Keep `.env` secrets out of commits; refer to the env list in `README.md`.
