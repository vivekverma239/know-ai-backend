import { getStorage } from "../googleStorage";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { userFile } from "../../db/schema";
import { logger } from "../../utils/logger";

export const parsePDF = async (fileId: string): Promise<void> => {
  const file = await getDb().query.userFile.findFirst({
    where: eq(userFile.id, fileId),
  });
  if (!file) {
    throw new Error("File not found");
  }
  const storage = getStorage();
  const path = `files/${file.userId}/${fileId}/document.pdf`;

  const signedUrl = await storage.getSignedUrl(path);

  logger.info(`Calling URL: ${process.env.BACKEND_URL}/parse/document/async`);

  const response = await fetch(
    `${process.env.BACKEND_URL}/parse/document/async`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-APP-TOKEN": process.env.BACKEND_TOKEN!,
      },
      body: JSON.stringify({
        document_url: signedUrl,
        document_id: fileId,
        elements: ["pdf_parse", "metadata", "outline", "heirarchial_index"],
        callback_url: `${process.env.APP_URL}/api/v1/callbacks/parsing/${fileId}`,
        ignore_cache: false,
      }),
    }
  );
  if (!response.ok) {
    logger.error(
      `Failed to parse PDF ${fileId} ${JSON.stringify(await response.json())}`
    );
    throw new Error("Failed to parse PDF");
  }
};

export const parsePDFMetadata = async (fileId: string): Promise<void> => {
  const file = await getDb().query.userFile.findFirst({
    where: eq(userFile.id, fileId),
  });
  if (!file) {
    throw new Error("File not found");
  }
  const storage = getStorage();
  const path = `files/${file.userId}/${fileId}/document.pdf`;
  const signedUrl = await storage.getSignedUrl(path);

  const response = await fetch(
    `${process.env.BACKEND_URL}/parse-metadata/background`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-APP-TOKEN": process.env.BACKEND_TOKEN!,
      },
      body: JSON.stringify({
        pdf_url: signedUrl,
        doc_id: fileId,
        callback_url: `${process.env.APP_URL}/api/v1/callbacks/parsing/${fileId}`,
      }),
    }
  );
  if (!response.ok) {
    logger.error(
      `Failed to parse PDF metadata ${fileId} ${JSON.stringify(
        await response.json()
      )}`
    );
    throw new Error("Failed to parse PDF metadata");
  }
};

export const parsePDFChapters = async (
  fileId: string
  // userId: string,
): Promise<void> => {
  const file = await getDb().query.userFile.findFirst({
    where: eq(userFile.id, fileId),
  });
  if (!file) {
    throw new Error("File not found");
  }
  const storage = getStorage();
  const path = `files/${file.userId}/${fileId}/document.pdf`;
  const signedUrl = await storage.getSignedUrl(path);

  const response = await fetch(
    `${process.env.BACKEND_URL}/parse-outline/background`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-APP-TOKEN": process.env.BACKEND_TOKEN!,
      },
      body: JSON.stringify({
        pdf_url: signedUrl,
        doc_id: fileId,
        callback_url: `${process.env.APP_URL}/api/v1/callbacks/parsing/${fileId}`,
      }),
    }
  );
  if (!response.ok) {
    logger.error(
      `Failed to parse PDF metadata ${fileId} ${JSON.stringify(
        await response.json()
      )}`
    );
    throw new Error("Failed to parse PDF metadata");
  }
};

export const parsePDFHeirarchialIndex = async (
  fileId: string
  // userId: string,
): Promise<void> => {
  const file = await getDb().query.userFile.findFirst({
    where: eq(userFile.id, fileId),
  });
  if (!file) {
    throw new Error("File not found");
  }
  const storage = getStorage();
  const path = `files/${file.userId}/${fileId}/document.pdf`;
  const signedUrl = await storage.getSignedUrl(path);

  const response = await fetch(
    `${process.env.BACKEND_URL}/parse-heirarchial-index/background`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-APP-TOKEN": process.env.BACKEND_TOKEN!,
      },
      body: JSON.stringify({
        pdf_url: signedUrl,
        doc_id: fileId,
        callback_url: `${process.env.APP_URL}/api/v1/callbacks/parsing/${fileId}`,
      }),
    }
  );
  if (!response.ok) {
    logger.error(
      `Failed to parse PDF heirarchial index ${fileId} ${JSON.stringify(
        await response.json()
      )}`
    );
    throw new Error("Failed to parse PDF heirarchial index");
  }
};
