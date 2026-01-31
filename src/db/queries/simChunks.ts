import { getDb } from "..";
import {
  cosineDistance,
  desc,
  gte,
  inArray,
  and,
  or,
  eq,
  sql,
  notInArray,
  getTableColumns,
} from "drizzle-orm";
import type { Chunk } from "@/@types";
import { chunks, userFile, userFileChapter, userFileCluster } from "../schema";

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
  const andConditions = [];

  const db = getDb();
  // Get chunks with user info
  const chunksWithUserInfo = db
    .select({
      ...getTableColumns(chunks),
      userId: userFile.userId,
      orgId: userFile.orgId,
      isAdminFile: userFile.isAdminFile,
    })
    .from(chunks)
    .leftJoin(userFile, eq(chunks.documentId, userFile.id))
    .as("chunksWithUserInfo");

  if (userId && orgId) {
    andConditions.push(
      or(
        and(
          eq(chunksWithUserInfo.userId, userId),
          eq(chunksWithUserInfo.orgId, orgId)
        ), // User's own files
        and(
          eq(chunksWithUserInfo.isAdminFile, true),
          eq(chunksWithUserInfo.orgId, orgId)
        ) // Admin files in same org
      )!
    );
  }

  const similarity = sql<number>`1 - (${cosineDistance(
    chunksWithUserInfo.embedding,
    embedding
  )})`;
  if (documentIds && documentIds.length > 0) {
    andConditions.push(inArray(chunksWithUserInfo.documentId, documentIds));
  }
  if (chapterIds && chapterIds.length > 0) {
    andConditions.push(inArray(chunksWithUserInfo.chapterId, chapterIds));
  }
  if (excludeChunkIds && excludeChunkIds.length > 0) {
    andConditions.push(notInArray(chunksWithUserInfo.id, excludeChunkIds));
  }
  let retryCount = 0;

  while (retryCount < 3) {
    try {
      const similarChunks = await db
        .select({
          id: chunksWithUserInfo.id,
          content: chunksWithUserInfo.content,
          similarity: similarity,
          documentId: chunksWithUserInfo.documentId,
          chapterId: chunksWithUserInfo.chapterId,
          startPage: chunksWithUserInfo.startPage,
          endPage: chunksWithUserInfo.endPage,
        })
        .from(chunksWithUserInfo)
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
  const andConditions = [];
  const db = getDb();
  const clustersWithUserInfo = db
    .select({
      ...getTableColumns(userFileCluster),
      userId: userFile.userId,
      orgId: userFile.orgId,
      isAdminFile: userFile.isAdminFile,
    })
    .from(userFileCluster)
    .leftJoin(userFile, eq(userFileCluster.fileId, userFile.id))
    .as("clustersWithUserInfo");

  if (userId && orgId) {
    andConditions.push(
      or(
        and(
          eq(clustersWithUserInfo.userId, userId),
          eq(clustersWithUserInfo.orgId, orgId)
        ), // User's own files
        and(
          eq(clustersWithUserInfo.isAdminFile, true),
          eq(clustersWithUserInfo.orgId, orgId)
        ) // Admin files in same org
      )!
    );
  }

  const similarity = sql<number>`1 - (${cosineDistance(
    clustersWithUserInfo.embedding,
    embedding
  )})`;
  andConditions.push(gte(similarity, 0.5));
  if (documentIds) {
    andConditions.push(inArray(clustersWithUserInfo.fileId, documentIds));
  }
  const similarClusters = await getDb()
    .select({
      id: clustersWithUserInfo.id,
      documentId: clustersWithUserInfo.fileId,
      startPage: clustersWithUserInfo.startPage,
      endPage: clustersWithUserInfo.endPage,
      summary: clustersWithUserInfo.summary,
      similarity: similarity,
      pageSummaries: clustersWithUserInfo.pageSummaries,
    })
    .from(clustersWithUserInfo)
    .where(and(...andConditions))
    .orderBy((t) => desc(t.similarity))
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
  const andConditions = [];
  const db = getDb();
  const documentsWithUserInfo = db
    .select({
      ...getTableColumns(userFile),
      userId: userFile.userId,
      orgId: userFile.orgId,
      isAdminFile: userFile.isAdminFile,
    })
    .from(userFile)
    .as("documentsWithUserInfo");
  const similarity = sql<number>`1 - (${cosineDistance(
    documentsWithUserInfo.embedding,
    embedding
  )})`;

  andConditions.push(gte(similarity, 0.5));

  // If user context is provided, filter by access permissions
  if (userId && orgId) {
    andConditions.push(
      or(
        and(
          eq(documentsWithUserInfo.userId, userId),
          eq(documentsWithUserInfo.orgId, orgId)
        ), // User's own files
        and(
          eq(documentsWithUserInfo.isAdminFile, true),
          eq(documentsWithUserInfo.orgId, orgId)
        ) // Admin files in same org
      )!
    );
  }

  const similarDocuments = await getDb()
    .select({
      id: documentsWithUserInfo.id,
      title: documentsWithUserInfo.name,
      similarity: similarity,
      metadata: documentsWithUserInfo.metadata,
    })
    .from(documentsWithUserInfo)
    .where(and(...andConditions))
    .orderBy((t) => desc(t.similarity))
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
  const andConditions = [];

  const chaptersWithUserInfo = db
    .select({
      ...getTableColumns(userFileChapter),
      userId: userFile.userId,
      orgId: userFile.orgId,
      isAdminFile: userFile.isAdminFile,
    })
    .from(userFileChapter)
    .leftJoin(userFile, eq(userFileChapter.fileId, userFile.id))
    .as("chaptersWithUserInfo");
  const similarity = sql<number>`1 - (${cosineDistance(
    chaptersWithUserInfo.embedding,
    embedding
  )})`;
  andConditions.push(gte(similarity, 0.5));

  if (userId && orgId) {
    andConditions.push(
      or(
        and(
          eq(chaptersWithUserInfo.userId, userId),
          eq(chaptersWithUserInfo.orgId, orgId)
        ), // User's own files
        and(
          eq(chaptersWithUserInfo.isAdminFile, true),
          eq(chaptersWithUserInfo.orgId, orgId)
        ) // Admin files in same org
      )!
    );
  }
  if (documentIds) {
    andConditions.push(inArray(chaptersWithUserInfo.fileId, documentIds));
  }
  const similarChapters = await getDb()
    .select({
      id: chaptersWithUserInfo.id,
      documentId: chaptersWithUserInfo.fileId,
      title: chaptersWithUserInfo.title,
      summary: chaptersWithUserInfo.summary,
      similarity: similarity,
    })
    .from(chaptersWithUserInfo)
    .where(and(...andConditions))
    .orderBy((t) => desc(t.similarity))
    .offset(page ? (page - 1) * limit : 0)
    .limit(limit);
  return similarChapters;
};
