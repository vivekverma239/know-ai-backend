import { getDb } from "@/db";
import { userFile } from "@/db/schema";
import { eq } from "drizzle-orm";

const db = getDb();

export type ParsedCitation =
  | {
      type: "file";
      raw: string;
      fileId: string;
      pageNumbers: number[];
      fileMetadata: {
        title: string;
        summary: string;
      };
    }
  | {
      type: "url";
      raw: string;
      url: string;
    };

/**
 * Parse bracketed citations from model output.
 *
 * Supports:
 * - [file_<FILE_ID>/page=1,2,3]
 * - [url=https://example.com/...]
 */
export const parseCitations = async (text: string): Promise<ParsedCitation[]> => {
  const citations: ParsedCitation[] = [];

  if (!text) return citations;

  // Global regex to find any [...] blocks without newlines inside.
  const bracketPattern = /\[[^\]\n\r]+]/g;
  const matches = text.match(bracketPattern);
  if (!matches) return citations;

  for (const raw of matches) {
    // Strip the surrounding brackets
    const inner = raw.slice(1, -1);

    // File citation: file_<ID>/page=1,2,3
    if (inner.startsWith("file_")) {
      const fileMatch = /^file_([^/]+)\/page=([\d,]+)$/i.exec(inner);
      if (!fileMatch) continue;

      const fileId = fileMatch[1];
      if (!fileId) continue;
      const pageNumbers = fileMatch[2]
        ?.split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .map((p) => Number(p))
        .filter((n) => Number.isFinite(n) && n > 0);

      citations.push({
        type: "file",
        raw,
        fileId,
        pageNumbers,
        // File metadata (title/summary) can be enriched by callers later
        // once they have looked up the corresponding file records.
        fileMetadata: {
          title: "",
          summary: "",
        },
      });
      continue;
    }

    // URL citation: url=https://...
    if (inner.startsWith("url=")) {
      const url = inner.slice("url=".length);
      if (!url) continue;

      citations.push({
        type: "url",
        raw,
        url,
      });
    }
  }

  // Enrich file citations with metadata fetched in parallel.
  const enriched = await hydrateCitationMetadata(citations, async (fileId) => {
    const file = await db.query.userFile.findFirst({
      where: eq(userFile.id, fileId),
    });
    if (!file) return null;
    return {
      title: file.name ?? "Unknown File",
      summary: file.metadata?.shortSummary ?? "",
    };
  });
  return enriched;
};

/**
 * Enrich file citations with metadata fetched in parallel.
 *
 * This helper is intentionally generic so it can be used both on the server
 * (with a DB-backed fetcher) and on the client (with an API call).
 */
export const hydrateCitationMetadata = async (
  citations: ParsedCitation[],
  fetchFileMetadata: (fileId: string) => Promise<{ title: string; summary: string } | null>,
): Promise<ParsedCitation[]> => {
  if (!citations.length) return citations;

  // Run all metadata lookups in parallel.
  const enriched = await Promise.all(
    citations.map(async (citation) => {
      if (citation.type !== "file") {
        return citation;
      }

      const meta = await fetchFileMetadata(citation.fileId);
      if (!meta) return citation;

      return {
        ...citation,
        fileMetadata: {
          title: meta.title,
          summary: meta.summary,
        },
      };
    }),
  );

  return enriched;
};
