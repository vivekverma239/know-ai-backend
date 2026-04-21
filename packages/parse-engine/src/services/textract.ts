/**
 * AWS Textract table parsing with merged cell support.
 * Mirrors Python's src/services/textract/__init__.py excel_to_markdown()
 *
 * The Python code uses textractor → openpyxl → markdown with [rowspan/colspan] markers.
 * We replicate the same logic by parsing Textract's raw CELL blocks which contain
 * RowSpan/ColumnSpan properties directly.
 */
import {
  TextractClient,
  AnalyzeDocumentCommand,
  type Block as TextractBlock,
} from "@aws-sdk/client-textract";
import { env } from "../env.js";
import { cellsToMarkdownTable, type TableCell } from "./table-to-markdown.js";

let _client: TextractClient | null = null;

function getClient(): TextractClient {
  if (_client) return _client;
  _client = new TextractClient({
    region: env.awsRegion,
    credentials: {
      accessKeyId: env.awsAccessKeyId!,
      secretAccessKey: env.awsSecretAccessKey!,
    },
  });
  return _client;
}

/**
 * Send a table image to AWS Textract and return the extracted content as markdown.
 * Handles merged cells with [rowspan=X] and [colspan=X] markers (matching Python output).
 */
export async function parseTableWithTextract(
  imageBytes: Buffer,
  retries = 3
): Promise<string> {
  const client = getClient();

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const command = new AnalyzeDocumentCommand({
        Document: { Bytes: imageBytes },
        FeatureTypes: ["TABLES", "LAYOUT"],
      });

      const response = await client.send(command);
      return extractTablesAsMarkdown(response.Blocks ?? []);
    } catch (err) {
      if (attempt < retries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(`Textract attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }

  return "";
}

/**
 * Extract tables from Textract blocks and convert to markdown with merged cell
 * support. Cell rendering is delegated to cellsToMarkdownTable for consistency
 * with other table sources (HTML, XLSX, DOCX).
 */
function extractTablesAsMarkdown(blocks: TextractBlock[]): string {
  const blockMap = new Map<string, TextractBlock>();
  for (const block of blocks) {
    if (block.Id) blockMap.set(block.Id, block);
  }

  const tables: string[] = [];

  for (const block of blocks) {
    if (block.BlockType !== "TABLE") continue;

    const cells: TableCell[] = [];
    const childIds = block.Relationships?.find((r) => r.Type === "CHILD")?.Ids ?? [];
    for (const cellId of childIds) {
      const cell = blockMap.get(cellId);
      if (!cell || cell.BlockType !== "CELL") continue;

      const wordIds = cell.Relationships?.find((r) => r.Type === "CHILD")?.Ids ?? [];
      const words: string[] = [];
      for (const wordId of wordIds) {
        const word = blockMap.get(wordId);
        if (word?.BlockType === "WORD" && word.Text) {
          words.push(word.Text);
        } else if (word?.BlockType === "SELECTION_ELEMENT") {
          words.push(word.SelectionStatus === "SELECTED" ? "[X]" : "[ ]");
        }
      }

      cells.push({
        row: cell.RowIndex ?? 0,
        col: cell.ColumnIndex ?? 0,
        rowSpan: cell.RowSpan ?? 1,
        colSpan: cell.ColumnSpan ?? 1,
        text: words.join(" ").replace(/\n/g, " ").trim(),
      });
    }

    const markdown = cellsToMarkdownTable(cells);
    if (markdown) tables.push(markdown);
  }

  return tables.join("\n\n");
}
