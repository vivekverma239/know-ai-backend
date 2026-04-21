/**
 * Convert a set of table cells (with optional rowspan/colspan) into a GitHub
 * Flavored Markdown table. Merged cells are encoded with inline
 * `[rowspan=N]` / `[colspan=N]` markers on the origin cell; the cells they
 * span over are left empty to keep the markdown grid valid.
 *
 * This format is lossless, valid markdown, and easy for downstream LLMs to
 * interpret. Used by Textract table extraction and HTML/XLSX/DOCX parsers
 * so every source produces identical table output.
 */

export interface TableCell {
  /** 1-indexed row position of the cell's top-left corner. */
  row: number;
  /** 1-indexed column position of the cell's top-left corner. */
  col: number;
  /** Number of rows this cell spans (default 1). */
  rowSpan?: number;
  /** Number of columns this cell spans (default 1). */
  colSpan?: number;
  /** Text content of the cell (already trimmed/cleaned by the caller). */
  text: string;
}

export interface CellsToMarkdownOptions {
  /**
   * Whether to include the `<!-- Note: merged cells ... -->` comment when any
   * cell has rowSpan > 1 or colSpan > 1. Defaults to true.
   */
  includeMergedCellsNote?: boolean;
}

const MERGED_CELLS_NOTE =
  "<!-- Note: Merged cells are indicated with [rowspan=X] and [colspan=X] markers -->";

/**
 * Convert table cells into a markdown table. The first row is treated as the
 * header row and receives the `| --- |` separator underneath.
 *
 * Returns an empty string if no cells are provided.
 */
export function cellsToMarkdownTable(
  cells: TableCell[],
  options: CellsToMarkdownOptions = {},
): string {
  if (cells.length === 0) return "";

  const { includeMergedCellsNote = true } = options;

  // Determine grid dimensions — including span reach
  let maxRow = 0;
  let maxCol = 0;
  for (const cell of cells) {
    const rs = cell.rowSpan ?? 1;
    const cs = cell.colSpan ?? 1;
    maxRow = Math.max(maxRow, cell.row + rs - 1);
    maxCol = Math.max(maxCol, cell.col + cs - 1);
  }

  if (maxRow === 0 || maxCol === 0) return "";

  // Allocate empty grid
  const grid: string[][] = Array.from({ length: maxRow }, () =>
    Array(maxCol).fill(""),
  );

  // Sort cells for deterministic placement (top-to-bottom, left-to-right)
  const sorted = [...cells].sort((a, b) => a.row - b.row || a.col - b.col);

  let hasMerged = false;
  for (const cell of sorted) {
    const rs = cell.rowSpan ?? 1;
    const cs = cell.colSpan ?? 1;
    let value = cell.text;

    if (rs > 1 && value !== "") {
      value = `${value} [rowspan=${rs}]`;
      hasMerged = true;
    }
    if (cs > 1) {
      // Note: the original Textract logic appended colspan even for empty
      // cells (which happens when a column header spans multiple sub-columns
      // and has no text). Preserve that behavior so downstream parsers can
      // still detect the merge.
      value = value === "" ? `[colspan=${cs}]` : `${value} [colspan=${cs}]`;
      hasMerged = true;
    }

    // Place at origin
    grid[cell.row - 1][cell.col - 1] = value;
  }

  // Render markdown rows
  const lines: string[] = [];
  if (hasMerged && includeMergedCellsNote) {
    lines.push(MERGED_CELLS_NOTE);
    lines.push("");
  }

  for (let r = 0; r < maxRow; r++) {
    lines.push(`| ${grid[r].join(" | ")} |`);
    if (r === 0) {
      lines.push(`| ${grid[r].map(() => "---").join(" | ")} |`);
    }
  }

  return lines.join("\n");
}
