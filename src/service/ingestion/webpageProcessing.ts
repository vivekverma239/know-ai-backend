import { getEmbeddings } from "@/ai-backend/embeddings";
import { getDb } from "@/db";
import { chunks, userFile, userFilePage } from "@/db/schema";
import { logger } from "@/utils/logger";
import { eq } from "drizzle-orm";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

// Remove noisy HTML elements before conversion
turndown.remove(["script", "style", "nav", "footer", "header", "noscript", "iframe"]);

const WORDS_PER_PAGE = 500;

/**
 * Split markdown text into pages of ~500 words each.
 * Splits on paragraph boundaries (double newline) to avoid cutting mid-paragraph.
 */
function splitIntoPages(markdown: string): string[] {
  const paragraphs = markdown.split(/\n\n+/).filter((p) => p.trim().length > 0);
  const pages: string[] = [];
  let currentPage: string[] = [];
  let currentWordCount = 0;

  for (const paragraph of paragraphs) {
    const wordCount = paragraph.split(/\s+/).length;

    if (currentWordCount > 0 && currentWordCount + wordCount > WORDS_PER_PAGE) {
      pages.push(currentPage.join("\n\n"));
      currentPage = [paragraph];
      currentWordCount = wordCount;
    } else {
      currentPage.push(paragraph);
      currentWordCount += wordCount;
    }
  }

  if (currentPage.length > 0) {
    pages.push(currentPage.join("\n\n"));
  }

  return pages.length > 0 ? pages : [markdown.trim() || "Empty content"];
}

/**
 * Process webpage HTML content into pages with embeddings.
 * Converts HTML to markdown, splits into ~500-word pages,
 * generates embeddings, and stores pages + chunks.
 */
export const processWebpageContent = async (
  fileId: string,
  html: string,
  url: string,
  title: string,
): Promise<void> => {
  logger.info("Starting webpage content processing", { fileId, url });

  // 1. Convert HTML to markdown
  const markdown = turndown.turndown(html);
  logger.info("HTML converted to markdown", {
    fileId,
    markdownLength: markdown.length,
  });

  // 2. Split into pages
  const pages = splitIntoPages(markdown);
  logger.info("Markdown split into pages", {
    fileId,
    pageCount: pages.length,
  });

  // 3. Delete existing pages and chunks (idempotent)
  await getDb().delete(userFilePage).where(eq(userFilePage.fileId, fileId));
  await getDb().delete(chunks).where(eq(chunks.documentId, fileId));

  // 4. Insert pages
  await getDb()
    .insert(userFilePage)
    .values(
      pages.map((content, index) => ({
        fileId,
        pageNumber: index + 1,
        content,
      })),
    );

  // 5. Generate embeddings
  const embeddings = await getEmbeddings(pages);
  logger.info("Embeddings generated for webpage pages", {
    fileId,
    embeddingCount: embeddings.length,
  });

  // 6. Insert chunks
  await getDb()
    .insert(chunks)
    .values(
      pages.map((content, index) => ({
        content,
        documentId: fileId,
        startPage: index + 1,
        endPage: index + 1,
        embedding: embeddings[index],
      })),
    );

  // 7. Generate file-level embedding from title + first page
  const fileEmbeddingText = `Document Title: ${title}\n${pages[0] ?? ""}`;
  const [fileEmbedding] = await getEmbeddings([fileEmbeddingText]);

  await getDb()
    .update(userFile)
    .set({ embedding: fileEmbedding })
    .where(eq(userFile.id, fileId));

  logger.info("Webpage content processing complete", {
    fileId,
    pageCount: pages.length,
    chunkCount: pages.length,
  });
};
