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

    // File citations. Supported shapes inside the brackets:
    //   file_<ID>
    //   file_<ID>/page=1,2,3
    //   file_<ID>, file_<ID>            (comma-separated, optional spaces)
    //   file_<ID>/page=1, file_<ID>/page=2,3
    if (/file_/i.test(inner)) {
      const items = inner.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      let matchedAny = false;
      for (const item of items) {
        const itemMatch = /^file_([^/\s]+)(?:\/page=([\d,]+))?$/i.exec(item);
        if (!itemMatch) continue;
        matchedAny = true;
        const fileId = itemMatch[1];
        if (!fileId) continue;
        const pageNumbers = itemMatch[2]
          ?.split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
          .map((p) => Number(p))
          .filter((n) => Number.isFinite(n) && n > 0) ?? [];

        citations.push({
          type: "file",
          raw,
          fileId,
          pageNumbers,
          fileMetadata: { title: "", summary: "" },
        });
      }
      if (matchedAny) continue;
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
