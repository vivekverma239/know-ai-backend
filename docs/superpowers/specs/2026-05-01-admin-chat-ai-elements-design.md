# Admin Dashboard Chat: Migrate to AI Elements

**Status:** Approved
**Date:** 2026-05-01
**Scope:** `admin-dashboard/` only (no backend changes)

## Goal

Replace the hand-rolled chat UI in `admin-dashboard/src/pages/PlaygroundPage.tsx` (`ChatTab`, lines 84–340) with Vercel's AI Elements components, and add the chat UX features they enable for free: a proper composer with stop/attachments, tool-call cards, reasoning blocks, source citations, message actions (copy/regenerate), per-mode starter suggestions, and image input.

This is a visual + UX upgrade, not a rebuild. The transport, the three modes (FinAgent / KnowledgeBase / DeepSearch), session reset semantics, member impersonation, and the existing debug logging are preserved.

## Non-goals

- No backend changes. Reasoning + Sources blocks render only when streams already emit those part types; if a mode does not emit them today, the block does not render.
- No persistence beyond a single in-memory session. Refreshing wipes history (unchanged).
- No conversation history sidebar / multi-session UI.
- No `<Branch>` (message branching).
- No upload-to-GCS for attachments. Base64 inline only.
- No model picker UI (modes cover model selection).
- No new frontend test infrastructure introduced as part of this PR. Verification is manual against the dev server.

## Architecture

### File layout

```
admin-dashboard/src/
├── components/
│   └── ai-elements/                   ← installed via `shadcn add` (Vercel registry)
│       ├── conversation.tsx
│       ├── message.tsx
│       ├── response.tsx               ← markdown renderer (replaces react-markdown)
│       ├── prompt-input.tsx
│       ├── tool.tsx
│       ├── reasoning.tsx
│       ├── sources.tsx
│       ├── actions.tsx
│       ├── suggestion.tsx
│       └── loader.tsx
└── features/
    └── playground-chat/
        ├── PlaygroundChat.tsx          ← entry — owns useChat, transport, mode, sessionId
        ├── ChatModeBar.tsx             ← mode <Select> + reset hint
        ├── ChatMessages.tsx            ← <Conversation> + maps messages → parts
        ├── parts/
        │   ├── TextPart.tsx            ← <Response> wrapper
        │   ├── ToolPart.tsx            ← <Tool> with input/output/state
        │   ├── ReasoningPart.tsx       ← <Reasoning> (no-op if absent)
        │   ├── SourcesPart.tsx         ← <Sources> (no-op if absent)
        │   └── FilePart.tsx            ← image preview for user-uploaded attachments
        ├── ChatComposer.tsx            ← <PromptInput> + attachment button + send/stop
        ├── ModeSuggestions.tsx         ← starter prompts shown when messages.length === 0
        ├── useImageAttachments.ts      ← hook: file → base64 dataURL, validation, list state
        └── modeConfig.ts               ← per-mode label + suggestions + transport factory
```

After the move, `PlaygroundPage.tsx` shrinks to ~150 LOC (member picker + tabs + `<PlaygroundChat />`).

### Why this split

- Each feature file has one job — small enough to hold in context, easy to edit reliably.
- `parts/` mirrors the AI SDK part-type model. When a new part type appears (e.g. `data-*`), there is one obvious place to add it.
- `modeConfig.ts` centralizes the three-mode knowledge so adding a fourth mode is a single-file change.
- AI Elements is installed via the shadcn registry (source-owned), so we can patch components for radix-nova tokens, tool-part shape differences, and bug fixes without forking.

## Component contracts

### `PlaygroundChat` (orchestrator)

```ts
type Props = { selectedMember: PlaygroundMember; orgId: string };
```

Owns:

- `mode: ChatMode`, `sessionId`, memoized `transport` keyed on `[mode, accessToken, member.id, orgId, sessionId]`.
- `useChat({ id: \`${member.id}|${orgId}|${mode}\`, transport })` — `id` derivation preserves the workaround at `PlaygroundPage.tsx:126` (without `id`, Chat keeps the old transport on prop change).
- Resets `sessionId` and clears messages when `selectedMember.id`, `orgId`, or `mode` changes (preserves current behavior at lines 215–218; intentionally omits `setMessages` from deps for the same reason — its identity churns mid-stream).

