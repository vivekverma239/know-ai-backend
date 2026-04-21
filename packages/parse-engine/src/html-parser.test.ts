import { describe, it, expect } from "vitest";
import { parseHtmlToMarkdown } from "./html-parser.js";

describe("parseHtmlToMarkdown", () => {
  it("extracts title from <title>", () => {
    const html = `<html><head><title>My Page</title></head><body><p>Hi</p></body></html>`;
    const result = parseHtmlToMarkdown(html);
    expect(result.title).toBe("My Page");
  });

  it("falls back to og:title if <title> missing", () => {
    const html = `<html><head><meta property="og:title" content="OG Title"/></head><body><p>Hi</p></body></html>`;
    expect(parseHtmlToMarkdown(html).title).toBe("OG Title");
  });

  it("falls back to the first <h1> if <title> and og:title missing", () => {
    const html = `<html><body><h1>First Heading</h1><p>x</p></body></html>`;
    expect(parseHtmlToMarkdown(html).title).toBe("First Heading");
  });

  it("strips scripts, styles, and nav noise", () => {
    const html = `<html><body>
      <script>alert(1)</script>
      <style>p{color:red}</style>
      <nav>nav content</nav>
      <footer>footer content</footer>
      <main><p>real content</p></main>
    </body></html>`;
    const { pages } = parseHtmlToMarkdown(html);
    expect(pages[0].content).toContain("real content");
    expect(pages[0].content).not.toContain("alert");
    expect(pages[0].content).not.toContain("color:red");
    expect(pages[0].content).not.toContain("nav content");
    expect(pages[0].content).not.toContain("footer content");
  });

  it("converts basic markdown structure (headings, bold, lists)", () => {
    const html = `<body><main>
      <h1>Title</h1>
      <p>This is <strong>bold</strong> and <em>italic</em>.</p>
      <ul><li>One</li><li>Two</li></ul>
    </main></body>`;
    const { pages } = parseHtmlToMarkdown(html);
    const md = pages[0].content;
    expect(md).toContain("# Title");
    expect(md).toContain("**bold**");
    expect(md).toMatch(/_italic_|\*italic\*/);
    expect(md).toMatch(/- +One/);
    expect(md).toMatch(/- +Two/);
  });

  it("converts a simple HTML table to a markdown table", () => {
    const html = `<body><main>
      <h1>Data</h1>
      <table>
        <tr><th>Name</th><th>Age</th></tr>
        <tr><td>Alice</td><td>30</td></tr>
        <tr><td>Bob</td><td>25</td></tr>
      </table>
    </main></body>`;
    const { pages } = parseHtmlToMarkdown(html);
    const md = pages[0].content;
    expect(md).toContain("| Name | Age |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| Alice | 30 |");
    expect(md).toContain("| Bob | 25 |");
  });

  it("converts colspan to [colspan=N] markers and shifts subsequent cells", () => {
    const html = `<body>
      <table>
        <tr><th>Name</th><th colspan="2">Scores</th></tr>
        <tr><td>Alice</td><td>90</td><td>85</td></tr>
      </table>
    </body>`;
    const { pages } = parseHtmlToMarkdown(html);
    const md = pages[0].content;
    expect(md).toContain("[colspan=2]");
    expect(md).toContain("<!-- Note: Merged cells");
    // The spanned cell should be empty
    expect(md).toContain("| Name | Scores [colspan=2] |  |");
    expect(md).toContain("| Alice | 90 | 85 |");
  });

  it("converts rowspan and tracks subsequent row cell positions correctly", () => {
    // "Region" spans rows 2 and 3, so the second <tr> only has two <td>s
    const html = `<body>
      <table>
        <tr><th>Region</th><th>Year</th><th>Sales</th></tr>
        <tr><td rowspan="2">West</td><td>2022</td><td>100</td></tr>
        <tr><td>2023</td><td>120</td></tr>
      </table>
    </body>`;
    const { pages } = parseHtmlToMarkdown(html);
    const md = pages[0].content;
    expect(md).toContain("West [rowspan=2]");
    // After the rowspan cell, the next row should shift right (West is at col 1 both rows)
    expect(md).toContain("| West [rowspan=2] | 2022 | 100 |");
    expect(md).toContain("|  | 2023 | 120 |");
  });

  it("handles a complex financial-statement-style table", () => {
    // Two-year comparison with merged year headers
    const html = `<body>
      <table>
        <tr>
          <th></th>
          <th colspan="2">2023</th>
          <th colspan="2">2022</th>
        </tr>
        <tr>
          <th></th>
          <th>Q1</th>
          <th>Q2</th>
          <th>Q1</th>
          <th>Q2</th>
        </tr>
        <tr>
          <td>Revenue</td>
          <td>100</td>
          <td>110</td>
          <td>90</td>
          <td>95</td>
        </tr>
      </table>
    </body>`;
    const { pages } = parseHtmlToMarkdown(html);
    const md = pages[0].content;
    expect(md).toContain("2023 [colspan=2]");
    expect(md).toContain("2022 [colspan=2]");
    expect(md).toContain("| Revenue | 100 | 110 | 90 | 95 |");
  });

  it("produces one page for short content", () => {
    const html = `<body><p>Short content here.</p></body>`;
    const result = parseHtmlToMarkdown(html);
    expect(result.totalPages).toBe(1);
    expect(result.pages).toHaveLength(1);
  });

  it("splits by H1 boundaries when there are 2+ h1 headings", () => {
    const html = `<body><main>
      <h1>Section A</h1>
      <p>Content for A.</p>
      <h1>Section B</h1>
      <p>Content for B.</p>
      <h1>Section C</h1>
      <p>Content for C.</p>
    </main></body>`;
    const { pages, totalPages } = parseHtmlToMarkdown(html);
    expect(totalPages).toBe(3);
    expect(pages[0].content).toMatch(/^# Section A/);
    expect(pages[1].content).toMatch(/^# Section B/);
    expect(pages[2].content).toMatch(/^# Section C/);
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
  });

  it("splits by H2 when there is only one H1 but multiple H2s", () => {
    const html = `<body><main>
      <h1>Doc Title</h1>
      <h2>Chapter 1</h2>
      <p>One</p>
      <h2>Chapter 2</h2>
      <p>Two</p>
    </main></body>`;
    const { pages } = parseHtmlToMarkdown(html);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    // The doc title should appear as preface or be split out
    const joined = pages.map((p) => p.content).join("\n");
    expect(joined).toContain("## Chapter 1");
    expect(joined).toContain("## Chapter 2");
  });

  it("splits long content by paragraph when there are no headings", () => {
    // Use many short paragraphs so pagination can fit them under the budget
    const shortPara = "word ".repeat(50).trim(); // ~250 chars
    const paras = Array.from({ length: 10 }, () => `<p>${shortPara}</p>`).join("");
    const html = `<body>${paras}</body>`;
    const { pages, totalPages } = parseHtmlToMarkdown(html, { maxCharsPerPage: 800 });
    expect(totalPages).toBeGreaterThan(1);
    for (const page of pages) {
      // Each page should respect the budget (give some slack for paragraph boundaries)
      expect(page.content.length).toBeLessThanOrEqual(1100);
    }
  });

  it("preserves inline links and images", () => {
    const html = `<body><p>Visit <a href="https://example.com">our site</a> and see <img src="pic.png" alt="example"/>.</p></body>`;
    const md = parseHtmlToMarkdown(html).pages[0].content;
    expect(md).toContain("[our site](https://example.com)");
    expect(md).toContain("![example](pic.png)");
  });

  it("keeps tables inside the correct page when paginating by heading", () => {
    const html = `<body><main>
      <h1>Section A</h1>
      <table>
        <tr><th>X</th><th>Y</th></tr>
        <tr><td>1</td><td>2</td></tr>
      </table>
      <h1>Section B</h1>
      <p>No table here.</p>
    </main></body>`;
    const { pages } = parseHtmlToMarkdown(html);
    expect(pages).toHaveLength(2);
    expect(pages[0].content).toContain("| X | Y |");
    expect(pages[0].content).toContain("| 1 | 2 |");
    expect(pages[1].content).not.toContain("| X | Y |");
  });
});
