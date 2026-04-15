import { Type } from "@sinclair/typebox";

export const UserFileSchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
  status: Type.Union([Type.String(), Type.Null()]),
  metadata: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()]),
  userId: Type.String(),
  createdAt: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.Union([Type.String(), Type.Null()]),
});

export const UserFileWithMetaSchema = Type.Intersect([
  UserFileSchema,
  Type.Object({
    numPages: Type.Union([Type.Number(), Type.Null()]),
    numChunks: Type.Union([Type.Number(), Type.Null()]),
    numChapters: Type.Union([Type.Number(), Type.Null()]),
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
