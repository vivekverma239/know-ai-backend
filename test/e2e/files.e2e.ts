import { describe, it, expect, beforeAll } from "vitest";
import { api, authHeaders, requireEnv, API_BASE_URL, BACKEND_TOKEN } from "../helpers";
import { v4 as uuidv4 } from "uuid";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("File Management", () => {
  beforeAll(() => requireEnv());
  let uploadedFileId: string;

  describe("GET /files", () => {
    it("returns file list (possibly empty)", async () => {
      const res = await api("/files?page=1&pageSize=5");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("supports status filter", async () => {
      const res = await api("/files?status=completed&pageSize=5");
      expect(res.status).toBe(200);
    });

    it("supports search filter", async () => {
      const res = await api("/files?search=test&pageSize=5");
      expect(res.status).toBe(200);
    });
  });

  describe("POST /files/upload", () => {
    it("uploads a PDF file", async () => {
      // Read the test PDF file
      const pdfPath = path.join(__dirname, "../files/test-file-meta.pdf");
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = readFileSync(pdfPath);
      } catch {
        // Skip if test file doesn't exist
        console.log("Skipping upload test — test/files/test-file-meta.pdf not found");
        return;
      }

      // Build multipart form data
      const boundary = `----formdata-${uuidv4()}`;
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
        pdfBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const res = await fetch(`${API_BASE_URL}/files/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${BACKEND_TOKEN}`,
          "x-user-id": "test-upload-user",
          "x-org-id": "test-org-e2e",
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      expect(res.status).toBe(201);
      const data = await res.json() as any;
      expect(data).toHaveProperty("fileId");
      expect(data).toHaveProperty("status", "pending");
      uploadedFileId = data.fileId;
    });

    it("rejects non-PDF files", async () => {
      const boundary = `----formdata-${uuidv4()}`;
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\n`),
        Buffer.from("hello world"),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const res = await fetch(`${API_BASE_URL}/files/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${BACKEND_TOKEN}`,
          "x-user-id": "test-upload-user",
          "x-org-id": "test-org-e2e",
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /files/:id", () => {
    it("returns 404 for non-existent file", async () => {
      const res = await api(`/files/${uuidv4()}`);
      expect(res.status).toBe(404);
    });
  });

  describe("GET /files/pages", () => {
    it("returns 404 for non-existent file pages", async () => {
      const res = await api(`/files/pages?fileId=${uuidv4()}`);
      expect(res.status).toBe(404);
    });
  });

  describe("GET /files/chapters", () => {
    it("returns 404 for non-existent file chapters", async () => {
      const res = await api(`/files/chapters?fileId=${uuidv4()}`);
      expect(res.status).toBe(404);
    });
  });
});
