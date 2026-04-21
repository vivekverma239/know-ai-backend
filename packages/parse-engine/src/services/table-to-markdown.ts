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
  /**
   * Drop columns where every origin cell has empty text. HTML sources such as
   * SEC filings use lots of empty `<td colspan="N">` spacer cells for visual
   * alignment — collapsing them dramatically improves readability without
   * losing data. Defaults to true.
   */
  dropEmptyColumns?: boolean;
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

  const { includeMergedCellsNote = true, dropEmptyColumns = true } = options;

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

    // Only annotate span markers when the cell has actual text. Empty origin
    // cells with spans are usually layout-only (common in HTML tables with
    // visual spacer cells) and leaving them as plain empty strings lets the
    // drop-empty-columns pass collapse them cleanly.
    if (value !== "") {
      if (rs > 1) {
        value = `${value} [rowspan=${rs}]`;
        hasMerged = true;
      }
      if (cs > 1) {
        value = `${value} [colspan=${cs}]`;
        hasMerged = true;
      }
    }

    // Place at origin
    grid[cell.row - 1][cell.col - 1] = value;
  }

  // Optionally drop columns that are empty in every row. Common with HTML
  // tables (especially SEC filings) that use empty `<td>` spacer cells for
  // visual alignment.
  let finalGrid = grid;
  if (dropEmptyColumns) {
    const keepCols: number[] = [];
    for (let c = 0; c < maxCol; c++) {
      let anyContent = false;
      for (let r = 0; r < maxRow; r++) {
        if (grid[r][c] !== "") {
          anyContent = true;
          break;
        }
      }
      if (anyContent) keepCols.push(c);
    }
    if (keepCols.length < maxCol && keepCols.length > 0) {
      finalGrid = grid.map((row) => keepCols.map((c) => row[c]));
    }
  }

  // Render markdown rows
  const lines: string[] = [];
  if (hasMerged && includeMergedCellsNote) {
    lines.push(MERGED_CELLS_NOTE);
    lines.push("");
  }

  for (let r = 0; r < finalGrid.length; r++) {
    lines.push(`| ${finalGrid[r].join(" | ")} |`);
    if (r === 0) {
      lines.push(`| ${finalGrid[r].map(() => "---").join(" | ")} |`);
    }
  }

  return lines.join("\n");
}
