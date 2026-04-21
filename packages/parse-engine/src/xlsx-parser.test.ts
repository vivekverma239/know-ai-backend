import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseXlsxToMarkdown, detectColumnType } from "./xlsx-parser.js";

function makeWorkbook(
  sheets: Record<string, (string | number | boolean | null | Date)[][]>,
  merges?: Record<string, XLSX.Range[]>,
): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (merges?.[name]) ws["!merges"] = merges[name];
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("detectColumnType", () => {
  it("detects numbers", () => {
    expect(detectColumnType([1, 2, 3, 4, 5])).toBe("number");
  });

  it("detects booleans", () => {
    expect(detectColumnType([true, false, true, true])).toBe("boolean");
  });

  it("detects ISO-date strings", () => {
    expect(detectColumnType(["2024-01-01", "2024-02-15", "2024-03-10"])).toBe("date");
  });

  it("detects Date objects", () => {
    expect(detectColumnType([new Date(), new Date(), new Date()])).toBe("date");
  });

  it("falls back to text for mixed data", () => {
    expect(detectColumnType(["abc", 123, "def"])).toBe("text");
  });

  it("returns 'empty' when there are no non-empty values", () => {
    expect(detectColumnType([null, "", undefined])).toBe("empty");
  });
});

describe("parseXlsxToMarkdown", () => {
  it("renders a single sheet with markdown header and table", () => {
    const buffer = makeWorkbook({
      Revenue: [
        ["Region", "Q1", "Q2"],
        ["North", 100, 200],
        ["South", 150, 250],
      ],
    });

    const parsed = parseXlsxToMarkdown(buffer);
    expect(parsed.totalPages).toBe(1);
    expect(parsed.pages[0].sheetName).toBe("Revenue");
    expect(parsed.pages[0].content).toContain("## Sheet: Revenue");
    expect(parsed.pages[0].content).toContain("Dimensions: 2 data rows × 3 columns");
    expect(parsed.pages[0].content).toContain("- Region (text)");
    expect(parsed.pages[0].content).toContain("- Q1 (number)");
    expect(parsed.pages[0].content).toContain("- Q2 (number)");
    expect(parsed.pages[0].content).toContain("| Region | Q1 | Q2 |");
    expect(parsed.pages[0].content).toContain("| --- | --- | --- |");
    expect(parsed.pages[0].content).toContain("| North | 100 | 200 |");
    expect(parsed.pages[0].content).toContain("| South | 150 | 250 |");
  });

  it("produces one page per sheet with correct pageNumber ordering", () => {
    const buffer = makeWorkbook({
      "Sheet A": [["h"], ["a"]],
      "Sheet B": [["h"], ["b"]],
      "Sheet C": [["h"], ["c"]],
    });

    const parsed = parseXlsxToMarkdown(buffer);
    expect(parsed.totalPages).toBe(3);
    expect(parsed.pages.map((p) => p.sheetName)).toEqual(["Sheet A", "Sheet B", "Sheet C"]);
    expect(parsed.pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
  });

  it("preserves merged cells via colspan markers in the markdown table", () => {
    // "Scores" merged across 2 columns in row 1 (A1:B1 in zero-indexed: r=0 c=0..1 → but cell layout is:
    //   | Name | Scores (merged)       |
    //   | a    | 90        | 85        |
    // Merge range: {s:{r:0,c:1}, e:{r:0,c:2}}
    const buffer = makeWorkbook(
      {
        Data: [
          ["Name", "Scores", ""],
          ["a", 90, 85],
        ],
      },
      {
        Data: [{ s: { r: 0, c: 1 }, e: { r: 0, c: 2 } }],
      },
    );

    const parsed = parseXlsxToMarkdown(buffer);
    const md = parsed.pages[0].content;
    expect(md).toContain("[colspan=2]");
    expect(md).toContain("<!-- Note: Merged cells");
    expect(md).toContain("| a | 90 | 85 |");
  });

  it("preserves rowspan markers for vertical merges", () => {
    // "West" merged across rows 2 and 3 column A
    const buffer = makeWorkbook(
      {
        Data: [
          ["Region", "Year", "Sales"],
          ["West", 2022, 100],
          ["", 2023, 120],
        ],
      },
      {
        Data: [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }],
      },
    );

    const parsed = parseXlsxToMarkdown(buffer);
    const md = parsed.pages[0].content;
    expect(md).toContain("West [rowspan=2]");
    expect(md).toContain("| West [rowspan=2] | 2022 | 100 |");
    expect(md).toContain("|  | 2023 | 120 |");
  });

  it("caps rows when maxRowsPerSheet is provided", () => {
    const rows: [string, number][] = [["name", 0]];
    for (let i = 1; i <= 20; i++) rows.push([`row${i}`, i]);

    const buffer = makeWorkbook({ Data: rows });
    const parsed = parseXlsxToMarkdown(buffer, { maxRowsPerSheet: 5 });
    const md = parsed.pages[0].content;

    expect(md).toContain("| row1 | 1 |");
    expect(md).toContain("| row4 | 4 |");
    expect(md).not.toContain("| row6 | 6 |");
    expect(md).toContain("and 15 more rows");
  });

  it("handles empty sheets gracefully", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.book_append_sheet(wb, ws, "Empty");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const parsed = parseXlsxToMarkdown(buffer);
    expect(parsed.totalPages).toBe(1);
    expect(parsed.pages[0].content).toContain("## Sheet: Empty");
    expect(parsed.pages[0].content).toContain("(empty sheet)");
  });
});
