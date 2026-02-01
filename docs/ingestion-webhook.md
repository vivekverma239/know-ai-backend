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

### delete

- Deletes the record by `id` (or composite keys for highlight relations).

## Document-Specific Behavior

When `type: "document"` and `action: "insert" | "update"`:

1) The document is upserted in the external `documents` table.
2) A `user_file` entry is created or updated.
3) The document is downloaded (from `document_url` or `asset_url`), uploaded
   to storage at:

   `files/{userId}/{userFileId}/document.pdf`

4) The existing parse pipeline (`parsePDF`) is triggered.
5) Failures set `user_file.status = "failed"`.

### Required document fields for parsing

In `data` (snake_case):

- `id` (number)
- `author_id` (maps to userId)
- `team_id` (maps to orgId)
- `document_url` or `asset_url`
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
    "document_url": "https://example.com/report.pdf"
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
