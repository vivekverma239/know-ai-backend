import { Type } from "@sinclair/typebox";

export const AdminLoginRequestSchema = Type.Object({
  userId: Type.String({ minLength: 1 }),
  password: Type.String({ minLength: 1 }),
});

export const AdminLoginResponseSchema = Type.Object({
  challengeToken: Type.String(),
  expiresInSeconds: Type.Number(),
});

export const AdminVerifyTotpRequestSchema = Type.Object({
  challengeToken: Type.String(),
  totpCode: Type.String({ minLength: 6, maxLength: 8 }),
});

export const AdminSessionSchema = Type.Object({
  admin: Type.Object({
    userId: Type.String(),
  }),
  expiresAt: Type.String({ format: "date-time" }),
});

export const AdminVerifyTotpResponseSchema = Type.Intersect([
  AdminSessionSchema,
  Type.Object({
    accessToken: Type.String(),
  }),
]);

export const AdminOrgItemSchema = Type.Object({
  orgId: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
  documentCount: Type.Number(),
});

export const AdminOrgListResponseSchema = Type.Object({
  items: Type.Array(AdminOrgItemSchema),
});

export const AdminDocumentSummarySchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  status: Type.String(),
  type: Type.String(),
  isAdminFile: Type.Boolean(),
  userId: Type.String(),
  orgId: Type.String(),
  metadata: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()]),
  sourceDocumentId: Type.Union([Type.Number(), Type.Null()]),
  sourceDocumentUrl: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  numPages: Type.Number(),
  numChunks: Type.Number(),
  numChapters: Type.Number(),
  numSections: Type.Number(),
});

export const AdminDocumentListResponseSchema = Type.Object({
  items: Type.Array(AdminDocumentSummarySchema),
  total: Type.Number(),
});

export const AdminDocumentDetailResponseSchema = Type.Intersect([
  AdminDocumentSummarySchema,
  Type.Object({
    signedUrl: Type.Union([Type.String(), Type.Null()]),
    webArticleMetadata: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()]),
  }),
]);

export const AdminDocumentPageSchema = Type.Object({
  id: Type.String(),
  fileId: Type.String(),
  pageNumber: Type.Number(),
  content: Type.String(),
});

export const AdminDocumentPagesResponseSchema = Type.Object({
  items: Type.Array(AdminDocumentPageSchema),
  total: Type.Number(),
});

export const AdminDocumentSectionSchema = Type.Object({
  id: Type.String(),
  fileId: Type.String(),
  chapterId: Type.Union([Type.String(), Type.Null()]),
  startPage: Type.Number(),
  endPage: Type.Number(),
  title: Type.String(),
  summary: Type.String(),
  metadata: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()]),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
});

export const AdminDocumentSectionsResponseSchema = Type.Object({
  items: Type.Array(AdminDocumentSectionSchema),
  total: Type.Number(),
});

export const AdminDocumentChapterSchema = Type.Object({
  id: Type.String(),
  fileId: Type.String(),
  title: Type.String(),
  summary: Type.String(),
  startPage: Type.Number(),
  endPage: Type.Number(),
  createdAt: Type.String({ format: "date-time" }),
});

export const AdminDocumentChaptersResponseSchema = Type.Object({
  items: Type.Array(AdminDocumentChapterSchema),
  total: Type.Number(),
});

export const AdminDocumentTocMetadataResponseSchema = Type.Object({
  toc: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()]),
  extractedMetadata: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()]),
  fileMetadata: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()]),
  pages: Type.Union([
    Type.Array(Type.Object({}, { additionalProperties: true })),
    Type.Null(),
  ]),
});

export const AdminEntitySummarySchema = Type.Object({
  id: Type.Number(),
  name: Type.String(),
  type: Type.Union([Type.String(), Type.Null()]),
  description: Type.Union([Type.String(), Type.Null()]),
  highlightCount: Type.Number(),
  documentCount: Type.Number(),
  lastMentionedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
});

export const AdminEntityListResponseSchema = Type.Object({
  items: Type.Array(AdminEntitySummarySchema),
  total: Type.Number(),
});

export const AdminHighlightItemSchema = Type.Object({
  id: Type.Number(),
  documentId: Type.Union([Type.Number(), Type.Null()]),
  content: Type.Union([Type.String(), Type.Null()]),
  type: Type.Union([Type.String(), Type.Null()]),
  aiSummary: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: "date-time" }),
});

export const AdminRelatedDocumentSchema = Type.Object({
  id: Type.Number(),
  title: Type.Union([Type.String(), Type.Null()]),
  type: Type.Union([Type.String(), Type.Null()]),
  documentUrl: Type.Union([Type.String(), Type.Null()]),
  linkedUserFileId: Type.Union([Type.String(), Type.Null()]),
});

export const AdminEntityDetailResponseSchema = Type.Object({
  entity: Type.Object({
    id: Type.Number(),
    name: Type.String(),
    uniqueId: Type.Union([Type.String(), Type.Null()]),
    type: Type.Union([Type.String(), Type.Null()]),
    description: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  }),
  highlights: Type.Object({
    items: Type.Array(AdminHighlightItemSchema),
    total: Type.Number(),
  }),
  relatedDocuments: Type.Array(AdminRelatedDocumentSchema),
});
