/**
 * Shared test utilities for E2E tests.
 * All tests assume a running server at API_BASE_URL.
 */
import { v4 as uuidv4 } from "uuid";

export const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000/api/v1";
export const BACKEND_TOKEN = process.env.BACKEND_TOKEN!;
export const TEST_USER_ID = process.env.TEST_USER_ID || `test-user-${uuidv4().slice(0, 8)}`;
export const TEST_ORG_ID = process.env.TEST_ORG_ID || "test-org-e2e";
export const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || "test@example.com";
export const TEST_USER_NAME = process.env.TEST_USER_NAME || "Test User";

/** Standard auth headers for user API requests */
export const authHeaders = (overrides?: Record<string, string>) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${BACKEND_TOKEN}`,
  "x-user-id": TEST_USER_ID,
  "x-org-id": TEST_ORG_ID,
  "x-user-email": TEST_USER_EMAIL,
  "x-user-name": TEST_USER_NAME,
  ...overrides,
});

/** Make an authenticated API request */
export const api = async <T = Record<string, unknown>>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T; headers: Headers }> => {
  const url = `${API_BASE_URL}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers as Record<string, string>),
    },
  });
  const text = await response.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    body = text as unknown as T;
  }
  return { status: response.status, body, headers: response.headers };
};

/** Make an unauthenticated API request */
export const rawApi = async <T = Record<string, unknown>>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string>),
    },
  });
  const text = await response.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    body = text as unknown as T;
  }
  return { status: response.status, body };
};

/** Read an SSE stream until completion, return accumulated text */
export const readStream = async (response: Response): Promise<string> => {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
};

/** Ensure BACKEND_TOKEN is set before running tests */
export const requireEnv = () => {
  if (!BACKEND_TOKEN) {
    throw new Error(
      "BACKEND_TOKEN must be set. Run tests against a running server:\n" +
        "  pnpm dev  # in one terminal\n" +
        "  pnpm test:e2e  # in another",
    );
  }
};
