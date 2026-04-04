import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import { type SelectedRecommendation, structuredReports, userFile } from "@/db/schema";
import { parsePDF } from "@/service/file/triggerParsing";
import { getStorage } from "@/service/googleStorage";
import { sendQstashMessage } from "@/service/qstash";
import { processWebpageContent } from "@/service/ingestion/webpageProcessing";
import { enqueueToCMetaParsing } from "@/service/tocMetaQueue";
import { createContextLogger } from "@/utils/logger";
import { eq, inArray } from "drizzle-orm";

const logger = createContextLogger({ service: "reportIndexingWorkflow" });

const MAX_POLL_ATTEMPTS = 40; // 40 * 15s = 10 minutes max
const POLL_INTERVAL_MS = 15_000;

const downloadDocument = async (url: string): Promise<Buffer> => {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.DOCUMENT_DOWNLOAD_TIMEOUT_MS ?? "120000");
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Document download failed: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchWebpageContent = async (url: string): Promise<{ title: string; content: string }> => {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.DOCUMENT_DOWNLOAD_TIMEOUT_MS ?? "120000");
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Webpage fetch failed: ${response.status} ${response.statusText}`);
    }
    const content = await response.text();
    const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(content);
    const title = titleMatch?.[1]?.trim() || url;
    return { title, content };
  } finally {
    clearTimeout(timeoutId);
  }
};

const ingestRecommendation = async (
  rec: { url: string; title: string; type: "pdf" | "web_article" },
  userId: string,
  orgId: string,
): Promise<string> => {
  const fileId = randomUUID();

  await getDb().insert(userFile).values({
    id: fileId,
    name: rec.title,
    userId,
    orgId,
    type: rec.type === "pdf" ? "pdf" : "web_article",
    status: "pending",
    sourceDocumentUrl: rec.url,
  });

  if (rec.type === "web_article") {
    // Process webpage in background
    (async () => {
      try {
        const { title, content } = await fetchWebpageContent(rec.url);
        await getDb()
          .update(userFile)
          .set({
            name: title,
            type: "web_article",
            webArticleMetadata: { url: rec.url, title, content },
          })
          .where(eq(userFile.id, fileId));

        await processWebpageContent(fileId, content, rec.url, title);
        await getDb().update(userFile).set({ status: "completed" }).where(eq(userFile.id, fileId));
      } catch (error) {
        logger.error("Web article ingestion failed", {
          fileId,
          url: rec.url,
          error: error instanceof Error ? error.message : String(error),
        });
        await getDb().update(userFile).set({ status: "failed" }).where(eq(userFile.id, fileId));
      }
    })();
  } else {
    // Process PDF in background
    (async () => {
      try {
        const buffer = await downloadDocument(rec.url);
        await getStorage().uploadFile({
          data: buffer,
          contentType: "application/pdf",
          path: `files/${userId}/${fileId}/document.pdf`,
        });
        await parsePDF(fileId);
        await enqueueToCMetaParsing(fileId);
      } catch (error) {
        logger.error("PDF ingestion failed", {
          fileId,
          url: rec.url,
          error: error instanceof Error ? error.message : String(error),
        });
        await getDb().update(userFile).set({ status: "failed" }).where(eq(userFile.id, fileId));
      }
    })();
  }

  return fileId;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pollUntilReady = async (fileIds: string[]): Promise<Map<string, string>> => {
  const statusMap = new Map<string, string>();

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const files = await getDb()
      .select({ id: userFile.id, status: userFile.status })
      .from(userFile)
      .where(inArray(userFile.id, fileIds));

    let allDone = true;
    for (const file of files) {
      statusMap.set(file.id, file.status ?? "pending");
      if (file.status !== "completed" && file.status !== "failed") {
        allDone = false;
      }
    }

    if (allDone) {
      logger.info("All recommended documents finished indexing", {
        fileIds,
        attempt,
      });
      return statusMap;
    }

    logger.debug("Waiting for documents to finish indexing", {
      attempt,
      pending: files.filter((f) => f.status !== "completed" && f.status !== "failed").length,
    });

    await sleep(POLL_INTERVAL_MS);
  }

  logger.warn("Indexing poll timeout reached, proceeding with available documents", { fileIds });
  return statusMap;
};

export const startIndexingAndWait = async ({
  reportId,
  recommendations,
  userId,
  orgId,
}: {
  reportId: string;
  recommendations: { url: string; title: string; type: "pdf" | "web_article" }[];
  userId: string;
  orgId: string;
}): Promise<void> => {
  logger.info("Starting indexing workflow", {
    reportId,
    recommendationCount: recommendations.length,
  });

  // Step 1: Kick off ingestion for each recommendation
  const selectedRecs: SelectedRecommendation[] = [];

  for (const rec of recommendations) {
    const fileId = await ingestRecommendation(rec, userId, orgId);
    selectedRecs.push({
      url: rec.url,
      title: rec.title,
      type: rec.type,
      fileId,
      status: "pending",
    });
  }

  // Store selected recommendations and set status to indexing
  await getDb()
    .update(structuredReports)
    .set({
      status: "indexing",
      selectedRecommendations: selectedRecs,
    })
    .where(eq(structuredReports.id, reportId));

  // Step 2: Poll until all documents are ready
  const fileIds = selectedRecs.map((r) => r.fileId);
  const finalStatuses = await pollUntilReady(fileIds);

  // Step 3: Update selected recommendations with final statuses
  const updatedRecs = selectedRecs.map((rec) => ({
    ...rec,
    status: (finalStatuses.get(rec.fileId) === "completed" ? "completed" : "failed") as
      | "pending"
      | "completed"
      | "failed",
  }));

  await getDb()
    .update(structuredReports)
    .set({ selectedRecommendations: updatedRecs })
    .where(eq(structuredReports.id, reportId));

  // Step 4: Resume report processing
  logger.info("Indexing complete, resuming report processing", { reportId });

  await sendQstashMessage("api/structured-report-callback", {
    type: "structured_report_processing",
    data: { reportId, skipPreflight: true },
  });
};
