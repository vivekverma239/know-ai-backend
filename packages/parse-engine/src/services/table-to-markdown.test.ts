import { describe, it, expect } from "vitest";
import { cellsToMarkdownTable, type TableCell } from "./table-to-markdown.js";

describe("cellsToMarkdownTable", () => {
  it("returns empty string for no cells", () => {
    expect(cellsToMarkdownTable([])).toBe("");
  });

  it("renders a simple 2x2 table with header separator", () => {
    const cells: TableCell[] = [
      { row: 1, col: 1, text: "A" },
      { row: 1, col: 2, text: "B" },
      { row: 2, col: 1, text: "1" },
      { row: 2, col: 2, text: "2" },
    ];

    expect(cellsToMarkdownTable(cells)).toBe(
      [
        "| A | B |",
        "| --- | --- |",
        "| 1 | 2 |",
      ].join("\n"),
    );
  });

  it("renders a 3x3 table with deterministic ordering regardless of input order", () => {
    // Shuffled input
    const cells: TableCell[] = [
      { row: 3, col: 3, text: "9" },
      { row: 1, col: 1, text: "A" },
      { row: 2, col: 2, text: "5" },
      { row: 1, col: 3, text: "C" },
      { row: 3, col: 1, text: "7" },
      { row: 1, col: 2, text: "B" },
      { row: 2, col: 1, text: "4" },
      { row: 2, col: 3, text: "6" },
      { row: 3, col: 2, text: "8" },
    ];

    expect(cellsToMarkdownTable(cells)).toBe(
      [
        "| A | B | C |",
        "| --- | --- | --- |",
        "| 4 | 5 | 6 |",
        "| 7 | 8 | 9 |",
      ].join("\n"),
    );
  });

  it("annotates a cell with colspan and leaves spanned columns empty", () => {
    const cells: TableCell[] = [
      { row: 1, col: 1, text: "Header A" },
      { row: 1, col: 2, text: "Merged Header", colSpan: 2 },
      { row: 2, col: 1, text: "a" },
      { row: 2, col: 2, text: "b" },
      { row: 2, col: 3, text: "c" },
    ];

    const output = cellsToMarkdownTable(cells);
    expect(output).toContain("<!-- Note: Merged cells are indicated with [rowspan=X] and [colspan=X] markers -->");
    expect(output).toContain("| Header A | Merged Header [colspan=2] |  |");
    expect(output).toContain("| --- | --- | --- |");
    expect(output).toContain("| a | b | c |");
  });

  it("annotates a cell with rowspan and leaves spanned rows empty", () => {
    const cells: TableCell[] = [
      { row: 1, col: 1, text: "Stuck", rowSpan: 2 },
      { row: 1, col: 2, text: "X" },
      { row: 2, col: 2, text: "Y" },
    ];

    const output = cellsToMarkdownTable(cells);
    expect(output).toContain("| Stuck [rowspan=2] | X |");
    expect(output).toContain("|  | Y |");
  });

  it("handles both rowspan and colspan on the same cell", () => {
    const cells: TableCell[] = [
      { row: 1, col: 1, text: "Big", rowSpan: 2, colSpan: 2 },
      { row: 1, col: 3, text: "C" },
      { row: 2, col: 3, text: "F" },
      { row: 3, col: 1, text: "G" },
      { row: 3, col: 2, text: "H" },
      { row: 3, col: 3, text: "I" },
    ];

    const output = cellsToMarkdownTable(cells);
    const lines = output.split("\n");

    // First row: "Big [rowspan=2] [colspan=2]" at col 1, empty at col 2, "C" at col 3
    expect(lines).toContain("| Big [rowspan=2] [colspan=2] |  | C |");
    // Second row: empties at cols 1-2, "F" at col 3
    expect(lines).toContain("|  |  | F |");
    // Third row: G, H, I
    expect(lines).toContain("| G | H | I |");
  });

  it("omits the merged-cells note for tables with no merges", () => {
    const cells: TableCell[] = [
      { row: 1, col: 1, text: "A" },
      { row: 1, col: 2, text: "B" },
      { row: 2, col: 1, text: "1" },
      { row: 2, col: 2, text: "2" },
    ];

    const output = cellsToMarkdownTable(cells);
    expect(output).not.toContain("<!-- Note:");
  });

  it("allows suppressing the merged-cells note via options", () => {
    const cells: TableCell[] = [
      { row: 1, col: 1, text: "A", colSpan: 2 },
      { row: 2, col: 1, text: "1" },
      { row: 2, col: 2, text: "2" },
    ];

    const output = cellsToMarkdownTable(cells, { includeMergedCellsNote: false });
    expect(output).not.toContain("<!-- Note:");
    expect(output).toContain("[colspan=2]");
  });

  it("preserves empty cells as empty strings in the output", () => {
    const cells: TableCell[] = [
      { row: 1, col: 1, text: "A" },
      { row: 1, col: 2, text: "" },
      { row: 2, col: 1, text: "" },
      { row: 2, col: 2, text: "D" },
    ];

    expect(cellsToMarkdownTable(cells)).toBe(
      [
        "| A |  |",
        "| --- | --- |",
        "|  | D |",
      ].join("\n"),
    );
  });

  it("renders a colspan marker on an empty origin cell (matches Textract behavior)", () => {
    // Edge case: a header that spans multiple columns but has no text
    const cells: TableCell[] = [
      { row: 1, col: 1, text: "" },
      { row: 1, col: 2, text: "", colSpan: 2 },
      { row: 2, col: 1, text: "a" },
      { row: 2, col: 2, text: "b" },
      { row: 2, col: 3, text: "c" },
    ];

    const output = cellsToMarkdownTable(cells);
    expect(output).toContain("|  | [colspan=2] |  |");
  });

  it("handles multiple merged regions in a complex table", () => {
    // Matches the pattern of a common financial statement table:
    //   |          | 2023 (colspan=2)          | 2022 (colspan=2)          |
    //   |          | Q1       | Q2             | Q1       | Q2             |
    //   | Revenue  | 100      | 110            | 90       | 95             |
    const cells: TableCell[] = [
      { row: 1, col: 1, text: "" },
      { row: 1, col: 2, text: "2023", colSpan: 2 },
      { row: 1, col: 4, text: "2022", colSpan: 2 },
      { row: 2, col: 1, text: "" },
      { row: 2, col: 2, text: "Q1" },
      { row: 2, col: 3, text: "Q2" },
      { row: 2, col: 4, text: "Q1" },
      { row: 2, col: 5, text: "Q2" },
      { row: 3, col: 1, text: "Revenue" },
      { row: 3, col: 2, text: "100" },
      { row: 3, col: 3, text: "110" },
      { row: 3, col: 4, text: "90" },
      { row: 3, col: 5, text: "95" },
    ];

    const output = cellsToMarkdownTable(cells);
    const lines = output.split("\n");

    // Both merged-region markers should be present
    expect(output).toContain("2023 [colspan=2]");
    expect(output).toContain("2022 [colspan=2]");
    // Header row should have 5 columns
    expect(lines.find((l) => l.includes("2023"))).toMatch(/^\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|/);
    // Revenue row should be complete
    expect(output).toContain("| Revenue | 100 | 110 | 90 | 95 |");
    // Separator row should appear right after the header row
    const sepLine = lines.find((l) => /^\| ---/.test(l));
    expect(sepLine).toBe("| --- | --- | --- | --- | --- |");
  });
});
