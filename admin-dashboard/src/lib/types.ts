export type AdminSession = {
  admin: {
    userId: string;
  };
  expiresAt: string;
};

export type AdminLoginResponse = {
  challengeToken: string;
  expiresInSeconds: number;
};

export type AdminVerifyTotpResponse = AdminSession & {
  accessToken: string;
};

export type AdminOrgItem = {
  orgId: string;
  name: string | null;
  documentCount: number;
};

export type AdminDocumentSummary = {
  id: string;
  name: string;
  status: string;
  type: string;
  isAdminFile: boolean;
  userId: string;
  orgId: string;
  metadata: Record<string, unknown> | null;
  sourceDocumentId: number | null;
  sourceDocumentUrl: string | null;
  createdAt: string;
  updatedAt: string | null;
  numPages: number;
  numChunks: number;
  numChapters: number;
  numSections: number;
};

export type AdminDocumentDetail = AdminDocumentSummary & {
  signedUrl: string | null;
  webArticleMetadata: Record<string, unknown> | null;
};

export type AdminDocumentPage = {
  id: string;
  fileId: string;
  pageNumber: number;
  content: string;
};

export type AdminDocumentSubsection = {
  id: string;
  title: string;
  startPage: number;
  endPage: number;
  summary: string;
};

export type AdminDocumentSection = {
  id: string;
  fileId: string;
  chapterId: string | null;
  startPage: number;
  endPage: number;
  title: string;
  summary: string;
  subsections: AdminDocumentSubsection[] | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string | null;
};

export type AdminDocumentChapter = {
  id: string;
  fileId: string;
  title: string;
  summary: string;
  startPage: number;
  endPage: number;
  createdAt: string;
};

export type AdminDocumentTocMetadata = {
  toc: Record<string, unknown> | null;
  extractedMetadata: Record<string, unknown> | null;
  fileMetadata: Record<string, unknown> | null;
  pages: Record<string, unknown>[] | null;
};

export type AdminEntitySummary = {
  id: number;
  name: string;
  type: string | null;
  description: string | null;
  highlightCount: number;
  documentCount: number;
  lastMentionedAt: string | null;
};

export type AdminEntityHighlight = {
  id: number;
  documentId: number | null;
  content: string | null;
  type: string | null;
  aiSummary: string | null;
  createdAt: string;
};

export type AdminRelatedDocument = {
  id: number;
  title: string | null;
  type: string | null;
  documentUrl: string | null;
  linkedUserFileId: string | null;
};

// --- Playground types ---

export type PlaygroundMember = {
  id: string;
  name: string | null;
  teams: { id: string; name: string | null }[];
};

export type PlaygroundTemplate = {
  id: string;
  userId: string;
  title: string;
  taskDescription: string;
  prompts: {
    initialResearchPrompt: string;
    subQuestionsIdentificationPrompt: string;
    finalReportPrompt: string;
  } | null;
};

export type PlaygroundReportSummary = {
  id: string;
  userId: string;
  templateId: string;
  topic: string;
  referencePeriod: string | null;
  status: "pending" | "in_progress" | "completed" | "failed";
  metadata: { title?: string; summary?: string } | null;
  templateName: string | null;
};

export type PlaygroundReportDetail = PlaygroundReportSummary & {
  stepOutputs: unknown;
  finalOutput: string | null;
  sources: { title?: string; url?: string }[] | null;
  usage: Record<string, unknown> | null;
  modelConfig: unknown;
};

export type AdminEntityDetail = {
  entity: {
    id: number;
    name: string;
    uniqueId: string | null;
    type: string | null;
    description: string | null;
    createdAt: string;
    updatedAt: string | null;
  };
  highlights: {
    items: AdminEntityHighlight[];
    total: number;
  };
  relatedDocuments: AdminRelatedDocument[];
};
