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

interface CellInfo {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  text: string;
}

/**
 * Extract tables from Textract blocks and convert to markdown with merged cell support.
 * Mirrors the Python excel_to_markdown() function.
 */
function extractTablesAsMarkdown(blocks: TextractBlock[]): string {
  const blockMap = new Map<string, TextractBlock>();
  for (const block of blocks) {
    if (block.Id) blockMap.set(block.Id, block);
  }

  const tables: string[] = [];

  for (const block of blocks) {
    if (block.BlockType !== "TABLE") continue;

    // Collect all cells with their span info
    const cells: CellInfo[] = [];
    let maxRow = 0;
    let maxCol = 0;

    const childIds = block.Relationships?.find((r) => r.Type === "CHILD")?.Ids ?? [];
    for (const cellId of childIds) {
      const cell = blockMap.get(cellId);
      if (!cell || cell.BlockType !== "CELL") continue;

      const row = cell.RowIndex ?? 0;
      const col = cell.ColumnIndex ?? 0;
      const rowSpan = cell.RowSpan ?? 1;
      const colSpan = cell.ColumnSpan ?? 1;

      // Account for span when computing max dimensions
      maxRow = Math.max(maxRow, row + rowSpan - 1);
      maxCol = Math.max(maxCol, col + colSpan - 1);

      // Get cell text from child WORD/SELECTION blocks
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
        row,
        col,
        rowSpan,
        colSpan,
        text: words.join(" ").replace(/\n/g, " ").trim(),
      });
    }

    if (maxRow === 0) continue;

    // Build a grid — track which cells are occupied by spans
    const grid: string[][] = Array.from({ length: maxRow }, () =>
      Array(maxCol).fill("")
    );
    const skipCells = new Set<string>();

    // Sort cells by row, col for deterministic processing
    cells.sort((a, b) => a.row - b.row || a.col - b.col);

    for (const cell of cells) {
      let value = cell.text;

      // Add span markers matching Python's format
      if (cell.rowSpan > 1 && value !== "") {
        value = `${value} [rowspan=${cell.rowSpan}]`;
      }
      if (cell.colSpan > 1) {
        value = `${value} [colspan=${cell.colSpan}]`;
      }

      // Place in grid
      grid[cell.row - 1][cell.col - 1] = value;

      // Mark spanned cells to skip
      for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
        for (let c = cell.col; c < cell.col + cell.colSpan; c++) {
          if (r !== cell.row || c !== cell.col) {
            skipCells.add(`${r}-${c}`);
            grid[r - 1][c - 1] = "";
          }
        }
      }
    }

    // Generate markdown table
    const mdRows: string[] = [];

    // Add merged cell note (matching Python output)
    const hasMergedCells = cells.some((c) => c.rowSpan > 1 || c.colSpan > 1);
    if (hasMergedCells) {
      mdRows.push("<!-- Note: Merged cells are indicated with [rowspan=X] and [colspan=X] markers -->");
      mdRows.push("");
    }

    for (let r = 0; r < maxRow; r++) {
      mdRows.push("| " + grid[r].join(" | ") + " |");

      // Separator after first row (header)
      if (r === 0) {
        mdRows.push("| " + grid[r].map(() => "---").join(" | ") + " |");
      }
    }

    tables.push(mdRows.join("\n"));
  }

  return tables.join("\n\n");
}
