import { getEmbeddings } from "@/ai/embeddings";
import {
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
}: {
  query: string;
  documentIds?: string[];
  chapterIds?: string[];
  limit?: number;
  page?: number;
  includeChunkId?: boolean;
  excludeChunkIds?: string[];
}) => {
  const embedding = await getEmbeddings([query]);
  if (!embedding[0]) {
    throw new Error("No embedding found");
  }
  const similarChunks = await getSimilarChunks(
    embedding[0],
    documentIds,
    chapterIds,
    limit,
    page,
    excludeChunkIds
  );
  return similarChunks.map((chunk) => {
    return {
      id: includeChunkId ? chunk.id : undefined,
      documentId: chunk.documentId,
      content: chunk.content,
      similarity: chunk.similarity,
    };
  });
};

/**
 * Performs a similarity search on a query using embeddings and returns similar chunks.
 * @param query - The query to search for.
 * @returns An array of similar chunks.
 */
export const similaritySearchClusters = async (
  query: string,
  documentIds?: string[],
  limit = 3,
  includeChunkId = false
) => {
  const embedding = await getEmbeddings([query]);
  if (!embedding[0]) {
    throw new Error("No embedding found");
  }
  const similarClusters = await getSimilarClusters(
    embedding[0],
    limit,
    documentIds
  );
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

export const similaritySearchChunksWithObserver = async (
  query: string,
  documentIds?: string[],
  chapterIds?: string[],
  limit = 3,
  includeChunkId = false,
  page = 1
) => {
  const fn = async () =>
    observe(
      {
        name: "similaritySearchChunks",
      },
      (query, documentIds, limit, includeChunkId) =>
        similaritySearchChunks({
          query,
          documentIds,
          chapterIds,
          limit,
          includeChunkId,
          page,
        }),
      query,
      documentIds,
      limit,
      includeChunkId
    );
  return await fn();
};
/**
 * Performs a similarity search on a query using embeddings and returns similar documents.
 * @param query - The query to search for.
 * @param limit - The maximum number of documents to return.
 * @returns An array of similar documents.
 */
export const similaritySearchDocuments = async (query: string, limit = 5) => {
  const embedding = await getEmbeddings([query]);
  if (!embedding[0]) {
    throw new Error("No embedding found");
  }
  const similarDocuments = await getSimilarDocuments(embedding[0], limit);
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
export const similaritySearchChapters = async (query: string, limit = 5) => {
  const embedding = await getEmbeddings([query]);
  if (!embedding[0]) {
    throw new Error("No embedding found");
  }
  const similarDocuments = await getSimilarDocuments(embedding[0], limit);
  return similarDocuments.map((doc) => {
    return {
      id: doc.id,
      title: doc.title,
      summary: doc.metadata?.shortSummary,
    };
  });
};

export const similaritySearchDocumentsWithObserver = async (
  query: string,
  limit = 5
) => {
  const fn = async () =>
    observe(
      {
        name: "similaritySearchDocuments",
      },
      (query, limit) => similaritySearchDocuments(query, limit),
      query,
      limit
    );
  return await fn();
};
