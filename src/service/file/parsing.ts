import type { Chapter, Section, Subsection, SubsectionAPI } from "@/@types/fileIndex";
import type { HeirarchialIndexData } from "@/@types/heirarchialIndex";
import type { DocumentMetadata } from "@/@types/metadata";
import type { ParsedPDF } from "@/@types/parsedData";
import { getEmbeddings } from "@/ai-backend/embeddings";
import { getDb } from "@/db";
import {
  chunks,
  userFile,
  userFileChapter,
  userFileCluster,
  userFileHeirarchialIndex,
  userFilePage,
  userFileSection,
} from "@/db/schema";
import { logError, logger } from "@/utils/logger";
import { timed } from "@/utils/performance";
import { traceManager } from "@/utils/tracing";
import { and, count, eq, gte, lte } from "drizzle-orm";

/**
 * Update the chapters for the chunks
 * @param fileId - The id of the file to update the chapters for
 */
export const updateChapterForChunks = async (fileId: string) => {
  const chapters = await getDb()
    .select()
    .from(userFileChapter)
    .where(eq(userFileChapter.fileId, fileId));
  for (const chapter of chapters) {
    await getDb()
      .update(chunks)
      .set({ chapterId: chapter.id })
      .where(
        and(
          eq(chunks.documentId, fileId),
          gte(chunks.startPage, chapter.startPage),
          lte(chunks.endPage, chapter.endPage),
        ),
      );
  }
};

export const updateOutline = async ({
  chapters,
  title,
  summary,
  fileId,
}: {
  chapters: Chapter[];
  title: string;
  summary: string;
  fileId: string;
}) => {
  return traceManager.withSpan(
    "file:updateOutline",
    async (span) => {
      try {
        // Delete existing sections and chapters
        logger.info("Deleting existing sections and chapters for file", {
          fileId,
          chapterCount: chapters.length,
          spanId: span.id,
        });
        await getDb().delete(userFileSection).where(eq(userFileSection.fileId, fileId));
        await getDb().delete(userFileChapter).where(eq(userFileChapter.fileId, fileId));

        const files = await getDb().select().from(userFile).where(eq(userFile.id, fileId));
        if (!files[0]) throw new Error("File not found");

        const file = files[0];

        // Generate all chapter embeddings in one batch
        const chapterEmbeddingTexts = chapters.map(
          (chapter, index) =>
            `Document Title: ${title}\nChapter ${index + 1} Title: ${chapter.title}\nChapter Summary: ${chapter.summary}`,
        );
        const chapterEmbeddings = chapterEmbeddingTexts.length > 0
          ? await getEmbeddings(chapterEmbeddingTexts)
          : [];

        // Bulk insert all chapters
        const insertedChapters = chapters.length > 0
          ? await getDb()
              .insert(userFileChapter)
              .values(
                chapters.map((chapter, index) => ({
                  fileId,
                  userId: file.userId,
                  orgId: file.orgId,
                  startPage: chapter.start_page,
                  endPage: chapter.end_page,
                  summary: chapter.summary ?? "No summary",
                  title: chapter.title,
                  embedding: chapterEmbeddings[index],
                })),
              )
              .returning()
          : [];

        // Insert sections for each chapter
        for (const [index, chapter] of chapters.entries()) {
          const newChapter = insertedChapters[index];
          if (!newChapter) continue;

          logger.info(`Creating sections for chapter ${index + 1} for file ${fileId}`);
          const chapterSections = Array.isArray(chapter.sections) ? chapter.sections : [];
          if (chapterSections.length === 0) {
            logger.info("No sections found for chapter; skipping section insert", {
              fileId,
              chapterIndex: index,
              chapterTitle: chapter.title,
              spanId: span.id,
            });
            continue;
          }

          const sectionEmbeddings = await getEmbeddings(
            chapterSections.map(
              (section: Section) =>
                `Section ${section.start_page}-${section.end_page}: ${section.section_summary}`,
            ),
          );
          const sectionData = chapterSections.map((section: Section, i: number) => ({
            fileId,
            userId: file.userId,
            orgId: file.orgId,
            startPage: section.start_page,
            endPage: section.end_page,
            title: section.title,
            summary: section.section_summary ?? "",
            chapterId: newChapter.id,
            embedding: sectionEmbeddings[i],
            subsections: section.subsections?.map((sub: SubsectionAPI) => ({
              id: sub.id,
              startPage: sub.start_page,
              endPage: sub.end_page,
              summary: sub.subsection_summary,
              title: sub.title,
            })),
          }));
          await getDb().insert(userFileSection).values(sectionData);
        }
        logger.info("Updating chapters for chunks for file", { fileId, spanId: span.id });
        await updateChapterForChunks(fileId);
        await updateStatus(fileId);

        logger.info("Outline updated successfully", {
          fileId,
          chapterCount: chapters.length,
          spanId: span.id,
        });
      } catch (error) {
        logError(error, {
          fileId,
          operation: "updateOutline",
          chapterCount: chapters.length,
          spanId: span.id,
        });
        throw error;
      }
    },
    { fileId, operation: "updateOutline", chapterCount: chapters.length },
  );
};

