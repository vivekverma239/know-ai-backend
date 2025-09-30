import { StorageService } from "./storage";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { userFile } from "../db/schema";
import { logger } from "../utils/logger";

export type ParsedPDFPages = {
  page_number: number;
  content: string;
  page_images: {
    bounds: number[];
    image_id: string;
  }[];
};

export type ParsedPDFSummary = {
  title: string;
  short_summary: string;
  year: number;
  date: string;
  companies: string[];
  document_type: string;
};

export type ParsedPDFMetadata = {
  title: string;
  publication_date: string;
  year: string;
  summary: string;
  category: string;
  subcategory: string;
  id: string;
  financial_and_investment_document?: {
    document_type: string;
    reference_period: string;
    company: string;
    country: string;
    industry: string;
    sentiment: string;
  };
};

export type ParsedPDFChartBlocks = {
  reference_idx: string;
  parsed_data: string;
  page: number;
  idx: number;
  bounds: number[];
};
export type ParsedPDF = {
  title: string;
  summary: ParsedPDFSummary;
  metadata: ParsedPDFMetadata;
  pages: ParsedPDFPages[];
  chart_blocks: ParsedPDFChartBlocks[];
};

export const parsePDF = async (
  fileId: string
  // userId: string,
): Promise<void> => {
  const file = await db.query.userFile.findFirst({
    where: eq(userFile.id, fileId),
  });
  if (!file) {
    throw new Error("File not found");
  }
  const storage = new StorageService();
  const path = `files/${file.createdById}/${fileId}/${fileId}.pdf`;

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
        callback_url: `${process.env.APP_URL}/api/global-parsing-callback/${fileId}`,
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
  //   const data = (await response.json()) as ParsedPDF;

  //   // Save to db
  //   const chunksData = [];
  //   for (let i = 0; i < data.pages.length; i += 2) {
  //     const chunk = data.pages.slice(i, i + 2).map((page) => page.content);
  //     chunksData.push({
  //       content: chunk
  //         .map((page, index) => `<page page_number=${i + index}>${page}</page>`)
  //         .join("\n"),
  //       documentId: fileId,
  //       metadata: {
  //         page_number: i,
  //         page_count: data.pages.length,
  //       },
  //     });
  //   }

  //   // Delete existing chunks for this file
  //   logger.info(`Deleting existing chunks for file ${fileId}`);
  //   await db.delete(chunks).where(eq(chunks.documentId, fileId));

  //   logger.info(`Creating ${chunksData.length} chunks`);
  //   // Embed the chunks
  //   const embeddings = await getEmbeddings(
  //     chunksData.map(
  //       (chunk) =>
  //         `Document Title: ${data.title}\n${data.summary}\n${chunk.content}`,
  //     ),
  //   );

  //   // Insert the chunks into the database
  //   logger.info(`Inserting ${chunksData.length} chunks into the database`);
  //   await db.insert(chunks).values(
  //     chunksData.map((chunk, index) => ({
  //       ...chunk,
  //       embedding: embeddings[index]!,
  //     })),
  //   );

  //   // Create file embeddings
  //   const fileEmbeddings = await getEmbeddings([
  //     `Document Title: ${data.title}\n${data.summary}`,
  //   ]);

  //   // Update the file with the summary
  //   await db
  //     .update(userFile)
  //     .set({
  //       name: data.title,
  //       metadata: {
  //         shortSummary: data.summary.short_summary,
  //         date: data.metadata.publication_date,
  //         companies: data.summary.companies,
  //         documentType: data.summary.document_type,
  //         year: parseInt(data.metadata.year),
  //         title: data.title,
  //       },
  //       embedding: fileEmbeddings[0]!,
  //       status: "processed",
  //     })
  //     .where(eq(userFile.id, fileId));

  //   logger.info(`Finished processing file ${fileId}`);

  //   return data;
};

export const parsePDFMetadata = async (
  fileId: string
  // userId: string,
): Promise<void> => {
  const file = await db.query.userFile.findFirst({
    where: eq(userFile.id, fileId),
  });
  if (!file) {
    throw new Error("File not found");
  }
  const storage = new StorageService();
  const path = `files/${file.createdById}/${fileId}/${fileId}.pdf`;
  const signedUrl = await storage.getSignedUrl(path);

  console.log(signedUrl);
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
        callback_url: `${process.env.APP_URL}/api/metadata-callback/${fileId}`,
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
  const file = await db.query.userFile.findFirst({
    where: eq(userFile.id, fileId),
  });
  if (!file) {
    throw new Error("File not found");
  }
  const storage = new StorageService();
  const path = `files/${file.createdById}/${fileId}/${fileId}.pdf`;
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
        callback_url: `${process.env.APP_URL}/api/outline-callback/${fileId}`,
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
  const file = await db.query.userFile.findFirst({
    where: eq(userFile.id, fileId),
  });
  if (!file) {
    throw new Error("File not found");
  }
  const storage = new StorageService();
  const path = `files/${file.createdById}/${fileId}/${fileId}.pdf`;
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
        callback_url: `${process.env.APP_URL}/api/heirarchial-index-callback/${fileId}`,
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
