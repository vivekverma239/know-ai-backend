import type { DocumentParseData } from "@/@types/queue";
import { logger } from "@/utils/logger";
import { sendQstashMessage } from "../qstash";

export const enqueueDocumentParse = async (fileId: string): Promise<void> => {
  try {
    await sendQstashMessage<DocumentParseData>("api/v1/document-parse-callback", {
      type: "document_parse",
      data: { fileId },
    });
    logger.info("Enqueued document parse", { fileId });
  } catch (error) {
    logger.error("Failed to enqueue document parse", {
      fileId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