export const updateParsedPages = async (fileId: string, parsedData: ParsedPDF) => {
  return traceManager.withSpan(
    "file:updateParsedPages",
    async (span) => {
      try {
        const pageCount = parsedData.pages.length;
        logger.info("Starting parsed pages update", {
          fileId,
          pageCount,
          spanId: span.id,
        });

        // Delete existing pages
        await getDb().delete(userFilePage).where(eq(userFilePage.fileId, fileId));
        // Delete existing chunks
        await getDb().delete(chunks).where(eq(chunks.documentId, fileId));

        // Create new pages
        if (parsedData.pages.length > 0) {
          await getDb()
            .insert(userFilePage)
            .values(
              parsedData.pages.map((page) => ({
                fileId,
                pageNumber: page.page_number,
                content: page.content,
              })),
            );
        } else {
          logger.warn("No parsed pages returned; skipping page and chunk inserts", {
            fileId,
            spanId: span.id,
          });
        }

        logger.info("Pages inserted, creating chunks", {
          fileId,
          pageCount,
          spanId: span.id,
        });

        const chunkInputs = [] as Array<{
          content: string;
          start: number;
          end: number;
        }>;
        for (const page of parsedData.pages) {
          chunkInputs.push({
            content: page.content,
            start: page.page_number,
            end: page.page_number,
          });
        }

        // Generate embeddings for chunks
        if (chunkInputs.length > 0) {
          const embeddings = await timed(
            "generateEmbeddings",
            async () => {
              return getEmbeddings(chunkInputs.map((c) => c.content));
            },
            { fileId, chunkCount: chunkInputs.length },
          );

          await getDb()
            .insert(chunks)
            .values(
              chunkInputs.map((c, i) => ({
                content: c.content,
                documentId: fileId,
                startPage: c.start,
                endPage: c.end,
                embedding: embeddings[i],
              })),
            );
        }

        logger.info("Chunks created, updating chapter associations", {
          fileId,
          chunkCount: chunkInputs.length,
          spanId: span.id,
        });

        await updateChapterForChunks(fileId);
        await updateStatus(fileId);

        logger.info("Parsed pages updated successfully", {
          fileId,
          pageCount,
          chunkCount: chunkInputs.length,
          spanId: span.id,
        });
      } catch (error) {
        logError(error, {
          fileId,
          operation: "updateParsedPages",
          pageCount: parsedData.pages.length,
          spanId: span.id,
        });
        throw error;
      }
    },
    { fileId, operation: "updateParsedPages", pageCount: parsedData.pages.length },
  );
};

export const updateParsedMetadata = async (fileId: string, parsedData: DocumentMetadata) => {
  return traceManager.withSpan(
    "file:updateParsedMetadata",
    async (span) => {
      try {
        logger.info("Starting metadata update", {
          fileId,
          title: parsedData.document_metadata.title,
          spanId: span.id,
        });

        const files = await getDb().select().from(userFile).where(eq(userFile.id, fileId));
        if (!files[0]) throw new Error("File not found");

        const file = files[0];
        const { clusters } = parsedData;
        const total_pages = parsedData.total_pages;

        logger.info("Processing clusters for metadata", {
          fileId,
          clusterCount: clusters.length,
          spanId: span.id,
        });

        const clusterDocs = clusters.map((cluster) => ({
          fileId,
          startPage: cluster.start_page,
          endPage: cluster.end_page,
          summary: cluster.cluster_summary,
          pageSummaries: parsedData.page_summaries.filter(
            (page) =>
              page.page_number >= Math.max(cluster.start_page - 5, 0) &&
              page.page_number <= Math.min(cluster.end_page + 5, total_pages - 1),
          ),
        }));

        await getDb().delete(userFileCluster).where(eq(userFileCluster.fileId, fileId));
        if (clusterDocs.length > 0) {
          const embeddings = await getEmbeddings(
            clusterDocs.map(
              (c) =>
                `Cluster ${c.startPage}-${c.endPage}: ${c.summary}\n${c.pageSummaries
                  .map((p) => p.summary)
                  .join("\n")}`,
            ),
          );

          await getDb()
            .insert(userFileCluster)
            .values(
              clusterDocs.map((c, i) => ({
                ...c,
                embedding: embeddings[i],
                userId: file.userId,
                orgId: file.orgId,
              })),
            );
        } else {
          logger.info("No metadata clusters found; skipping cluster insert", {
            fileId,
            spanId: span.id,
          });
        }

        logger.info("Clusters processed, updating file metadata", {
          fileId,
          spanId: span.id,
        });

        const fileEmbedding = (
          await getEmbeddings([
            `Document Title: ${parsedData.document_metadata.title}\n${JSON.stringify(
              parsedData.document_metadata.summary,
            )}`,
          ])
        )[0];

        await getDb()
          .update(userFile)
          .set({
            name: parsedData.document_metadata.title,
            metadata: {
              summary: parsedData.document_metadata.summary,
              shortSummary: parsedData.document_metadata.short_summary,
              referencePeriod: parsedData.document_metadata.reference_period,
              documentType: parsedData.document_metadata.document_type,
              year: parsedData.document_metadata.published_year,
              title: parsedData.document_metadata.title,
              referencePeriodEnd: parsedData.document_metadata.reference_period_end_date,
              documentPublishedDate: parsedData.document_metadata.document_published_date,
              industry: parsedData.document_metadata.industry,
              companies: parsedData.document_metadata.companies?.map((company) => ({
                name: company.name,
                countries: company.countries,
                industry: company.industry,
                productsOrServices: company.products_or_services,
                customers: company.customers,
                suppliers: company.suppliers,
              })),
            },
            embedding: fileEmbedding,
            updatedAt: new Date(),
          })
          .where(eq(userFile.id, fileId));

        await updateStatus(fileId);

        logger.info("Metadata updated successfully", {
          fileId,
          clusterCount: clusters.length,
          spanId: span.id,
        });
      } catch (error) {
        logError(error, {
          fileId,
          operation: "updateParsedMetadata",
          spanId: span.id,
        });
        throw error;
      }
    },
    { fileId, operation: "updateParsedMetadata" },
  );
};

