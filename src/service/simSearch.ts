import { getEmbeddings } from "@/ai-backend/embeddings";
import {
  getSimilarChapters,
  getSimilarChunks,
  getSimilarClusters,
  getSimilarDocuments,
} from "@/db/queries/simChunks";
import { observe } from "@lmnr-ai/lmnr";
/**
 * Performs a similarity search on a query using embeddings and returns similar chunks.
 * @param query - The query to search for.
 * @returns An array of similar chunks.
 */
export const similaritySearchChunks = async ({
  query,
  documentIds,
  chapterIds,
  limit = 3,
  page = 1,
  includeChunkId = false,
  excludeChunkIds,
  userId,
  orgId,
}: {
  query: string;
  documentIds?: string[];
  chapterIds?: string[];
  limit?: number;
  page?: number;
  includeChunkId?: boolean;
  excludeChunkIds?: string[];
  userId: string;
  orgId: string;
}) => {
  const embedding = await getEmbeddings([query]);
  if (!embedding[0]) {
    throw new Error("No embedding found");
  }
  const similarChunks = await getSimilarChunks({
    embedding: embedding[0],
    documentIds,
    chapterIds,
    userId,
    orgId,
    limit,
    page,
    excludeChunkIds,
  });
  return similarChunks.map((chunk) => {
    return {
      id: includeChunkId ? chunk.id : undefined,
      documentId: chunk.documentId,
      content: chunk.content,
      similarity: chunk.similarity,
      pageNumber: chunk.startPage,
    };
  });
};

/**
 * Performs a similarity search on a query using embeddings and returns similar chunks.
 * @param query - The query to search for.
 * @returns An array of similar chunks.
 */
export const similaritySearchClusters = async ({
  query,
  documentIds,
  limit = 3,
  includeChunkId = false,
  userId,
  orgId,
}: {
  query: string;
  documentIds?: string[];
  limit?: number;
  includeChunkId?: boolean;
  userId: string;
  orgId: string;
}) => {
  const embedding = await getEmbeddings([query]);
  if (!embedding[0]) {
    throw new Error("No embedding found");
  }
  const similarClusters = await getSimilarClusters({
    embedding: embedding[0],
    limit,
    documentIds,
    userId,
    orgId,
  });

  return similarClusters.map((chunk) => {
    return {
      id: includeChunkId ? chunk.id : undefined,
      documentId: chunk.documentId,
      summary: chunk.summary,
      startPage: chunk.startPage,
      endPage: chunk.endPage,
      similarity: chunk.similarity,
      pageSummaries: chunk.pageSummaries,
    };
  });
};

export const similaritySearchChunksWithObserver = async ({
  query,
  documentIds,
  chapterIds,
  limit = 3,
  includeChunkId = false,
  page = 1,
  userId,
  orgId,
}: {
  query: string;
  documentIds?: string[];
  chapterIds?: string[];
  limit?: number;
  includeChunkId?: boolean;
  page?: number;
  userId: string;
  orgId: string;
}) => {
  const fn = async () =>
    observe(
      {
        name: "similaritySearchChunks",
      },
      (query, documentIds, chapterIds, limit, includeChunkId, page, userId, orgId) =>
        similaritySearchChunks({
          query,
          documentIds,
          chapterIds,
          limit,
          includeChunkId,
          page,
          userId,
          orgId,
        }),
      query,
      documentIds,
      chapterIds,
      limit,
      includeChunkId,
      page,
      userId,
      orgId,
    );
  return await fn();
};
/**
 * Performs a similarity search on a query using embeddings and returns similar documents.
 * @param query - The query to search for.
 * @param limit - The maximum number of documents to return.
 * @returns An array of similar documents.
 */
export const similaritySearchDocuments = async ({
  query,
  limit = 5,
  userId,
  orgId,
}: {
  query: string;
  limit?: number;
  userId?: string;
  orgId?: string;
}) => {
  const embedding = await getEmbeddings([query]);
  if (!embedding[0]) {
    throw new Error("No embedding found");
  }
  const similarDocuments = await getSimilarDocuments({
    embedding: embedding[0],
    limit,
    userId,
    orgId,
  });

  return similarDocuments.map((doc) => {
    return {
      id: doc.id,
      title: doc.title,
      summary: doc.metadata?.shortSummary,
    };
  });
};

/**
 * Performs a similarity search on a query using embeddings and returns similar documents.
 * @param query - The query to search for.
 * @param limit - The maximum number of documents to return.
 * @returns An array of similar documents.
 */
export const similaritySearchChapters = async ({
  query,
  limit = 5,
  userId,
  orgId,
}: {
  query: string;
  limit: number;
  userId?: string;
  orgId?: string;
}) => {
  const embedding = await getEmbeddings([query]);
  if (!embedding[0]) {
    throw new Error("No embedding found");
  }
  const similarChapters = await getSimilarChapters({
    embedding: embedding[0],
    limit,
    userId,
    orgId,
  });
  return similarChapters.map((chapter) => {
    return {
      id: chapter.id,
      title: chapter.title,
      summary: chapter.summary,
    };
  });
};

export const similaritySearchDocumentsWithObserver = async (query: string, limit = 5) => {
  const fn = async () =>
    observe(
      {
        name: "similaritySearchDocuments",
      },
      (query, limit) => similaritySearchDocuments({ query, limit }),
      query,
      limit,
    );
  return await fn();
};
