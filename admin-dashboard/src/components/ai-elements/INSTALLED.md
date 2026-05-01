# AI Elements snapshot

Installed via `shadcn add` from the AI Elements registry on 2026-04-30.

Registry: `@ai-elements` namespace, resolved via
`https://ai-sdk.dev/elements/api/registry/{name}.json` (configured automatically
in `admin-dashboard/components.json`). Install pattern:

```bash
pnpm dlx shadcn@latest add @ai-elements/<component> --yes
```

We answered "no" to every "overwrite existing file?" prompt so existing
`src/components/ui/*` files (button, badge, separator, scroll-area, input,
textarea, select, dropdown-menu, dialog, command, input-group) were preserved.

## Components owned in this directory

- `conversation.tsx`
- `message.tsx` (also exports the response/actions primitives — see "Registry
  drift" below)
- `prompt-input.tsx`
- `tool.tsx`
- `code-block.tsx` (pulled in transitively by `tool`)
- `reasoning.tsx`
- `shimmer.tsx` (pulled in transitively by `reasoning`; used in place of the
  legacy `loader` component — see below)
- `sources.tsx`
- `suggestion.tsx`

## Registry drift vs. the migration plan

The migration plan was written against an older AI Elements registry that
exposed `response`, `actions`, and `loader` as top-level components. The
current registry has consolidated/renamed these:

- `@ai-elements/response` → no longer exists. The `Response`-equivalent is now
  `MessageResponse`, exported from `message.tsx`. It wraps `streamdown` for
  markdown streaming.
- `@ai-elements/actions` → no longer exists. The actions primitives are now
  exported from `message.tsx`: `MessageActions`, `MessageAction`,
  `CopyAction`, `LikeAction`, `DislikeAction`, plus `MessageToolbar`.
- `@ai-elements/loader` → redirects to the shadcn `radix/spinner` component.
  The AI Elements equivalent for streaming/thinking states is `shimmer.tsx`,
  which is auto-installed by `reasoning`. A plain `Spinner` was also added
  under `src/components/ui/spinner.tsx`.

Subsequent tasks (Task 4 onward) should import response/actions primitives
from `@/components/ai-elements/message` instead of separate files, and use
`Shimmer` (from `@/components/ai-elements/shimmer`) and/or `Spinner` (from
`@/components/ui/spinner`) wherever the plan referenced `Loader`.

## Newly added shadcn `ui/*` files

These were not in the repo before and were created by transitive installs.
They are owned shadcn primitives (not AI Elements) and may be edited freely:

- `button-group.tsx`
- `collapsible.tsx`
- `hover-card.tsx`
- `spinner.tsx` (one local TS fix applied: dropped the SVG `strokeWidth` prop
  from forwarded props because it conflicts with `HugeiconsIcon`'s numeric
  `strokeWidth`. Re-applying after a future `shadcn add` will require the
  same patch.)
- `tooltip.tsx`

## Peer dependencies added

Added to `admin-dashboard/package.json`:

- `@radix-ui/react-use-controllable-state`
- `@streamdown/cjk`, `@streamdown/code`, `@streamdown/math`,
  `@streamdown/mermaid`
- `motion`
- `nanoid`
- `shiki`
- `streamdown`
- `use-stick-to-bottom`

## AI SDK compatibility

The installed components target AI SDK v5/v6 part shapes. `message.tsx`
imports `UIMessage` from `ai`, and `MessageResponse` is `streamdown`-based,
matching the v5+ streaming-text contract. The repo is on
`@ai-sdk/react@3.0.170` and `ai@6.0.146`, so part shapes (`tool-*`,
`dynamic-tool`, `file`, `source-url`, `source-document`, `reasoning`) line
up.

## Patching policy

When patching, prefer wrappers in `src/features/playground-chat/parts/` over
editing AI Elements source. If you must patch source, document the patch
here so a future re-add doesn't silently lose it.

Currently patched files:

- `src/components/ui/spinner.tsx` — `strokeWidth` dropped from forwarded props
  (see "Newly added shadcn `ui/*` files" above).
