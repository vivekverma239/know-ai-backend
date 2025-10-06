import {
  chunks,
  userFile,
  userFileChapter,
  userFileCluster,
  userFileHeirarchialIndex,
  userFilePage,
  userFileSection,
} from "@/db/schema";
import { and, count, eq, gte, lte } from "drizzle-orm";
import { getDb } from "@/db";
import type {
  Chapter,
  Section,
  Subsection,
  SubsectionAPI,
} from "@/@types/fileIndex";
import { getEmbeddings } from "@/ai-backend/embeddings";
import { logger } from "@/utils/logger";
import type { ParsedPDF } from "@/@types/parsedData";
import type { DocumentMetadata } from "@/@types/metadata";
import type { HeirarchialIndexData } from "@/@types/heirarchialIndex";

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
          lte(chunks.endPage, chapter.endPage)
        )
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
  // Delete existing sections and chapters
  logger.info(`Deleting existing sections and chapters for file ${fileId}`);
  await getDb()
    .delete(userFileSection)
    .where(eq(userFileSection.fileId, fileId));
  await getDb()
    .delete(userFileChapter)
    .where(eq(userFileChapter.fileId, fileId));

  const files = await getDb()
    .select()
    .from(userFile)
    .where(eq(userFile.id, fileId));
  if (!files[0]) throw new Error("File not found");

  const file = files[0];
  for (const [index, chapter] of chapters.entries()) {
    logger.info(`Creating chapter ${index + 1} for file ${fileId}`);
    const chapterEmbedding = (
      await getEmbeddings([
        `Document Title: ${title}\nChapter ${index + 1} Title: ${
          chapter.title
        }\nChapter Summary: ${chapter.summary}`,
      ])
    )[0];
    const [newChapter] = await getDb()
      .insert(userFileChapter)
      .values({
        fileId,
        userId: file.userId,
        orgId: file.orgId,
        startPage: chapter.start_page,
        endPage: chapter.end_page,
        summary: chapter.summary ?? "No summary",
        title: chapter.title,
        embedding: chapterEmbedding,
      })
      .returning();
    if (!newChapter) throw new Error("Failed to create chapter");

    logger.info(
      `Creating sections for chapter ${index + 1} for file ${fileId}`
    );
    const sectionEmbeddings = await getEmbeddings(
      chapter.sections.map(
        (section: Section) =>
          `Section ${section.start_page}-${section.end_page}: ${section.section_summary}`
      )
    );
    const sectionData = chapter.sections.map((section: Section, i: number) => ({
      fileId,
      userId: file.userId,
      orgId: file.orgId,
      startPage: section.start_page,
      endPage: section.end_page,
      summary: section.section_summary,
      title: section.title,
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
  logger.info(`Updating chapters for chunks for file ${fileId}`);
  await updateChapterForChunks(fileId);
  await updateStatus(fileId);
};

export const updateParsedPages = async (
  fileId: string,
  parsedData: ParsedPDF
) => {
  // Delete existing pages
  await getDb().delete(userFilePage).where(eq(userFilePage.fileId, fileId));
  // Delete existing chunks
  await getDb().delete(chunks).where(eq(chunks.documentId, fileId));
  // Create new pages
  await getDb()
    .insert(userFilePage)
    .values(
      parsedData.pages.map((page) => ({
        fileId,
        pageNumber: page.page_number,
        content: page.content,
      }))
    );

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
  const embeddings = await getEmbeddings(chunkInputs.map((c) => c.content));
  await getDb()
    .insert(chunks)
    .values(
      chunkInputs.map((c, i) => ({
        content: c.content,
        documentId: fileId,
        startPage: c.start,
        endPage: c.end,
        embedding: embeddings[i],
      }))
    );

  await updateChapterForChunks(fileId);
  await updateStatus(fileId);
};

export const updateParsedMetadata = async (
  fileId: string,
  parsedData: DocumentMetadata
) => {
  const files = await getDb()
    .select()
    .from(userFile)
    .where(eq(userFile.id, fileId));
  if (!files[0]) throw new Error("File not found");

  const file = files[0];
  const { clusters } = parsedData;
  const total_pages = parsedData.total_pages;
  const clusterDocs = clusters.map((cluster) => ({
    fileId,
    startPage: cluster.start_page,
    endPage: cluster.end_page,
    summary: cluster.cluster_summary,
    pageSummaries: parsedData.page_summaries.filter(
      (page) =>
        page.page_number >= Math.max(cluster.start_page - 5, 0) &&
        page.page_number <= Math.min(cluster.end_page + 5, total_pages - 1)
    ),
  }));
  const embeddings = await getEmbeddings(
    clusterDocs.map(
      (c) =>
        `Cluster ${c.startPage}-${c.endPage}: ${c.summary}\n${c.pageSummaries
          .map((p) => p.summary)
          .join("\n")}`
    )
  );
  await getDb()
    .delete(userFileCluster)
    .where(eq(userFileCluster.fileId, fileId));
  await getDb()
    .insert(userFileCluster)
    .values(
      clusterDocs.map((c, i) => ({
        ...c,
        embedding: embeddings[i],
        userId: file.userId,
        orgId: file.orgId,
      }))
    );

  const fileEmbedding = (
    await getEmbeddings([
      `Document Title: ${parsedData.document_metadata.title}\n${JSON.stringify(
        parsedData.document_metadata.summary
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
        referencePeriodEnd:
          parsedData.document_metadata.reference_period_end_date,
        documentPublishedDate:
          parsedData.document_metadata.document_published_date,
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
      embedding: fileEmbedding!,
      status: "processed",
      updatedAt: new Date(),
    })
    .where(eq(userFile.id, fileId));
  await updateStatus(fileId);
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
  const file = await getDb()
    .select()
    .from(userFile)
    .where(eq(userFile.id, fileId));
  const metadata = file[0]?.metadata;

  if (
    pagesCount[0]?.count === 0 ||
    chaptersCount[0]?.count === 0 ||
    !metadata?.summary
  ) {
    // Do nothing
    return;
  }

  await getDb()
    .update(userFile)
    .set({ status: "processed" })
    .where(eq(userFile.id, fileId));
};

export const updateHeirarchialIndex = async (
  fileId: string,
  data: HeirarchialIndexData
) => {
  const files = await getDb()
    .select()
    .from(userFile)
    .where(eq(userFile.id, fileId));
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
  const embeddings = await getEmbeddings(
    levelData.map(
      (level) =>
        `\nLevel ${level.startPage}-${level.endPage}: ${
          level.summary
        }\n${level.children.map((child) => child.summary).join("\n")}`
    )
  );
  await getDb()
    .delete(userFileHeirarchialIndex)
    .where(eq(userFileHeirarchialIndex.fileId, fileId));
  await getDb()
    .insert(userFileHeirarchialIndex)
    .values(
      levelData.map((level, index) => ({
        ...level,
        userId: file.userId,
        orgId: file.orgId,
        embedding: embeddings[index],
      }))
    );
};
