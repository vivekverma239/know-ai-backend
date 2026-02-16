# Ingestion Webhook API

This webhook ingests events from the core app into the backend. It verifies
QStash signatures and then processes the event based on `type` and `action`.

## Endpoint

`POST /api/v1/webhooks/ingestion`

## Auth & Security

The webhook must include a valid QStash signature.

### Required Header

- `upstash-signature`: QStash JWT signature for the payload.

If the header is missing or invalid, the API returns `400`.

### How Signature Verification Works

The backend uses `@upstash/qstash` Receiver with:

- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`

The signature is validated against the request body hash and issuer.

## Request Body

```json
{
  "id": 123,
  "data": { "id": 123, "title": "Example" },
  "type": "document",
  "action": "insert",
  "timestamp": "2026-01-31T17:40:49.759Z"
}
```

### Schema (TypeScript)

```ts
export type IngestionPayload = {
  id?: number | string;
  data: Record<string, unknown>;
  type: string;
  action: "insert" | "update" | "delete";
  timestamp: string;
};
```

### Data Shapes by `type` (TypeScript)

> All fields are snake_case (as sent from the core app). Unlisted fields may still appear.

```ts
export type HighlightData = {
  id: number;
  content?: string | null;
  document_id?: number | null;
  author_id?: string | null;
  team_id?: string | null;
  meta?: Record<string, unknown> | null;
  type?: "highlight" | "screenshot" | null;
  image_url?: string | null;
  image_id?: string | null;
  translation_id?: number | null;
  content_embedding?: number[] | null;
  ai_description?: string | null;
  ai_summary?: string | null;
  image_parsed_content?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type EntityData = {
  id: number;
  name: string;
  unique_id?: string | null;
  type?: "corporate" | "country" | "commodity" | "macro" | "sector" | null;
  description?: string | null;
  description_embedding?: number[] | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type TagData = {
  id: number;
  name: string;
  description?: string | null;
  author_id?: string | null;
  team_id?: string | null;
  created_at?: string | null;
};

export type TrendData = {
  id: number;
  document_id?: number | null;
  highlight_id?: number | null;
  entity_id?: number | null;
  trend?: "bullish" | "bearish" | null;
  comment?: string | null;
  author_id?: string | null;
  team_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type TrendAssetData = {
  id: number;
  trend_id?: number | null;
  highlight_id?: number | null;
  document_id?: number | null;
  entity_id?: number | null;
  trend?: "bullish" | "bearish" | null;
  type?: "equity" | "credit" | "fx" | "rates" | "commodity" | null;
  value?: string | null;
  created_at?: string | null;
};

export type ScenarioData = {
  id: number;
  highlight_id?: number | null;
  document_id?: number | null;
  description?: string | null;
  implication?: string | null;
  title?: string | null;
  tentative?: boolean | null;
  with_time?: boolean | null;
  probability?: string | number | null;
  from_date?: string | null;
  to_date?: string | null;
  author_id?: string | null;
  team_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ScenarioRemarkData = {
  id: number;
  scenario_id?: number | null;
  document_id?: number | null;
  entity_id?: number | null;
  variation?: string | number | null;
  asset?: "equity" | "credit" | "fx" | "rates" | "commodity" | null;
  author_id?: string | null;
  team_id?: string | null;
  created_at?: string | null;
};

export type CalendarEventData = {
  id: number;
  highlight_id?: number | null;
  document_id?: number | null;
  description?: string | null;
  implication?: string | null;
  tentative?: boolean | null;
  with_time?: boolean | null;
  from_date?: string | null;
  to_date?: string | null;
  author_id?: string | null;
  team_id?: string | null;
  created_at?: string | null;
};

export type FollowupData = {
  id: number;
  highlight_id?: number | null;
  document_id?: number | null;
  target_id?: string | null;
  question?: string | null;
  author_id?: string | null;
  team_id?: string | null;
  created_at?: string | null;
};

export type HighlightCommentData = {
  id: number;
  highlight_id?: number | null;
  reply_to?: number | null;
  message?: string | null;
  trend?: "bullish" | "bearish" | null;
  author_id?: string | null;
  team_id?: string | null;
  created_at?: string | null;
};

export type HighlightEntityRelData = {
  highlight_id: number;
  entity_id: number;
  user_defined?: boolean | null;
};

export type HighlightTagRelData = {
  highlight_id: number;
  tag_id: number;
};

export type DocumentData = {
  id: number;
  type?: "webpage" | "pdf" | null;
  title?: string | null;
  team_id?: string | null;
  asset_id?: string | null;
  asset_url?: string | null;
  author_id?: string | null;
  thumbnail_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type OrganizationData = {
  id: string;
  name: string;
  mnemonic_id?: string | null;
  owner_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type AccountData = {
  id: string;
  primary_owner_user_id?: string | null;
  name?: string | null;
  slug?: string | null;
  email?: string | null;
  is_personal_account?: boolean | null;
  picture_url?: string | null;
  public_data?: Record<string, unknown> | null;
  organization_id?: string | null;
  account_type?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type IngestionDataByType = {
  highlight: HighlightData;
  entity: EntityData;
  tag: TagData;
  trend: TrendData;
  trend_asset: TrendAssetData;
  scenario: ScenarioData;
  scenario_remark: ScenarioRemarkData;
  calendar_event: CalendarEventData;
  followup: FollowupData;
  highlight_comment: HighlightCommentData;
  highlight_entity: HighlightEntityRelData;
  highlight_tag: HighlightTagRelData;
  document: DocumentData;
  organization: OrganizationData;
  account: AccountData;
};

export type IngestionEvent =
  | ({ type: "highlight"; data: HighlightData } & Omit<IngestionPayload, "data" | "type">)
  | ({ type: "entity"; data: EntityData } & Omit<IngestionPayload, "data" | "type">)
  | ({ type: "tag"; data: TagData } & Omit<IngestionPayload, "data" | "type">)
  | ({ type: "trend"; data: TrendData } & Omit<IngestionPayload, "data" | "type">)
  | ({ type: "trend_asset"; data: TrendAssetData } & Omit<IngestionPayload, "data" | "type">)
  | ({ type: "scenario"; data: ScenarioData } & Omit<IngestionPayload, "data" | "type">)
  | ({ type: "scenario_remark"; data: ScenarioRemarkData } & Omit<IngestionPayload, "data" | "type">)
  | ({ type: "calendar_event"; data: CalendarEventData } & Omit<IngestionPayload, "data" | "type">)
  | ({ type: "followup"; data: FollowupData } & Omit<IngestionPayload, "data" | "type">)
  | ({ type: "highlight_comment"; data: HighlightCommentData } & Omit<IngestionPayload, "data" | "type">)
  | ({ type: "highlight_entity"; data: HighlightEntityRelData } & Omit<IngestionPayload, "data" | "type">)
  | ({ type: "highlight_tag"; data: HighlightTagRelData } & Omit<IngestionPayload, "data" | "type">)
  | ({ type: "document"; data: DocumentData } & Omit<IngestionPayload, "data" | "type">)
  | ({ type: "organization"; data: OrganizationData } & Omit<IngestionPayload, "data" | "type">)
  | ({ type: "account"; data: AccountData } & Omit<IngestionPayload, "data" | "type">);
```

### Fields

- `id` (optional): number or string identifier.
- `data` (required): event payload, keys are in snake_case and will be mapped to camelCase.
- `type` (required): event entity type (see Supported Types).
- `action` (required): one of `insert`, `update`, `delete`.
- `timestamp` (required): ISO timestamp string.

## Responses

### 200 OK

```json
{ "success": true, "requestId": "..." }
```

### 400 Bad Request

```json
{ "success": false, "error": "No signature provided" }
```

or

```json
{ "success": false, "error": "Invalid signature" }
```

### 500 Internal Server Error

```json
{ "success": false, "error": "Failed to process ingestion event", "requestId": "..." }
```

## Supported Types

The `type` maps to a table in `src/db/external_schema.ts`:

- `highlight`
- `entity`
- `tag`
- `trend`
- `trend_asset`
- `scenario`
- `scenario_remark`
- `calendar_event`
- `followup`
- `highlight_comment`
- `highlight_entity`
- `highlight_tag`
- `document`
- `organization`
- `account`

Unknown types are logged and ignored (no error).

## Actions

### insert / update

- Inserts or upserts the record based on primary key.
- For `highlight_entity` and `highlight_tag`, uses composite keys and upserts
  by `(highlightId, entityId)` or `(highlightId, tagId)`.
- For `highlight`, if `image_url` is present, ingestion parses the image with
  Gemini, stores extracted text in `image_parsed_content`, and updates
  `content_embedding` using `content + image_parsed_content`.

### delete

- Deletes the record by `id` (or composite keys for highlight relations).

## Document-Specific Behavior

When `type: "document"` and `action: "insert" | "update"`:

1) The document is upserted in the external `documents` table.
2) A `user_file` entry is created or updated.
3) If `data.type === "webpage"`, the URL is fetched and stored as a
   `web_article` with `webArticleMetadata`.
4) If `data.type !== "webpage"`, the document is downloaded
   (from `asset_url`), uploaded to storage at:

   `files/{userId}/{userFileId}/document.pdf`

5) The existing parse pipeline (`parsePDF`) is triggered.
6) Failures set `user_file.status = "failed"`.

### Required document fields for parsing

In `data` (snake_case):

- `id` (number)
- `type` ("pdf" | "webpage")
- `author_id` (maps to userId)
- `team_id` (maps to orgId)
- `asset_url`
- `title` (optional; used as file name)

If any required fields are missing, the document parsing step is skipped.

## Example Payloads

### Document Insert

```json
{
  "id": 42,
  "type": "document",
  "action": "insert",
  "timestamp": "2026-01-31T17:40:49.759Z",
  "data": {
    "id": 42,
    "title": "Q4 Earnings Report",
    "author_id": "user-123",
    "team_id": "org-456",
    "asset_url": "https://example.com/report.pdf"
  }
}
```

### Highlight Insert

```json
{
  "id": 1001,
  "type": "highlight",
  "action": "insert",
  "timestamp": "2026-01-31T17:40:49.759Z",
  "data": {
    "id": 1001,
    "document_id": 42,
    "author_id": "user-123",
    "team_id": "org-456",
    "content": "Key insight from the report"
  }
}
```

## Environment Variables

- `QSTASH_CURRENT_SIGNING_KEY` (required)
- `QSTASH_NEXT_SIGNING_KEY` (optional; for key rotation)
- `BACKEND_URL` (used by parsing pipeline)
- `APP_URL` (parsing callback target)
- `BACKEND_TOKEN` (parsing backend auth)
- `GOOGLE_APPLICATION_CREDENTIALS(_BASE64)` + `GOOGLE_CLOUD_BUCKET_NAME`

## Notes

- This webhook is intended for QStash delivery only.
- If you need a local dev workflow, use the ingestion test runner and a valid
  QStash signing key to generate the signature.
