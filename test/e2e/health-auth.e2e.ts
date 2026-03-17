import { describe, it, expect, beforeAll } from "vitest";
import { api, rawApi, authHeaders, requireEnv, API_BASE_URL, BACKEND_TOKEN } from "../helpers";
import { generate } from "otplib";

beforeAll(() => requireEnv());

/* ------------------------------------------------------------------ */
/*  1. Health Check                                                   */
/* ------------------------------------------------------------------ */
describe("Health", () => {
  it("GET /health returns 200", async () => {
    const { status } = await rawApi("/health");
    expect(status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/*  2. Authentication                                                 */
/* ------------------------------------------------------------------ */
describe("Authentication", () => {
  it("rejects requests without x-user-id header", async () => {
    // x-user-id check runs before auth token check
    const { status } = await rawApi("/files");
    expect(status).toBe(400);
  });

  it("rejects requests with invalid token", async () => {
    const { status } = await rawApi("/files", {
      headers: {
        Authorization: "Bearer invalid-token-value",
        "x-user-id": "test-user",
        "x-org-id": "test-org",
      },
    });
    expect(status).toBe(403);
  });

  it("rejects requests without Authorization header", async () => {
    const { status } = await rawApi("/files", {
      headers: {
        "x-user-id": "test-user",
        "x-org-id": "test-org",
      },
    });
    expect(status).toBe(401);
  });

  it("accepts requests with valid auth headers", async () => {
    const { status } = await api("/files");
    expect(status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/*  3. Admin Auth Flow                                                */
/* ------------------------------------------------------------------ */
describe("Admin Auth", () => {
  const ADMIN_TEST_USER_ID = process.env.ADMIN_TEST_USER_ID;
  const ADMIN_TEST_PASSWORD = process.env.ADMIN_TEST_PASSWORD;
  const ADMIN_TEST_TOTP_SECRET = process.env.ADMIN_TEST_TOTP_SECRET;

  const skip = !ADMIN_TEST_USER_ID;

  let challengeToken: string | null = null;
  let accessToken: string | null = null;

  it.skipIf(skip)("rejects invalid password", async () => {
    const { status } = await rawApi("/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({
        userId: ADMIN_TEST_USER_ID,
        password: "wrong-password",
      }),
    });
    expect(status).toBe(401);
  });

  it.skipIf(skip)("login returns challenge token", async () => {
    const { status, body } = await rawApi<{ challengeToken?: string }>("/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({
        userId: ADMIN_TEST_USER_ID,
        password: ADMIN_TEST_PASSWORD,
      }),
    });
    expect(status).toBe(200);
    expect(body.challengeToken).toBeTypeOf("string");
    challengeToken = body.challengeToken!;
  });

  it.skipIf(skip)("rejects invalid TOTP", async () => {
    expect(challengeToken).toBeTruthy();
    const { status } = await rawApi("/admin/auth/verify-totp", {
      method: "POST",
      body: JSON.stringify({
        challengeToken,
        totpCode: "000000",
      }),
    });
    expect(status).toBe(401);
  });

  it.skipIf(skip)("accepts valid TOTP and returns access token", async () => {
    expect(challengeToken).toBeTruthy();
    const validTotpCode = await generate({ secret: ADMIN_TEST_TOTP_SECRET! });
    const { status, body } = await rawApi<{ accessToken?: string }>("/admin/auth/verify-totp", {
      method: "POST",
      body: JSON.stringify({
        challengeToken,
        totpCode: validTotpCode,
      }),
    });
    expect(status).toBe(200);
    expect(body.accessToken).toBeTypeOf("string");
    accessToken = body.accessToken!;
  });

  it.skipIf(skip)("GET /admin/auth/me works with access token", async () => {
    expect(accessToken).toBeTruthy();
    const { status } = await rawApi("/admin/auth/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    expect(status).toBe(200);
  });
});
