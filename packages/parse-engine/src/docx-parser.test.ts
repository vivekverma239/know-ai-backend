import { describe, it, expect } from "vitest";
import { parseDocxToMarkdown } from "./docx-parser.js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// mammoth accepts both .docx buffers and ZIP archives. For unit tests we
// generate a minimal DOCX via docx or use a fixture. Since creating a DOCX
// from scratch is verbose, this suite mostly validates the shape of the
// output and degrades gracefully when no fixture is available.

const fixtureDir = path.join(__dirname, "../test/fixtures");
const sampleDocxPath = path.join(fixtureDir, "sample.docx");

describe("parseDocxToMarkdown", () => {
  it("rejects non-DOCX buffers with a useful error", async () => {
    const bogusBuffer = Buffer.from("not a docx file");
    await expect(parseDocxToMarkdown(bogusBuffer)).rejects.toThrow();
  });

  it.skipIf(!existsSync(sampleDocxPath))(
    "parses a sample DOCX fixture into markdown pages",
    async () => {
      const buffer = readFileSync(sampleDocxPath);
      const parsed = await parseDocxToMarkdown(buffer);
      expect(parsed.totalPages).toBeGreaterThan(0);
      expect(parsed.pages[0].content.length).toBeGreaterThan(0);
    },
  );
});
