/**
 * XLSX parser. Converts an Excel workbook into a ParsedDocument where each
 * sheet becomes a separate page. Sheets with merged cells are rendered
 * through the shared cellsToMarkdownTable helper so the output matches the
 * markdown format produced by PDF/HTML/Textract sources.
 *
 * Each page starts with a short sheet header (name, dimensions, inferred
 * column types) followed by the rendered markdown table.
 */

import * as XLSX from "xlsx";
import { cellsToMarkdownTable, type TableCell } from "./services/table-to-markdown.js";

export interface ParsedXlsxPage {
  pageNumber: number;
  /** Sheet name — useful for page indexing or display. */
  sheetName: string;
  content: string;
}

export interface ParsedXlsxDocument {
  title: string;
  pages: ParsedXlsxPage[];
  totalPages: number;
}

export type ColumnType = "number" | "date" | "boolean" | "text" | "empty";

export interface XlsxParserOptions {
  /** Cap the number of data rows rendered per sheet. Defaults to unlimited. */
  maxRowsPerSheet?: number;
}

/** Infer the dominant type of a column from a sample of its values. */
export function detectColumnType(values: unknown[]): ColumnType {
  let numbers = 0;
  let dates = 0;
  let booleans = 0;
  let nonEmpty = 0;

  for (const v of values) {
    if (v == null || v === "") continue;
    nonEmpty++;
    if (typeof v === "number") numbers++;
    else if (typeof v === "boolean") booleans++;
    else if (v instanceof Date) dates++;
    else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) dates++;
  }

  if (nonEmpty === 0) return "empty";
  if (booleans / nonEmpty > 0.8) return "boolean";
  if (dates / nonEmpty > 0.8) return "date";
  if (numbers / nonEmpty > 0.8) return "number";
  return "text";
}

/** Format a cell value for rendering inside a markdown table. */
function formatCell(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return String(value).replace(/\s+/g, " ").trim();
}

interface XlsxCell extends TableCell {
  /** Raw cell value — used for column-type inference before stringification. */
  rawValue: unknown;
}

/**
 * Build XlsxCell[] for a single sheet. Respects merged-cell ranges from
 * sheet["!merges"] so colspan/rowspan markers appear in the markdown output.
 * Each cell keeps both the formatted text (for rendering) and the original
 * JS value (for type inference).
 */
function sheetToCells(sheet: XLSX.WorkSheet): XlsxCell[] {
  const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
  if (!range) return [];

  // Collect merge info keyed by origin (s) and mark spanned positions
  const mergeSpans = new Map<string, { rowSpan: number; colSpan: number }>();
  const spannedOver = new Set<string>();
  const keyOf = (r: number, c: number) => `${r}-${c}`;

  for (const m of sheet["!merges"] ?? []) {
    const rowSpan = m.e.r - m.s.r + 1;
    const colSpan = m.e.c - m.s.c + 1;
    mergeSpans.set(keyOf(m.s.r, m.s.c), { rowSpan, colSpan });
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r !== m.s.r || c !== m.s.c) spannedOver.add(keyOf(r, c));
      }
    }
  }

  const cells: XlsxCell[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (spannedOver.has(keyOf(r, c))) continue;
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[cellRef];
      const rawValue = cell?.v;
      const text = formatCell(rawValue);
      const span = mergeSpans.get(keyOf(r, c));

      cells.push({
        row: r - range.s.r + 1,
        col: c - range.s.c + 1,
        rowSpan: span?.rowSpan ?? 1,
        colSpan: span?.colSpan ?? 1,
        text,
        rawValue,
      });
    }
  }

  return cells;
}

/**
 * Parse an XLSX buffer into a ParsedDocument with one page per sheet.
 */
export function parseXlsxToMarkdown(
  buffer: Buffer,
  options: XlsxParserOptions = {},
): ParsedXlsxDocument {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const maxRows = options.maxRowsPerSheet;

  const pages: ParsedXlsxPage[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    let cells = sheetToCells(sheet);

    // Total rows (including header) reachable from the cell grid
    let totalRows = 0;
    for (const c of cells) totalRows = Math.max(totalRows, c.row + (c.rowSpan ?? 1) - 1);
    const totalDataRows = Math.max(0, totalRows - 1);

    // Apply row cap if configured. maxRowsPerSheet means "max data rows
    // rendered" — the header row (row 1) always stays.
    let cappedNote = "";
    if (maxRows !== undefined && totalDataRows > maxRows) {
      cells = cells.filter((c) => c.row <= maxRows + 1);
      cappedNote = `\n\n_…and ${totalDataRows - maxRows} more rows_`;
    }

    // Infer column types from the raw data-row values (not the formatted text)
    const totalCols = cells.reduce(
      (max, c) => Math.max(max, c.col + (c.colSpan ?? 1) - 1),
      0,
    );
    const columnHeaders: string[] = [];
    const columnTypes: ColumnType[] = [];
    for (let col = 1; col <= totalCols; col++) {
      const headerCell = cells.find((c) => c.row === 1 && c.col === col);
      columnHeaders.push(headerCell?.text || `Col ${col}`);
      const values = cells.filter((c) => c.col === col && c.row > 1).map((c) => c.rawValue);
      columnTypes.push(detectColumnType(values));
    }

    const header = [
      `## Sheet: ${sheetName}`,
      "",
      `Dimensions: ${totalDataRows} data row${totalDataRows === 1 ? "" : "s"} × ${totalCols} column${
        totalCols === 1 ? "" : "s"
      }`,
      "",
      "Columns:",
      ...columnHeaders.map((h, i) => `- ${h} (${columnTypes[i]})`),
      "",
    ].join("\n");

    // Strip the rawValue before handing cells to the shared renderer
    const tableMarkdown = cellsToMarkdownTable(
      cells.map(({ rawValue, ...rest }) => rest),
    );
    const content = tableMarkdown ? `${header}${tableMarkdown}${cappedNote}` : `${header}_(empty sheet)_`;

    pages.push({
      pageNumber: pages.length + 1,
      sheetName,
      content,
    });
  }

  return {
    title: workbook.Props?.Title?.trim() || workbook.SheetNames[0] || "",
    pages,
    totalPages: pages.length,
  };
}
