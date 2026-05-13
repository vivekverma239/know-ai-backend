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
  PlaygroundMember,
  PlaygroundReportDetail,
  PlaygroundReportSummary,
  PlaygroundTemplate,
} from "./types";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api/v1";

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

export const reparseAdminDocument = (token: string, id: string) => {
  return apiRequest<{ success: boolean; fileId: string; status: string; message: string }>(
    `/admin/documents/${id}/reparse`,
    {
      method: "POST",
      token,
      body: {},
    },
  );
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

// --- Playground API ---

export const getPlaygroundMembers = (token: string, orgId: string) => {
  return apiRequest<{ items: PlaygroundMember[] }>("/admin/playground/members", {
    token,
    query: { orgId },
  });
};

export const getPlaygroundTemplates = (token: string) => {
  return apiRequest<{ items: PlaygroundTemplate[] }>("/admin/playground/templates", { token });
};

export const createPlaygroundReport = (
  token: string,
  body: {
    userId: string;
    templateId: string;
    topic: string;
    referencePeriod?: string;
    modelConfig?: unknown;
  },
) => {
  return apiRequest<PlaygroundReportSummary>("/admin/playground/reports", {
    method: "POST",
    token,
    body,
  });
};

export const getPlaygroundReports = (token: string, userId: string) => {
  return apiRequest<{ items: PlaygroundReportSummary[] }>("/admin/playground/reports", {
    token,
    query: { userId },
  });
};

export const getPlaygroundReport = (token: string, id: string) => {
  return apiRequest<PlaygroundReportDetail>(`/admin/playground/reports/${id}`, { token });
};

export type PlaygroundFileMetadata = {
  id: string;
  title: string;
  summary: string;
  documentType?: string;
  year?: number;
  url?: string;
};

export const lookupPlaygroundFiles = (token: string, ids: string[]) => {
  return apiRequest<{ items: Record<string, PlaygroundFileMetadata> }>(
    "/admin/playground/files/lookup",
    {
      method: "POST",
      token,
      body: { ids },
    },
  );
};

// ---------------------------------------------------------------------------
// Analytics — token usage / cost
// ---------------------------------------------------------------------------

export const COST_SOURCES = [
  "chat",
  "parse",
  "report",
  "tool",
  "search",
  "embedding",
  "other",
] as const;
export type CostSource = (typeof COST_SOURCES)[number];

export type UsageFilters = {
  startDate?: string;
  endDate?: string;
  userId?: string;
  actorUserId?: string;
  orgId?: string;
  sessionId?: string;
  source?: CostSource;
};

export type UsageByModel = {
  model: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
  requestCount: number;
};

export type UsageSummary = {
  summary: UsageByModel[];
  totals: { totalTokens: number; totalCost: number; requestCount: number };
};

export const getAdminUsageSummary = (token: string, filters: UsageFilters) =>
  apiRequest<UsageSummary>("/admin/analytics/token-usage/summary", { token, query: filters });

export type UsageByUserRow = {
  userId: string;
  totalTokens: number;
  totalCost: number;
  requestCount: number;
};

export const getAdminUsageByUser = (token: string, filters: UsageFilters & { limit?: number }) =>
  apiRequest<{ users: UsageByUserRow[] }>("/admin/analytics/token-usage/by-user", {
    token,
    query: filters,
  });

export type UsageByOperationRow = {
  operationName: string;
  totalTokens: number;
  totalCost: number;
  callCount: number;
  avgTokensPerCall: number;
};

export const getAdminUsageByOperation = (
  token: string,
  filters: UsageFilters & { limit?: number },
) =>
  apiRequest<{ operations: UsageByOperationRow[] }>("/admin/analytics/token-usage/by-operation", {
    token,
    query: filters,
  });

export type UsageByDayRow = {
  day: string;
  totalTokens: number;
  totalCost: number;
  requestCount: number;
};

export const getAdminUsageByDay = (token: string, filters: UsageFilters) =>
  apiRequest<{ days: UsageByDayRow[] }>("/admin/analytics/token-usage/by-day", {
    token,
    query: filters,
  });

export type UserUsageDetail = {
  userId: string;
  windowStart: string;
  windowEnd: string;
  totals: { totalTokens: number; totalCost: number; requestCount: number };
  bySource: {
    source: string;
    totalTokens: number;
    totalCost: number;
    requestCount: number;
  }[];
  byModel: {
    model: string;
    totalTokens: number;
    totalCost: number;
    requestCount: number;
  }[];
  byDay: UsageByDayRow[];
};

export const getAdminUserUsageDetail = (
  token: string,
  userId: string,
  query: { startDate?: string; endDate?: string; orgId?: string } = {},
) =>
  apiRequest<UserUsageDetail>(
    `/admin/analytics/token-usage/by-user/${encodeURIComponent(userId)}`,
    { token, query },
  );
