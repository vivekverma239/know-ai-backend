/**
 * Standalone table parsing test.
 * Takes an image and model, parses the table, prints the result.
 *
 * Usage:
 *   tsx scripts/test-table.ts <image-path>
 *   tsx scripts/test-table.ts <image-path> --model google/gemini-3-flash
 *   tsx scripts/test-table.ts <image-path> --ascii
 */
import { program } from "commander";
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { generateText } from "ai";
import { getGatewayModel } from "../src/ai.js";

dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });

const MARKDOWN_PROMPT = `Convert this table image into a well-formatted markdown table. \
Preserve all data exactly as shown including numbers, percentages, and text. \
Handle merged cells by adding [rowspan=X] and [colspan=X] markers. \
Include all column headers and row labels. \
Output ONLY the markdown table with no additional commentary.`;

const ASCII_PROMPT = `Convert this table image into a well-formatted ASCII table using box-drawing characters. \
Use +, -, and | characters to draw borders. \
Preserve all data exactly as shown including numbers, percentages, and text. \
Align columns properly. Include all column headers and row labels. \
Output ONLY the ASCII table with no additional commentary.`;

program
  .name("test-table")
  .description("Parse a table image with a vision LLM")
  .argument("<image>", "Path to the table image (png/jpg)")
  .option("-m, --model <id>", "Model to use", "google/gemini-2.5-flash")
  .option("-a, --ascii", "Output as ASCII table instead of markdown")
  .option("-p, --prompt <text>", "Custom prompt (overrides default)")
  .action(async (imagePath: string, opts) => {
    const resolved = path.resolve(imagePath);
    if (!fs.existsSync(resolved)) {
      console.error(`File not found: ${resolved}`);
      process.exit(1);
    }

    const imageBytes = fs.readFileSync(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const mediaType = ext === ".png" ? "image/png" : "image/jpeg";
    const prompt = opts.prompt ?? (opts.ascii ? ASCII_PROMPT : MARKDOWN_PROMPT);

    console.log(`Image: ${path.basename(resolved)}`);
    console.log(`Model: ${opts.model}`);
    console.log(`Format: ${opts.ascii ? "ASCII" : "Markdown"}\n`);

    const start = Date.now();
    const llm = getGatewayModel(opts.model);
    const result = await generateText({
      model: llm,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image", image: imageBytes, mediaType: mediaType as any },
        ],
      }],
    });

    const elapsed = Date.now() - start;
    const u = result.totalUsage ?? result.usage;
    const cost = result.providerMetadata?.gateway?.cost
      ? parseFloat(result.providerMetadata.gateway.cost as string)
      : undefined;

    console.log("--- Output ---\n");
    console.log(result.text);
    console.log("\n--- Stats ---");
    console.log(`  Time: ${(elapsed / 1000).toFixed(1)}s`);
    console.log(`  Tokens: ${u?.inputTokens ?? 0} in / ${u?.outputTokens ?? 0} out`);
    if (cost) console.log(`  Cost: $${cost.toFixed(4)}`);
  });

program.parse();
