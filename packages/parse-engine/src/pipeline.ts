/**
 * Full document parsing pipeline (TypeScript port).
 *
 * Flow:
 *   1. [--paddle] PaddleOCR → detect media bounding boxes
 *   2. [--paddle] Mask PDF  → white out media regions
 *   3. Mistral OCR          → parse page text from (masked or original) PDF
 *   4. Extract media regions → PNG images per block
 *   5. Parse media           → Tables via Textract, Charts via Claude vision
 *   6. Merge                 → Replace placeholders with parsed content
 *   7. Output                → Final parsed document JSON
 */

import { program } from "commander";
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { env, validateEnv } from "./env.js";

dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });
import { uploadAndGetSignedUrl, deleteTempBlob } from "./storage.js";
import { runPaddleOCR, runPaddleOCRChunked } from "./paddle.js";
import { runMistralOCR, runMistralOCRChunked } from "./mistral.js";
import { maskPdf, mediasToMaskBlocks } from "./mask.js";
import { PdfDocument, cleanupChunks, type ChunkInfo } from "./pdf.js";
import { PipelineContext } from "./context.js";
import { LocalPersistence, fileHash } from "./persistence.js";
import { parseMediaBlocks } from "./services/media.js";
import { placeMediaBlocks } from "./services/placement.js";
import { getBasicSummary } from "./services/summary.js";
import { generatePageSummaries } from "./services/cluster.js";
import { generateOutlineWithChapters } from "./services/outline.js";
import { extractDocumentMetadata } from "./services/metadata.js";
import { getModelConfig } from "./models.js";
import type { DetectedMedia, MediaBlock, ParsedDocument } from "./types.js";

const CHUNK_SIZE = 100; // pages per chunk for Mistral/PaddleOCR

