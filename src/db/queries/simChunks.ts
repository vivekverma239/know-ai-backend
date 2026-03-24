import type { Chunk } from "@/@types";
import {
  and,
  cosineDistance,
  desc,
  eq,
  gte,
  inArray,
  notInArray,
  sql,
  type SQL,
} from "drizzle-orm";
import { getDb } from "..";
import { chunks, userFile, userFileChapter, userFileCluster } from "../schema";
import { logger } from "@/utils/logger";
import { buildFileAccessFilter } from "./accessControl";

export type SimilarChunk = Omit<
  Chunk,
  "embedding" | "metadata" | "id" | "chapterId" | "startPage" | "endPage"
> & {
  similarity: number;
  id?: string;
  startPage?: number | null;
  endPage?: number | null;
};

export const getSimilarChunks = async ({
  embedding,
  documentIds,
  chapterIds,
  userId,
  orgId,
  limit = 3,
  page = 1,
  excludeChunkIds,
}: {
  embedding: number[];
  documentIds?: string[];
  chapterIds?: string[];
  userId?: string;
  orgId?: string;
  limit?: number;
  page?: number;
  excludeChunkIds?: string[];
}): Promise<SimilarChunk[]> => {
  const db = getDb();
  const conditions: (SQL | undefined)[] = [];

  // Access control: filter to authorized documents via subquery
  if (userId && orgId) {
    const authorizedDocIds = db
      .select({ id: userFile.id })
      .from(userFile)
      .where(buildFileAccessFilter(userFile.userId, userFile.orgId, userFile.isAdminFile, userId, orgId));
    conditions.push(inArray(chunks.documentId, authorizedDocIds));
  }

  if (documentIds && documentIds.length > 0) {
    conditions.push(inArray(chunks.documentId, documentIds));
  }
  if (chapterIds && chapterIds.length > 0) {
    conditions.push(inArray(chunks.chapterId, chapterIds));
  }
  if (excludeChunkIds && excludeChunkIds.length > 0) {
    conditions.push(notInArray(chunks.id, excludeChunkIds));
  }

  const similarity = sql<number>`1 - (${cosineDistance(chunks.embedding, embedding)})`;

  try {
    const similarChunks = await db
      .select({
        id: chunks.id,
        content: chunks.content,
        similarity,
        documentId: chunks.documentId,
        chapterId: chunks.chapterId,
        startPage: chunks.startPage,
        endPage: chunks.endPage,
      })
      .from(chunks)
      .where(and(...conditions))
      .orderBy(desc(similarity))
      .offset(page ? (page - 1) * limit : 0)
      .limit(limit);

    return similarChunks;
  } catch (error) {
    logger.error("getSimilarChunks failed", { error });
    throw error;
  }
};

export const getSimilarClusters = async ({
  embedding,
  limit = 3,
  documentIds,
  userId,
  orgId,
}: {
  embedding: number[];
  limit?: number;
  documentIds?: string[];
  userId?: string;
  orgId?: string;
}) => {
  const db = getDb();
  const conditions: (SQL | undefined)[] = [];

  // Access control: filter to authorized documents via subquery
  if (userId && orgId) {
    const authorizedDocIds = db
      .select({ id: userFile.id })
      .from(userFile)
      .where(buildFileAccessFilter(userFile.userId, userFile.orgId, userFile.isAdminFile, userId, orgId));
    conditions.push(inArray(userFileCluster.fileId, authorizedDocIds));
  }

  const similarity = sql<number>`1 - (${cosineDistance(userFileCluster.embedding, embedding)})`;
  conditions.push(gte(similarity, 0.5));

  if (documentIds) {
    conditions.push(inArray(userFileCluster.fileId, documentIds));
  }

  const similarClusters = await db
    .select({
      id: userFileCluster.id,
      documentId: userFileCluster.fileId,
      startPage: userFileCluster.startPage,
      endPage: userFileCluster.endPage,
      summary: userFileCluster.summary,
      similarity,
      pageSummaries: userFileCluster.pageSummaries,
    })
    .from(userFileCluster)
    .where(and(...conditions))
    .orderBy(desc(similarity))
    .limit(limit);

  return similarClusters;
};

export const getSimilarDocuments = async ({
  embedding,
  limit = 3,
  userId,
  orgId,
}: {
  embedding: number[];
  limit?: number;
  userId?: string;
  orgId?: string;
}) => {
  const db = getDb();
  const conditions: (SQL | undefined)[] = [];

  const similarity = sql<number>`1 - (${cosineDistance(userFile.embedding, embedding)})`;
  conditions.push(gte(similarity, 0.5));

  // Access control directly on the userFile table
  if (userId && orgId) {
    conditions.push(buildFileAccessFilter(userFile.userId, userFile.orgId, userFile.isAdminFile, userId, orgId));
  }

  const similarDocuments = await db
    .select({
      id: userFile.id,
      title: userFile.name,
      similarity,
      metadata: userFile.metadata,
    })
    .from(userFile)
    .where(and(...conditions))
    .orderBy(desc(similarity))
    .limit(limit);

  return similarDocuments;
};

export const getSimilarChapters = async ({
  embedding,
  limit = 3,
  documentIds,
  userId,
  orgId,
  page = 1,
}: {
  embedding: number[];
  limit?: number;
  documentIds?: string[];
  userId?: string;
  orgId?: string;
  page?: number;
}) => {
  const db = getDb();
  const conditions: (SQL | undefined)[] = [];

  const similarity = sql<number>`1 - (${cosineDistance(userFileChapter.embedding, embedding)})`;
  conditions.push(gte(similarity, 0.5));

  // Access control: filter to authorized documents via subquery
  if (userId && orgId) {
    const authorizedDocIds = db
      .select({ id: userFile.id })
      .from(userFile)
      .where(buildFileAccessFilter(userFile.userId, userFile.orgId, userFile.isAdminFile, userId, orgId));
    conditions.push(inArray(userFileChapter.fileId, authorizedDocIds));
  }

  if (documentIds) {
    conditions.push(inArray(userFileChapter.fileId, documentIds));
  }

  const similarChapters = await db
    .select({
      id: userFileChapter.id,
      documentId: userFileChapter.fileId,
      title: userFileChapter.title,
      summary: userFileChapter.summary,
      similarity,
    })
    .from(userFileChapter)
    .where(and(...conditions))
    .orderBy(desc(similarity))
    .offset(page ? (page - 1) * limit : 0)
    .limit(limit);

  return similarChapters;
};
