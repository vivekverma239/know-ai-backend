import { getDb } from "..";
import {
  cosineDistance,
  desc,
  gte,
  inArray,
  and,
  sql,
  notInArray,
} from "drizzle-orm";
import { type Chunk } from "@/@types";
import { chunks, userFile, userFileChapter, userFileCluster } from "../schema";

export type SimilarChunk = Omit<
  Chunk,
  "embedding" | "metadata" | "id" | "chapterId" | "startPage" | "endPage"
> & {
  similarity: number;
  id?: string;
};

export const getSimilarChunks = async (
  embedding: number[],
  documentIds?: string[],
  chapterIds?: string[],
  limit = 3,
  page = 1,
  excludeChunkIds?: string[]
): Promise<SimilarChunk[]> => {
  const similarity = sql<number>`1 - (${cosineDistance(
    chunks.embedding,
    embedding
  )})`;
  const andConditions = [];
  if (documentIds && documentIds.length > 0) {
    andConditions.push(inArray(chunks.documentId, documentIds));
  }
  if (chapterIds && chapterIds.length > 0) {
    andConditions.push(inArray(chunks.chapterId, chapterIds));
  }
  if (excludeChunkIds && excludeChunkIds.length > 0) {
    andConditions.push(notInArray(chunks.id, excludeChunkIds));
  }
  let retryCount = 0;
  while (retryCount < 3) {
    try {
      const similarChunks = await getDb()
        .select({
          id: chunks.id,
          content: chunks.content,
          similarity: similarity,
          documentId: chunks.documentId,
          chapterId: chunks.chapterId,
          startPage: chunks.startPage,
          endPage: chunks.endPage,
        })
        .from(chunks)
        .where(and(...andConditions))
        .orderBy((t) => desc(t.similarity))
        .offset(page ? (page - 1) * limit : 0)
        .limit(limit);

      return similarChunks;
    } catch (error) {
      retryCount++;
    }
  }
  return [];
};

export const getSimilarClusters = async (
  embedding: number[],
  limit = 3,
  documentIds?: string[]
) => {
  const similarity = sql<number>`1 - (${cosineDistance(
    userFileCluster.embedding,
    embedding
  )})`;
  const andConditions = [gte(similarity, 0.5)];
  if (documentIds) {
    andConditions.push(inArray(userFileCluster.fileId, documentIds));
  }
  const similarClusters = await getDb()
    .select({
      id: userFileCluster.id,
      documentId: userFileCluster.fileId,
      startPage: userFileCluster.startPage,
      endPage: userFileCluster.endPage,
      summary: userFileCluster.summary,
      similarity: similarity,
      pageSummaries: userFileCluster.pageSummaries,
    })
    .from(userFileCluster)
    .where(and(...andConditions))
    .orderBy((t) => desc(t.similarity))
    .limit(limit);

  return similarClusters;
};

export const getSimilarDocuments = async (embedding: number[], limit = 3) => {
  const similarity = sql<number>`1 - (${cosineDistance(
    userFile.embedding,
    embedding
  )})`;
  const similarDocuments = await getDb()
    .select({
      id: userFile.id,
      title: userFile.name,
      similarity: similarity,
      metadata: userFile.metadata,
    })
    .from(userFile)
    .where(gte(similarity, 0.5))
    .orderBy((t) => desc(t.similarity))
    .limit(limit);

  return similarDocuments;
};

export const getSimilarChapters = async ({
  embedding,
  limit = 3,
  documentIds,
  page = 1,
}: {
  embedding: number[];
  limit?: number;
  documentIds?: string[];
  page?: number;
}) => {
  const similarity = sql<number>`1 - (${cosineDistance(
    userFileChapter.embedding,
    embedding
  )})`;
  const andConditions = [];
  if (documentIds) {
    andConditions.push(inArray(userFileChapter.fileId, documentIds));
  }
  const similarChapters = await getDb()
    .select({
      id: userFileChapter.id,
      documentId: userFileChapter.fileId,
      title: userFileChapter.title,
      summary: userFileChapter.summary,
      similarity: similarity,
    })
    .from(userFileChapter)
    .where(and(...andConditions))
    .orderBy((t) => desc(t.similarity))
    .offset(page ? (page - 1) * limit : 0)
    .limit(limit);
  return similarChapters;
};
