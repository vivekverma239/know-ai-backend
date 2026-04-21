/**
 * Unified file-type detection + parser dispatch. Given a buffer, a MIME hint,
 * and/or a filename, returns the canonical format the parse pipeline should
 * use. The detection precedence is:
 *
 *   1. MIME type (if provided)
 *   2. Magic-byte sniff (PDF, PNG, JPEG, GIF, WebP, ZIP-based Office formats)
 *   3. File extension
 *
 * Office formats (DOCX/XLSX/PPTX) are ZIP archives under the hood, so we
 * disambiguate via the filename or the MIME hint.
 */

import { detectImageMime } from "./image-parser.js";

export type ParseFormat =
  | "pdf"
  | "html"
  | "image"
  | "docx"
  | "xlsx"
  | "pptx"
  | "unknown";

const MIME_TO_FORMAT: Record<string, ParseFormat> = {
  "application/pdf": "pdf",
  "text/html": "html",
  "application/xhtml+xml": "html",
  "image/png": "image",
  "image/jpeg": "image",
  "image/jpg": "image",
  "image/webp": "image",
  "image/gif": "image",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

const EXTENSION_TO_FORMAT: Record<string, ParseFormat> = {
  pdf: "pdf",
  html: "html",
  htm: "html",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  docx: "docx",
  xlsx: "xlsx",
  xls: "xlsx",
  pptx: "pptx",
};

/** Fast magic-byte detection for common binary formats. */
function detectByMagicBytes(buffer: Buffer): ParseFormat | null {
  if (buffer.length < 8) return null;

  // PDF: %PDF
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return "pdf";
  }

  // Image sniffing reuses the image parser helper
  if (detectImageMime(buffer)) return "image";

  return null;
}

export interface DetectFormatInput {
  buffer?: Buffer;
  mimeType?: string;
  filename?: string;
}

/**
 * Determine the parse format from available hints. Returns "unknown" when no
 * detector matches.
 */
export function detectFormat(input: DetectFormatInput): ParseFormat {
  const { buffer, mimeType, filename } = input;

  if (mimeType) {
    const stripped = mimeType.split(";")[0].trim().toLowerCase();
    const hit = MIME_TO_FORMAT[stripped];
    if (hit) return hit;
  }

  if (buffer) {
    const byMagic = detectByMagicBytes(buffer);
    if (byMagic) return byMagic;
  }

  if (filename) {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext) {
      const hit = EXTENSION_TO_FORMAT[ext];
      if (hit) return hit;
    }
  }

  return "unknown";
}