Renders: `<ChatModeBar>` → `<ChatMessages>` (or `<ModeSuggestions>` when `messages.length === 0`) → `<ChatComposer>`.

Passes `sendMessage`, `status`, `stop`, `messages`, `setMessages` down.

### `ChatMessages`

```ts
type Props = { messages: UIMessage[]; status: ChatStatus };
```

- Wraps Vercel's `<Conversation>` (handles auto-scroll + "scroll to bottom" pill — replaces the `messagesContainerRef` + `messagesEndRef` logic at lines 199–208).
- For each message: `<Message from={role}>` containing `<MessageContent>` with a part router:

  ```
  for part of msg.parts:
    text                          → <TextPart>            (markdown via <Response>)
    file                          → <FilePart>            (image preview)
    tool-* / dynamic-tool         → <ToolPart>
    reasoning                     → <ReasoningPart>       (rendered only if part exists)
    source-url / source-document  → buffered → <SourcesPart> at end of message
  ```

- `<Loader />` shown when `status === "submitted"` and the last message has no assistant text yet (replaces the "Thinking…" pulse at lines 310–316).
- Assistant messages get `<Actions>` (copy + regenerate) below the content.

### `ChatComposer`

```ts
type Props = {
  status: ChatStatus;
  onSend: (msg: { text: string; files?: { mediaType: string; url: string }[] }) => void;
  onStop: () => void;
};
```

- `<PromptInput>` with `<PromptInputTextarea>`, `<PromptInputAttachments>` (image preview chips), `<PromptInputAttachmentButton>`, `<PromptInputSubmit>` (auto-toggles to Stop while streaming).
- On submit: pulls text + attachment list, calls `onSend({ text, files })`. The AI SDK transport sends `parts: [{ type: 'text', text }, { type: 'file', mediaType, url: dataURL }]`. Backends already pass `parts` through to the model.
- Disabled state mirrors current behavior: composer disabled when no member selected; submit disabled when text empty + no attachments.

### `useImageAttachments` (hook)

State: `Array<{ id: string; file: File; dataURL: string; mediaType: string }>`.

API:

- `add(files: FileList)` — filters to `image/*`; rejects files larger than 10 MB or beyond a 4-file cap; reads each via `FileReader` to a base64 `dataURL`.
- `remove(id)`, `clear()`.
- Returns `{ items, add, remove, clear, errors }`.

Errors render as inline chips inside the composer (not toasts — less intrusive).

### `ModeSuggestions`

- Reads `modeConfig[mode].suggestions: string[]` (3–4 prompts per mode).
- Renders `<Suggestions>` row; click → calls `sendMessage({ text })`.
- Hidden once `messages.length > 0`.

### `modeConfig.ts`

```ts
export const MODES = {
  finAgent: {
    label: "FinAgent (admin playground)",
    endpoint: "/admin/playground/chat",
    bodyExtra: () => ({}),
    suggestions: [/* 3–4 starters */],
  },
  knowledgeBase: {
    label: "Knowledge Base (/api/v1/chat)",
    endpoint: "/admin/playground/chat-stream",
    bodyExtra: () => ({ deepSearch: "knowledgeBase" }),
    suggestions: [/* … */],
  },
  agentSearch: {
    label: "Deep Search (/api/v1/chat)",
    endpoint: "/admin/playground/chat-stream",
    bodyExtra: () => ({ deepSearch: "agentSearch" }),
    suggestions: [/* … */],
  },
} as const;

export type ChatMode = keyof typeof MODES;
```

`buildTransport(mode, ctx)` reads from this map. Adding a fourth mode is a single entry.

## Data flow

1. User types and/or attaches images → `ChatComposer` → `onSend({ text, files })`.
2. `PlaygroundChat.handleSend` calls `sendMessage({ text, files })`. AI SDK packages it as a `user` UIMessage with `parts: [text, file?]`.
3. `useChat` POSTs to the per-mode endpoint via `DefaultChatTransport`. Backend untouched.
4. Streamed response yields `parts[]` events → `useChat` accumulates → re-renders `<ChatMessages>` → part router dispatches to `TextPart` / `ToolPart` / `ReasoningPart` / Sources accumulator.
5. `Sources` are collected per-message and rendered once at message end as a collapsed bar with citation chips.

