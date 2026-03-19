import type { ToCMetaProcessingData } from "@/@types/queue";
import { logger } from "@/utils/logger";
import { sendQstashMessage } from "./qstash";

export const enqueueToCMetaParsing = async (fileId: string): Promise<void> => {
  try {
    await sendQstashMessage<ToCMetaProcessingData>("api/v1/toc-meta-callback", {
      type: "toc_meta_processing",
      data: { fileId },
    });
    logger.info("Enqueued ToC meta parsing", { fileId });
  } catch (error) {
    logger.error("Failed to enqueue ToC meta parsing", {
      fileId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
