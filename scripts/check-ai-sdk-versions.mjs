#!/usr/bin/env node
/**
 * Fails the build if `ai` (Vercel AI SDK) drifts between the workspaces.
 *
 * Why: a mismatch between backend `ai` and dashboard `ai` once shipped a
 * silent "stuck-at-10s" bug — the dashboard's older Zod schema rejected new
 * fields the backend was emitting. Pin everything to the same version and
 * fail-fast here.
 *
 * Also enforces that every `@ai-sdk/*` dep in any workspace is exact-pinned
 * (no `^`/`~`), since they share types/schemas with `ai`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const PACKAGES = [
  "package.json",
  "admin-dashboard/package.json",
  "packages/parse-engine/package.json",
];

const errors = [];
const aiVersions = new Map();

for (const rel of PACKAGES) {
  const path = resolve(ROOT, rel);
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  for (const [name, spec] of Object.entries(deps)) {
    if (name !== "ai" && !name.startsWith("@ai-sdk/")) continue;
    if (typeof spec !== "string") continue;
    if (/^[\^~]/.test(spec)) {
      errors.push(`${rel}: "${name}": "${spec}" must be exact-pinned (drop the ^/~)`);
    }
    if (name === "ai") {
      aiVersions.set(rel, spec.replace(/^[\^~]/, ""));
    }
  }
}

const distinct = new Set(aiVersions.values());
if (distinct.size > 1) {
  errors.push(
    `ai version drift across workspaces:\n${[...aiVersions]
      .map(([p, v]) => `  ${p}: ${v}`)
      .join("\n")}`,
  );
}

if (errors.length > 0) {
  console.error("\n❌ AI SDK version check failed:\n");
  for (const err of errors) console.error(`  - ${err}`);
  console.error(
    "\nFix: edit the relevant package.json so all `ai` and `@ai-sdk/*` deps are exact-pinned to the same version, then `pnpm install`.\n",
  );
  process.exit(1);
}

const aiVersion = [...distinct][0] ?? "(none)";
console.log(`✅ AI SDK aligned: ai@${aiVersion} across ${PACKAGES.length} workspaces`);
