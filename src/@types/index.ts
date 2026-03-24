import type {
  chatSession,
  chunks,
  messages,
  textNote,
  userFile,
  userFileChapter,
  userFileCluster,
  userFilePage,
  userFileSection,
} from "@/db/schema";

export type UserFile = typeof userFile.$inferSelect;
export type UserFileWithMeta = Omit<UserFile, "embedding"> & {
  numPages: number;
  numChunks: number;
  numChapters: number;
};
export interface UserFileDetails extends UserFile {
  signedUrl: string;
}

export type Citation = {
  documentId: string;
  pageNumber: number;
  title: string;
  summary: string;
  pageContent: string;
};

export type UserFilePage = typeof userFilePage.$inferSelect;
export type TextNote = typeof textNote.$inferSelect;
export type ChatSession = typeof chatSession.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Chunk = typeof chunks.$inferSelect;
export type UserFileCluster = typeof userFileCluster.$inferSelect;
export type UserFileSection = typeof userFileSection.$inferSelect;
export type UserFileChapter = typeof userFileChapter.$inferSelect;
