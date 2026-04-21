import { describe, it, expect } from "vitest";
import { detectImageMime, parseImageToMarkdown } from "./image-parser.js";

describe("detectImageMime", () => {
  it("detects PNG by magic bytes", () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(detectImageMime(buffer)).toBe("image/png");
  });

  it("detects JPEG by magic bytes", () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(detectImageMime(buffer)).toBe("image/jpeg");
  });

  it("detects GIF by magic bytes", () => {
    const buffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0, 0, 0, 0, 0, 0]);
    expect(detectImageMime(buffer)).toBe("image/gif");
  });

  it("detects WebP by RIFF/WEBP markers", () => {
    const buffer = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(detectImageMime(buffer)).toBe("image/webp");
  });

  it("returns null for unknown formats", () => {
    const buffer = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(detectImageMime(buffer)).toBeNull();
  });

  it("returns null for short buffers", () => {
    expect(detectImageMime(Buffer.from([0x89, 0x50]))).toBeNull();
  });
});

describe("parseImageToMarkdown validation", () => {
  it("rejects unsupported MIME types without calling the LLM", async () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await expect(parseImageToMarkdown(buffer, "application/pdf")).rejects.toThrow(
      /Unsupported image MIME type/,
    );
  });

  it("accepts all supported MIME types in the validation check", async () => {
    // We don't actually call the LLM (no API key in test env) — we just make
    // sure the MIME validation passes. The actual network call would fail.
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    for (const mime of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      try {
        await parseImageToMarkdown(buffer, mime, { apiKey: "sk-fake-key-for-test" });
        // If it somehow succeeds (unlikely without real key), fine
      } catch (err) {
        // Should NOT be the MIME validation error
        expect(String(err)).not.toMatch(/Unsupported image MIME type/);
      }
    }
  });
});
