import { describe, it, expect } from "vitest";
import { detectFormat } from "./parse-dispatch.js";

describe("detectFormat", () => {
  it("prefers MIME type over magic bytes", () => {
    // Buffer looks like PDF but MIME says HTML — MIME wins
    const pdfMagic = Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0]);
    expect(detectFormat({ buffer: pdfMagic, mimeType: "text/html" })).toBe("html");
  });

  it("falls back to magic bytes when MIME is missing", () => {
    const pdfMagic = Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0]);
    expect(detectFormat({ buffer: pdfMagic })).toBe("pdf");
  });

  it("detects PDF from magic bytes", () => {
    const pdf = Buffer.from("%PDF-1.4", "ascii");
    expect(detectFormat({ buffer: pdf })).toBe("pdf");
  });

  it("detects PNG / JPEG / GIF / WebP images via magic bytes", () => {
    // detectImageMime requires at least 12 bytes to inspect RIFF/WEBP
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectFormat({ buffer: png })).toBe("image");
    expect(detectFormat({ buffer: jpeg })).toBe("image");
  });

  it("falls back to filename extension when MIME and magic bytes are ambiguous", () => {
    // Office formats are ZIPs — magic bytes alone can't disambiguate docx vs xlsx
    expect(detectFormat({ filename: "report.docx" })).toBe("docx");
    expect(detectFormat({ filename: "sales.xlsx" })).toBe("xlsx");
    expect(detectFormat({ filename: "deck.pptx" })).toBe("pptx");
  });

  it("handles MIME types with charset parameters", () => {
    expect(detectFormat({ mimeType: "text/html; charset=utf-8" })).toBe("html");
  });

  it("recognises all supported Office MIME types", () => {
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const pptx = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    expect(detectFormat({ mimeType: docx })).toBe("docx");
    expect(detectFormat({ mimeType: xlsx })).toBe("xlsx");
    expect(detectFormat({ mimeType: pptx })).toBe("pptx");
  });

  it("returns 'unknown' when nothing matches", () => {
    expect(detectFormat({})).toBe("unknown");
    expect(detectFormat({ mimeType: "application/octet-stream" })).toBe("unknown");
    expect(detectFormat({ filename: "mystery.bin" })).toBe("unknown");
  });
});