program
  .name("pipeline")
  .description("Full document parsing pipeline (TS port)")
  .argument("<pdf-path>", "Path to the local PDF file")
  .option("-o, --output <dir>", "Output directory", "./output/pipeline")
  .option("--paddle", "Enable PaddleOCR detection + masking")
  .option("--no-mask", "Skip masking even with --paddle (detect only)")
  .option("--modal-url <url>", "Modal web endpoint URL (or MODAL_ENDPOINT_URL env)")
  .option("-b, --bucket <name>", "GCS bucket name")
  .option("--textract", "Use Textract for tables (default: true)", true)
  .option("--no-textract", "Use vision LLM for tables instead of Textract")
  .option("--vision-model <model>", "Vision model for chart parsing (gateway format: provider/model)", "google/gemini-3-flash")
  .option("--concurrency <n>", "Max concurrent media parsing tasks", parseInt, 20)
  .option("--max-pages <n>", "Max pages to process", parseInt)
  .option("--skip-media-parse", "Skip media parsing (steps 4-6), output detection + masking only")
  .action(async (pdfPath: string, opts: {
    output: string;
    paddle?: boolean;
    mask: boolean;
    modalUrl?: string;
    bucket?: string;
    textract: boolean;
    visionModel: string;
    concurrency: number;
    maxPages?: number;
    skipMediaParse?: boolean;
  }) => {
    const resolvedPdf = path.resolve(pdfPath);
    const modalEndpoint = opts.modalUrl || env.modalEndpointUrl;
    const bucketName = opts.bucket || env.gcsBucket;

    // Validate all required config upfront
    const errors = validateEnv({
      paddle: opts.paddle,
      textract: opts.textract,
      skipMediaParse: opts.skipMediaParse,
    });

    if (!fs.existsSync(resolvedPdf)) {
      errors.push(`File not found: ${resolvedPdf}`);
    }
    if (opts.paddle && !modalEndpoint) {
      errors.push("--paddle requires MODAL_ENDPOINT_URL or --modal-url.");
    }
    if (opts.paddle && !bucketName) {
      errors.push("--paddle requires GCS bucket (--bucket or GOOGLE_STORAGE_BUCKET env).");
    }

    if (errors.length > 0) {
      for (const err of errors) console.error(`Error: ${err}`);
      process.exit(1);
    }

    const outDir = path.resolve(opts.output);
    fs.mkdirSync(outDir, { recursive: true });
    const baseName = path.basename(resolvedPdf, ".pdf");


    // Open PDF once and reuse
    const pdf = new PdfDocument(resolvedPdf);
    let chunks: ChunkInfo[] = [];
    const tempBlobPaths: string[] = [];

    try {
      let allMedia: DetectedMedia[] = [];
      const models = getModelConfig();
      const ctx = new PipelineContext({
        persistence: new LocalPersistence(path.join(outDir, ".cache")),
        models,
        documentHash: fileHash(resolvedPdf),
      });
      let pdfForMistral = resolvedPdf;
      const needsChunking = pdf.pageCount > CHUNK_SIZE;

      if (needsChunking) {
        console.log(`\nLarge PDF detected (${pdf.pageCount} pages). Chunking into ${CHUNK_SIZE}-page segments...`);
        chunks = pdf.chunk(CHUNK_SIZE, path.join(outDir, "chunks"));
        console.log(`  Created ${chunks.length} chunks.`);
      }

      // ============================
      // Step 1: PaddleOCR detection (optional)
      // ============================
      if (opts.paddle) {
        console.log("\n[1/11] PaddleOCR → Detecting media blocks...");

        let paddlePages;
        if (needsChunking) {
          // Upload each chunk to GCS and process in parallel
          const chunkUrls = [];
          for (const chunk of chunks) {
            const upload = await uploadAndGetSignedUrl(chunk.path, bucketName!);
            tempBlobPaths.push(upload.blobPath);
            chunkUrls.push({ signedUrl: upload.signedUrl, chunk });
          }
          paddlePages = await runPaddleOCRChunked(chunkUrls, modalEndpoint!);
        } else {
          const upload = await uploadAndGetSignedUrl(resolvedPdf, bucketName!);
          tempBlobPaths.push(upload.blobPath);
          paddlePages = await runPaddleOCR(upload.signedUrl, modalEndpoint!, opts.maxPages);
        }

        allMedia = paddlePages.flatMap((p) => [...p.images, ...p.tables]);
        console.log(`  Found ${allMedia.length} media blocks across ${paddlePages.length} pages`);

        fs.writeFileSync(
          path.join(outDir, `${baseName}_paddle.json`),
          JSON.stringify(paddlePages, null, 2)
        );

        // Step 2: Mask PDF
        if (opts.mask && allMedia.length > 0) {
          console.log("\n[2/11] Masking media blocks in PDF...");
          const maskBlocks = mediasToMaskBlocks(
            allMedia.filter((m) => m.type === "image"),
            allMedia.filter((m) => m.type === "table")
          );
          pdfForMistral = path.join(outDir, `${baseName}_masked.pdf`);
          maskPdf(resolvedPdf, maskBlocks, pdfForMistral);
        } else {
          console.log("\n[2/11] Skipping masking.");
        }
      } else {
        console.log("\n[1/11] PaddleOCR skipped (use --paddle to enable).");
        console.log("[2/11] Masking skipped.");
      }

      // ============================
      // Step 3: Mistral OCR (chunked for large PDFs)
      // ============================
      console.log("\n[3/11] Mistral OCR → Parsing page content...");
      let mistralResult;
      if (needsChunking) {
        // Chunk the PDF to process (might be masked)
        const mistralPdf = new PdfDocument(pdfForMistral);
        const mistralChunks = pdfForMistral === resolvedPdf ? chunks : mistralPdf.chunk(CHUNK_SIZE, path.join(outDir, "mistral_chunks"));
        mistralPdf.destroy();
        mistralResult = await runMistralOCRChunked(mistralChunks, env.mistralApiKey!);
        if (pdfForMistral !== resolvedPdf) cleanupChunks(mistralChunks);
      } else {
        mistralResult = await runMistralOCR(pdfForMistral, env.mistralApiKey!);
      }
      console.log(`  Parsed ${mistralResult.totalPages} pages, ${mistralResult.summary.totalImages} images, ${mistralResult.summary.totalTables} tables`);

      fs.writeFileSync(
        path.join(outDir, `${baseName}_mistral.json`),
        JSON.stringify(mistralResult, null, 2)
      );

      if (!opts.paddle) {
        allMedia = mistralResult.pages.flatMap((p) => [...p.images, ...p.tables]);
      }

      const mediaWithBounds = allMedia.filter((m) => m.bounds != null);

      if (opts.skipMediaParse) {
        console.log("\n[4-6/7] Media parsing skipped (--skip-media-parse).");
        const output: ParsedDocument = {
          totalPages: mistralResult.totalPages,
          pages: mistralResult.pages.map((p) => ({
            pageNumber: p.pageIndex,
            content: p.markdown,
          })),
          mediaBlocks: [],
        };
        const outPath = path.join(outDir, `${baseName}_parsed.json`);
        fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
        console.log(`\n[7/7] Output saved to: ${outPath}`);
        console.log("\nDone!");
        return;
      }

      const mediaDir = path.join(outDir, "media");
      fs.mkdirSync(mediaDir, { recursive: true });

      // ============================
      // Steps 4-7: Media pipeline + Summary in parallel
      // ============================

      console.log(`\n[4/9] Extracting ${mediaWithBounds.length} media regions...`);
      const mediaBlocks: MediaBlock[] = [];
      const pageRenderCache = new Map<number, Buffer>();

      for (let i = 0; i < mediaWithBounds.length; i++) {
        const m = mediaWithBounds[i];
        try {
          const blockBytes = pdf.extractRegion(m.pageIndex, m.bounds!);
          let pageBytes = pageRenderCache.get(m.pageIndex);
          if (!pageBytes) {
            pageBytes = pdf.renderPage(m.pageIndex);
            pageRenderCache.set(m.pageIndex, pageBytes);
          }
          mediaBlocks.push({
            idx: i, page: m.pageIndex, type: m.type,
            originalLabel: m.annotation ?? m.type,
            bounds: m.bounds!, blockBytes, pageBytes,
            cacheKey: `${baseName}_${m.pageIndex}_${i}`,
          });
        } catch (err) {
          console.warn(`  Failed to extract block ${i}: ${err}`);
        }
      }
      console.log(`  Extracted ${mediaBlocks.length}/${mediaWithBounds.length} regions.`);

      for (const block of mediaBlocks) {
        const label = block.type + "_" + block.originalLabel.replace(/[^a-z0-9]/gi, "_").slice(0, 30);
        fs.writeFileSync(
          path.join(mediaDir, `page${block.page + 1}_${label}_${block.idx}.png`),
          block.blockBytes
        );
      }

      // Steps 5+7 in parallel: media parsing + summary
      console.log(`[5/9] Parsing media blocks (tables→${opts.textract ? "Textract" : "LLM"}, charts→${models.smart})...`);
      console.log("[7/9] Extracting basic summary...");

      const [parsedBlocks, summary] = await Promise.all([
        parseMediaBlocks(mediaBlocks, ctx, {
          concurrency: opts.concurrency,
          useTextract: opts.textract,
        }),
        getBasicSummary(pdf, ctx).catch((err) => {
          console.error("  Summary failed:", (err as Error).message);
          return undefined;
        }),
      ]);

      if (summary) {
        console.log(`  Title: ${summary.title}`);
        console.log(`  Type:  ${summary.documentType ?? "unknown"}`);
      }

      fs.writeFileSync(
        path.join(outDir, `${baseName}_parsed_blocks.json`),
        JSON.stringify(parsedBlocks, null, 2)
      );

      // Step 6: Merge parsed media into page content
      console.log("[6/9] Merging parsed media into page content...");
      const mergedPages = placeMediaBlocks(mistralResult.pages, parsedBlocks);

      // ============================
      // Step 7.5: Cluster parsing — compress merged pages into summaries (LITE model)
      // These feed into outline + metadata (much cheaper than full page text)
      // ============================
      console.log("[7.5/9] Generating page summaries (cluster parsing)...");
      const clusterResult = await generatePageSummaries(mergedPages, ctx);
      console.log(`  ${clusterResult.pageSummaries.length} page summaries generated.`);

      // ============================
      // Steps 8+9 in PARALLEL — use compressed page summaries
      // ============================
      console.log("\n[8/9] Detecting chapters and generating outline...");
      console.log("[9/9] Extracting document metadata...");

      let chapters: ParsedDocument["chapters"];
      let outline: ParsedDocument["outline"];
      let metadata: ParsedDocument["metadata"];

      const [outlineResult, metadataResult] = await Promise.allSettled([
        generateOutlineWithChapters(
          clusterResult.pageSummaries,
          summary?.title ?? baseName,
          summary?.shortSummary ?? "",
          ctx,
          { pdfPath: resolvedPdf }
        ),
        extractDocumentMetadata(clusterResult.pageSummaries, ctx),
      ]);

      if (outlineResult.status === "fulfilled") {
        chapters = outlineResult.value.chapters;
        outline = chapters.flatMap((ch) => ch.sections);
        console.log(`  ${chapters.length} chapter(s):`);
        for (const ch of chapters) {
          console.log(`    "${ch.title.slice(0, 80)}" (pp. ${ch.startPage}-${ch.endPage}, ${ch.sections.length} sections)`);
        }
      } else {
        console.error("  Outline generation failed:", outlineResult.reason?.message);
      }

      if (metadataResult.status === "fulfilled") {
        metadata = metadataResult.value;
        console.log(`  Category:    ${metadata.category}`);
        console.log(`  Subcategory: ${metadata.subcategory}`);
        console.log(`  Industry:    ${metadata.industry ?? "unknown"}`);
      } else {
        console.error("  Metadata extraction failed:", metadataResult.reason?.message);
      }

      // ============================
      // Step 11: Final output
      // ============================
      const output: ParsedDocument = {
        totalPages: mistralResult.totalPages,
        pages: mergedPages,
        mediaBlocks: parsedBlocks,
        summary,
        metadata,
        outline,
        chapters,
        usage: ctx.usage.getReport(),
      };

      const outPath = path.join(outDir, `${baseName}_parsed.json`);
      fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

      console.log("\n=== Pipeline Complete ===");
      console.log(`  Pages:          ${output.totalPages}`);
      console.log(`  Media blocks:   ${parsedBlocks.length}`);
      console.log(`  Chapters:       ${chapters?.length ?? 0}`);
      console.log(`  Sections:       ${outline?.length ?? 0}`);
      console.log(`  Category:       ${metadata?.category ?? "unknown"}`);
      console.log(`  Output:         ${outPath}`);
      console.log(`  Media images:   ${mediaDir}/`);
      if (opts.paddle && opts.mask) {
        console.log(`  Masked PDF:     ${path.join(outDir, baseName + "_masked.pdf")}`);
      }

      ctx.usage.printSummary();
    } catch (err) {
      console.error("Pipeline error:", err);
      process.exit(1);
    } finally {
      // Clean up all resources
      pdf.destroy();
      cleanupChunks(chunks);
      for (const blobPath of tempBlobPaths) {
        if (bucketName) await deleteTempBlob(blobPath, bucketName);
      }
    }
  });

program.parse();