## Error handling

- `useChat({ onError })`: surface the error inline as a dismissible alert above the composer. The current code only `console.error`s — failures are silent in the UI today. Keep the existing `console.error` for dev debugging.
- Network / transport failure: `<PromptInputSubmit>` re-enables; PromptInput should preserve the draft on failure (verify during implementation; if it doesn't, lift draft state up).
- Attachment validation errors (size / type / count): inline error chip in the composer.
- Stop button: `useChat().stop()` is already exposed but currently unused. PromptInput exposes this as the submit-button toggle state during streaming.
- Mode switch while streaming: disable the mode `<Select>` when `status` is `"streaming"` or `"submitted"` (matches line 232).

## Existing debug logging

The `[ChatTab …]` console logs at lines 132–195 are load-bearing for debugging existing streaming issues. Move them into `PlaygroundChat.tsx` during extraction; do not delete. The `useEffect` that wraps `stop()` to log call-sites stays.

## Verification (manual)

For each of the 3 modes (FinAgent, KnowledgeBase, DeepSearch):

- [ ] Empty state shows mode-specific suggestion chips.
- [ ] Clicking a suggestion sends the message.
- [ ] Plain text message streams and renders as markdown via `<Response>`.
- [ ] Image attachment: select up to 4 images, see preview chips, send, see image rendered as a `<FilePart>` on the user message, model receives and acknowledges.
- [ ] Image attachment over-limit (>10 MB or >4 files) shows an inline error chip and does not send.
- [ ] Tool calls render as `<Tool>` cards with input/output/state (FinAgent specifically — it's the mode that triggers tools).
- [ ] If the stream emits reasoning parts, they render as `<Reasoning>` blocks. If not, no block appears (no console errors).
- [ ] If the stream emits source parts (`source-url` / `source-document`), they render as a `<Sources>` bar at the end of the assistant message. If not, no bar appears.
- [ ] Stop button aborts mid-stream and re-enables submit.
- [ ] Copy action on assistant messages copies markdown to clipboard.
- [ ] Regenerate action re-runs the last user message.
- [ ] Switching mode disables while streaming, and on switch resets sessionId + clears messages.
- [ ] Switching member or org resets sessionId + clears messages.
- [ ] Network error during send shows a dismissible inline alert (force a 500 or kill the dev backend to test).
- [ ] Auto-scroll: scrolled to bottom → follows new tokens; scrolled up → does not yank, "scroll to bottom" affordance appears.

If `vitest` + RTL are added later for `PlaygroundChat`, they would cover: part router dispatch, attachment hook validation, mode-switch reset effect.

## Risks / open questions

- **AI Elements registry drift.** AI Elements is young; the registry-installed source is owned by us, so we can patch, but a future re-add could conflict with our edits. Mitigation: capture installed component versions in a `components/ai-elements/README.md` snapshot at install time, and prefer patching downstream wrappers in `features/playground-chat/parts/` rather than the AI Elements source where possible.
- **AI SDK v6 ↔ AI Elements compatibility.** Verify on the registry page during install that components target the v5/v6 part shapes we use (`tool-*`, `dynamic-tool`, `file`, `source-url`, `source-document`, `reasoning`). If a component expects an older shape, write a thin adapter rather than forking.
- **Tailwind 4 + radix-nova tokens.** AI Elements ships with TW classes; visual smoke test after install is on the checklist. Expect minor token tweaks.
- **PromptInput draft persistence on error.** Confirm during implementation; if PromptInput resets on submit before transport ack, lift the draft to `PlaygroundChat`.

## Out of scope follow-ups

- Backend support for streaming reasoning + source parts on KB/DeepSearch (if not already there).
- GCS-backed image upload (replace base64 inline).
- Conversation history sidebar with multi-session persistence.
- `<Branch>` for regeneration history.
- Frontend testing stack (vitest + RTL) for the playground chat.
