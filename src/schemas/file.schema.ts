import { Type } from "@sinclair/typebox";

export const UserFileSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  status: Type.String(),
  metadata: Type.Optional(Type.Object({}, { additionalProperties: true })),
  userId: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.Optional(Type.String()),
});

export const UserFileWithMetaSchema = Type.Intersect([
  UserFileSchema,
  Type.Object({
    numPages: Type.Optional(Type.Number()),
    numChunks: Type.Optional(Type.Number()),
    numChapters: Type.Optional(Type.Number()),
  }),
]);

export const SignedUrlResponse = Type.Object({ signedUrl: Type.String() });

export const FilePagesResponse = Type.Object({
  pages: Type.Array(
    Type.Object({
      id: Type.String(),
      fileId: Type.String(),
      pageNumber: Type.Number(),
      content: Type.String(),
    }),
  ),
  total: Type.Number(),
});

export const FileSectionsResponse = Type.Object({
  sections: Type.Array(
    Type.Object({
      id: Type.String(),
      fileId: Type.String(),
      chapterId: Type.Optional(Type.String()),
      startPage: Type.Number(),
      endPage: Type.Number(),
      title: Type.String(),
      summary: Type.String(),
    }),
  ),
  total: Type.Number(),
});

export const HierarchicalIndexItems = Type.Object({
  items: Type.Array(
    Type.Object({
      id: Type.String(),
      fileId: Type.String(),
      title: Type.String(),
      summary: Type.String(),
      level: Type.Number(),
      startPage: Type.Number(),
      endPage: Type.Number(),
    }),
  ),
});

export const DeleteResponse = Type.Object({ success: Type.Boolean() });

export const FileUploadRequest = Type.Object({
  name: Type.Optional(Type.String()),
});

export const FileUploadResponse = Type.Object({
  fileId: Type.String(),
  name: Type.String(),
  status: Type.String(),
  message: Type.String(),
});
