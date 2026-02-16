import type {
  AdminDocumentChapter,
  AdminDocumentDetail,
  AdminDocumentPage,
  AdminDocumentSection,
  AdminDocumentSummary,
  AdminDocumentTocMetadata,
  AdminEntityDetail,
  AdminEntitySummary,
  AdminLoginResponse,
  AdminOrgItem,
  AdminSession,
  AdminVerifyTotpResponse,
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api/v1";

type QueryValue = string | number | boolean | null | undefined;

type ApiOptions = {
  method?: "GET" | "POST";
  token?: string;
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const buildUrl = (path: string, query?: Record<string, QueryValue>) => {
  const url = new URL(`${API_BASE_URL}${path}`);
  if (!query) return url;

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url;
};

async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = "GET", token, body, query, signal } = options;
  const response = await fetch(buildUrl(path, query), {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    const errorMessage =
      typeof payload.error === "string"
        ? payload.error
        : `Request failed with status ${response.status}`;
    throw new ApiError(errorMessage, response.status);
  }

  return payload as T;
}

export const loginAdmin = (userId: string, password: string) => {
  return apiRequest<AdminLoginResponse>("/admin/auth/login", {
    method: "POST",
    body: { userId, password },
  });
};

export const verifyAdminTotp = (challengeToken: string, totpCode: string) => {
  return apiRequest<AdminVerifyTotpResponse>("/admin/auth/verify-totp", {
    method: "POST",
    body: { challengeToken, totpCode },
  });
};

export const getAdminSession = (token: string) => {
  return apiRequest<AdminSession>("/admin/auth/me", { token });
};

export const getAdminOrgs = (token: string) => {
  return apiRequest<{ items: AdminOrgItem[] }>("/admin/orgs", { token });
};

export type ListDocumentsQuery = {
  orgId?: string;
  search?: string;
  status?: string;
  type?: string;
  page?: number;
  pageSize?: number;
};

export const getAdminDocuments = (token: string, query: ListDocumentsQuery) => {
  return apiRequest<{ items: AdminDocumentSummary[]; total: number }>("/admin/documents", {
    token,
    query,
  });
};

export const getAdminDocumentDetail = (token: string, id: string) => {
  return apiRequest<AdminDocumentDetail>(`/admin/documents/${id}`, { token });
};

export const getAdminDocumentPages = (
  token: string,
  id: string,
  query: { page?: number; pageSize?: number },
) => {
  return apiRequest<{ items: AdminDocumentPage[]; total: number }>(`/admin/documents/${id}/pages`, {
    token,
    query,
  });
};

export const getAdminDocumentPage = (token: string, id: string, pageNumber: number) => {
  return apiRequest<AdminDocumentPage>(`/admin/documents/${id}/page/${pageNumber}`, {
    token,
  });
};

export const getAdminDocumentSections = (
  token: string,
  id: string,
  query: { page?: number; pageSize?: number },
) => {
  return apiRequest<{ items: AdminDocumentSection[]; total: number }>(
    `/admin/documents/${id}/sections`,
    {
      token,
      query,
    },
  );
};

export const getAdminDocumentChapters = (token: string, id: string) => {
  return apiRequest<{ items: AdminDocumentChapter[]; total: number }>(
    `/admin/documents/${id}/chapters`,
    {
      token,
    },
  );
};

export const getAdminDocumentTocMetadata = (token: string, id: string) => {
  return apiRequest<AdminDocumentTocMetadata>(`/admin/documents/${id}/toc-meta`, {
    token,
  });
};

export const getAdminEntities = (
  token: string,
  query: { orgId: string; q?: string; page?: number; pageSize?: number },
) => {
  return apiRequest<{ items: AdminEntitySummary[]; total: number }>("/admin/entities", {
    token,
    query,
  });
};

export const getAdminEntityDetail = (
  token: string,
  entityId: number,
  query: { orgId: string; highlightsPage?: number; highlightsPageSize?: number },
) => {
  return apiRequest<AdminEntityDetail>(`/admin/entities/${entityId}`, {
    token,
    query,
  });
};
