import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import { type SelectedRecommendation, structuredReports, userFile } from "@/db/schema";
import { parsePDF } from "@/service/file/triggerParsing";
import { getStorage } from "@/service/googleStorage";
import { processWebpageContent } from "@/service/ingestion/webpageProcessing";
import { sendQstashMessage } from "@/service/qstash";
import { enqueueToCMetaParsing } from "@/service/tocMetaQueue";
import { createContextLogger } from "@/utils/logger";
import { eq, inArray } from "drizzle-orm";

const logger = createContextLogger({ service: "reportIndexingWorkflow" });

const MAX_POLL_ATTEMPTS = 40; // 40 * 15s = 10 minutes max
const POLL_INTERVAL_MS = 15_000;

const DOWNLOAD_API_URL = "https://download.agents-tools.com/download";
const DOWNLOAD_API_KEY = process.env.DOCUMENT_DOWNLOAD_API_KEY ?? "";

const MAX_RETRIES = 3;

const downloadDocument = async (url: string): Promise<Buffer> => {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(DOWNLOAD_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": DOWNLOAD_API_KEY,
        },
        body: JSON.stringify({
          url,
          strategy: "auto",
          timeout: 60000,
        }),
      });

      if (!response.ok) {
        throw new Error(`Download API failed: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRIES - 1) {
        const backoff = Math.pow(2, attempt) * 1000;
        logger.warn(`Download attempt ${attempt + 1} failed, retrying in ${backoff}ms`, {
          url,
          error: lastError.message,
        });
        await sleep(backoff);
      }
    }
  }

  throw lastError ?? new Error(`Download failed after ${MAX_RETRIES} attempts`);
};

const fetchWebpageContent = async (url: string): Promise<{ title: string; content: string }> => {
  const buffer = await downloadDocument(url);
  const content = buffer.toString("utf-8");
  const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(content);
  const title = titleMatch?.[1]?.trim() || url;
  return { title, content };
};

/** Returns fileId if successful, null if download failed (no DB record created). */
const ingestRecommendation = async (
  rec: { url: string; title: string; type: "pdf" | "web_article" },
  userId: string,
  orgId: string,
): Promise<string | null> => {
  const fileId = randomUUID();

  try {
    // Download first — only create DB record if download succeeds
    if (rec.type === "web_article") {
      const { title, content } = await fetchWebpageContent(rec.url);

      await getDb()
        .insert(userFile)
        .values({
          id: fileId,
          name: title,
          userId,
          orgId,
          type: "web_article",
          status: "pending",
          sourceDocumentUrl: rec.url,
          webArticleMetadata: { url: rec.url, title, content },
        });

      await processWebpageContent(fileId, content, rec.url, title);
      await getDb().update(userFile).set({ status: "completed" }).where(eq(userFile.id, fileId));
    } else {
      const buffer = await downloadDocument(rec.url);
      await getStorage().uploadFile({
        data: buffer,
        contentType: "application/pdf",
        path: `files/${userId}/${fileId}/document.pdf`,
      });

      // Only create DB record after file is in storage
      await getDb()
        .insert(userFile)
        .values({
          id: fileId,
          name: rec.title,
          userId,
          orgId,
          type: "pdf",
          status: "pending",
          sourceDocumentUrl: rec.url,
        });

      await parsePDF(fileId);
      await enqueueToCMetaParsing(fileId);
    }

    return fileId;
  } catch (error) {
    logger.error("Document download/ingestion failed", {
      url: rec.url,
      type: rec.type,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
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
      fileId: fileId ?? rec.url, // use URL as placeholder if download failed
      status: fileId ? "pending" : "failed",
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

  // Step 2: Poll until all documents are ready (only those that were created)
  const pendingFileIds = selectedRecs
    .filter((r) => r.status !== "failed")
    .map((r) => r.fileId);

  const finalStatuses = pendingFileIds.length > 0
    ? await pollUntilReady(pendingFileIds)
    : new Map<string, string>();

  // Step 3: Update selected recommendations with final statuses
  const updatedRecs = selectedRecs.map((rec) => ({
    ...rec,
    status: (rec.status === "failed"
      ? "failed"
      : finalStatuses.get(rec.fileId) === "completed"
        ? "completed"
        : "failed") as "pending" | "completed" | "failed",
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