export const updateStatus = async (fileId: string) => {
  // Check if pages are there
  const pagesCount = await getDb()
    .select({ count: count() })
    .from(userFilePage)
    .where(eq(userFilePage.fileId, fileId));

  // Check if chapters are there
  const chaptersCount = await getDb()
    .select({ count: count() })
    .from(userFileChapter)
    .where(eq(userFileChapter.fileId, fileId));

  // Check if metadata are there
  const file = await getDb().select().from(userFile).where(eq(userFile.id, fileId));
  const metadata = file[0]?.metadata;

  if (pagesCount[0]?.count === 0 || chaptersCount[0]?.count === 0 || !metadata?.summary) {
    // Do nothing
    return;
  }

  await getDb().update(userFile).set({ status: "completed" }).where(eq(userFile.id, fileId));
};

export const updateHeirarchialIndex = async (fileId: string, data: HeirarchialIndexData) => {
  return traceManager.withSpan(
    "file:updateHeirarchialIndex",
    async (span) => {
      try {
        logger.info("Starting hierarchical index update", {
          fileId,
          levelCount: data.levels.length,
          spanId: span.id,
        });

        const files = await getDb().select().from(userFile).where(eq(userFile.id, fileId));
        if (!files[0]) throw new Error("File not found");

        const file = files[0];
        const levelData = data.levels.map((level) => ({
          fileId,
          startPage: level.start_page,
          endPage: level.end_page,
          title: level.title,
          level: level.level,
          summary: level.summary,
          children: level.children.map((child) => ({
            startPage: child.start_page,
            endPage: child.end_page,
            summary: child.summary,
          })),
        }));

        logger.info("Generating embeddings for hierarchical index", {
          fileId,
          levelCount: levelData.length,
          spanId: span.id,
        });

        await getDb()
          .delete(userFileHeirarchialIndex)
          .where(eq(userFileHeirarchialIndex.fileId, fileId));
        if (levelData.length > 0) {
          const embeddings = await getEmbeddings(
            levelData.map(
              (level) =>
                `\nLevel ${level.startPage}-${level.endPage}: ${
                  level.summary
                }\n${level.children.map((child) => child.summary).join("\n")}`,
            ),
          );

          await getDb()
            .insert(userFileHeirarchialIndex)
            .values(
              levelData.map((level, index) => ({
                ...level,
                userId: file.userId,
                orgId: file.orgId,
                embedding: embeddings[index],
              })),
            );
        } else {
          logger.info("No hierarchical index levels found; skipping insert", {
            fileId,
            spanId: span.id,
          });
        }

        logger.info("Hierarchical index updated successfully", {
          fileId,
          levelCount: levelData.length,
          spanId: span.id,
        });
      } catch (error) {
        logError(error, {
          fileId,
          operation: "updateHeirarchialIndex",
          levelCount: data.levels.length,
          spanId: span.id,
        });
        throw error;
      }
    },
    { fileId, operation: "updateHeirarchialIndex", levelCount: data.levels.length },
  );
};
