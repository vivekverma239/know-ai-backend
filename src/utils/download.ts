import path from "node:path";
import fs from "node:fs";
import AdmZip from "adm-zip";
import { logger } from "./logger";

const SERVICE_URL = "https://pdf-generator-api-z5z6k2buaq-de.a.run.app";

export const downloadPDF = async (urls: string[]) => {
  const response = await fetch(`${SERVICE_URL}/api/download`, {
    method: "POST",
    body: JSON.stringify({ urls }),
    headers: {
      "Content-Type": "application/json",
    },
  });


  // Response blob is a zip file containing the pdfs, unzip and store in data/files/pdfs
  const zip = await response.blob();
  const zipArrayBuffer = await zip.arrayBuffer();
  const zipBuffer = Buffer.from(zipArrayBuffer);

  // Create the target directory if it doesn't exist
  const pdfDir = path.join(process.cwd(), "data", "files", "pdfs");
  await fs.promises.mkdir(pdfDir, { recursive: true });

  // Extract all PDF files from the zip
  const zipFile = new AdmZip(zipBuffer);
  const zipEntries = zipFile.getEntries();

  for (const entry of zipEntries) {
    if (entry.entryName.toLowerCase().endsWith(".pdf")) {
      const pdfBuffer = entry.getData();
      const pdfPath = path.join(pdfDir, entry.entryName);

      // Ensure the subdirectory exists if the PDF is in a subfolder
      const pdfDirPath = path.dirname(pdfPath);
      await fs.promises.mkdir(pdfDirPath, { recursive: true });

      // Write the PDF file
      await fs.promises.writeFile(pdfPath, pdfBuffer);
    }
  }
};

/**
 * Download a file from a URL and return the buffer
 */
export const downloadFileFromUrl = async (url: string): Promise<Buffer> => {
  try {
    logger.info(`Downloading file from URL: ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; KnowsisAI/1.0)",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to download file: ${response.status} ${response.statusText}`
      );
    }

    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("pdf")) {
      throw new Error("File must be a PDF document");
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    logger.error(`Error downloading file from URL ${url}:`, { error });
    throw new Error(
      `Failed to download file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
};

/**
 * Extract filename from URL or use a default name
 */
export const extractFilenameFromUrl = (
  url: string,
  defaultName?: string
): string => {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split("/").pop();

    if (filename?.includes(".")) {
      return filename;
    }

    return defaultName ?? `document-${Date.now()}.pdf`;
  } catch {
    return defaultName ?? `document-${Date.now()}.pdf`;
  }
};
