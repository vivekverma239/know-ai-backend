# E2E Ingestion Testing

End-to-end tests that verify the full ingestion pipeline — from document upload/webhook to parsing, page extraction, embedding generation, and metadata creation.

There are two test suites covering the two ingestion paths:

| Test | Command | What it covers |
|------|---------|----------------|
| **Direct Upload** | `pnpm test:e2e-ingestion` | PDF upload → GCS → external parser → callbacks → verification |
| **Webhook Ingestion** | `pnpm test:e2e-ingestion-webhook` | Webhook (PDF + Webpage) → processing → verification |

---

## Prerequisites

### 1. Cloudflare Tunnel (required for PDF parsing)

The external PDF parsing backend needs to reach your local server via callbacks. A Cloudflare tunnel provides a stable public URL.

```bash
# Start the tunnel (uses named tunnel "knowsis-dev")
pnpm tunnel
```

This routes `https://knowsis-dev.curiouskid.dev` → `http://localhost:3000`.

Make sure `.env` has:
```bash
APP_URL=https://knowsis-dev.curiouskid.dev
```

> **Note**: The tunnel must be running before starting the dev server, as `APP_URL` is used to construct callback URLs sent to the parsing backend.

### 2. Local Dev Server

```bash
pnpm dev
```

### 3. Environment Variables

These should already be in your `.env`:

```bash
# Required for both tests
BACKEND_TOKEN=<your-backend-token>
QSTASH_CURRENT_SIGNING_KEY=<your-signing-key>

# Required for webhook test (admin API verification)
ADMIN_TEST_USER_ID=e2e-test-admin
ADMIN_TEST_PASSWORD=e2e-test-pass-123
ADMIN_TEST_TOTP_SECRET=3EMXIPNOUH2PEA7262X66KCGF2IQGPBS
```

The admin test user must exist in `data/admin-secrets.json`.

### 4. Test PDF File

For the direct upload test: `test/files/test-file-meta.pdf`

---

## Running the Tests

### Direct Upload Test (`e2e-ingestion`)

Tests the full PDF upload pipeline: upload → external parsing → callbacks → verify pages/chapters/sections/metadata.

```bash
pnpm test:e2e-ingestion
```

**What it checks (6 steps):**

1. Upload PDF via `POST /files/upload`
2. Poll until status = `completed` (up to 8 min)
3. Verify pages were extracted (`GET /files/pages`)
4. Verify chapters were extracted (`GET /files/chapters`) — retries up to 120s since the outline callback is slower
5. Verify sections were extracted (`GET /files/sections`)
6. Verify metadata has title + summary (`GET /files/:id`)

**Cleanup:** Deletes the test file after the run.

**Typical duration:** ~50-60s (depends on external parser speed)

### Webhook Ingestion Test (`e2e-ingestion-webhook`)

Tests the webhook-based ingestion for both webpage and PDF documents. Uses QStash-signed webhooks and verifies results via the admin API.

```bash
pnpm test:e2e-ingestion-webhook
```

**What it checks (11 steps):**

Webpage ingestion:
1. Send webpage webhook → accepted (200)
2. Find created `user_file` via admin API
3. Verify status = `completed`
4. Verify `webArticleMetadata` is populated (url + content)
5. Verify pages were created (HTML → markdown → ~500-word pages with embeddings)

PDF ingestion:
6. Send PDF webhook → accepted (200)
7. Find created `user_file` via admin API
8. Poll until parsing completes
9. Verify sections extracted
10. Verify metadata populated

Delete:
11. Send delete webhook → accepted (200)

**Cleanup:** Sends delete webhooks for all test documents.

**Typical duration:** ~30s (webpage is fast, PDF parsing takes longer)

---

## Troubleshooting

### Tests time out waiting for parsing

- Check the tunnel is running: `curl https://knowsis-dev.curiouskid.dev/api/v1/health`
- Check `APP_URL` in `.env` matches the tunnel domain
- Check the dev server is running and logs show incoming callback requests
- The external parsing backend at `BACKEND_URL` must be reachable

### Webhook returns 500

- Verify `QSTASH_CURRENT_SIGNING_KEY` is correct — the webhook signature is validated
- Check that test user/org IDs are valid UUIDs (the `ext_documents` table has UUID columns)

### Admin API auth fails

- Verify `ADMIN_TEST_USER_ID`, `ADMIN_TEST_PASSWORD`, `ADMIN_TEST_TOTP_SECRET` are set in `.env`
- Verify the test admin user exists in `data/admin-secrets.json`
- If TOTP fails, check system clock isn't drifting (TOTP is time-sensitive)

### Chapters return 0

The outline callback arrives later than other parsing callbacks. The test retries for up to 120s. If chapters still return 0, check the parsing backend logs for the `parse_outline` task.

---

## Adding a New Admin Test User

If you need to regenerate the test admin credentials:

```bash
# Generate password hash
node -e "const b = require('bcryptjs'); b.hash('your-password', 12).then(h => console.log(h))"

# Generate TOTP secret
node -e "const { authenticator } = require('otplib'); console.log(authenticator.generateSecret())"
```

Add the user to `data/admin-secrets.json`:
```json
{
  "userId": "your-user-id",
  "passwordHash": "<bcrypt-hash>",
  "totpSecret": "<totp-secret>"
}
```

Then add to `.env`:
```bash
ADMIN_TEST_USER_ID=your-user-id
ADMIN_TEST_PASSWORD=your-password
ADMIN_TEST_TOTP_SECRET=<totp-secret>
```
