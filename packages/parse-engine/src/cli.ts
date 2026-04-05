import { program } from "commander";
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { runMistralOCR } from "./mistral.js";
import { runPaddleOCR } from "./paddle.js";
import { uploadAndGetSignedUrl, deleteTempBlob } from "./storage.js";
import { annotateAndSave } from "./annotate.js";
import type { EvalResult, ComparisonResult, PageComparison, SourceSummary } from "./types.js";

// Load .env from eval-tool dir, then fall back to parent backend_v2 dir
dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });

function printSummary(label: string, summary: SourceSummary) {
  console.log(`\n--- ${label} ---`);
  console.log(`  Images detected:    ${summary.totalImages}`);
  console.log(`  Tables detected:    ${summary.totalTables}`);
  console.log(`  Pages with images:  ${summary.pagesWithImages}`);
  console.log(`  Pages with tables:  ${summary.pagesWithTables}`);
  console.log(`  Pages with media:   ${summary.pagesWithMedia}`);
}

program
  .name("eval-tool")
  .description("Compare Mistral OCR vs PaddleOCR media detection on PDFs")
  .argument("<pdf-path>", "Path to the local PDF file")
  .option("-o, --output <dir>", "Output directory", "./output")
  .option("-k, --api-key <key>", "Mistral API key (or set MISTRAL_API_KEY env)")
  .option("-b, --bucket <name>", "GCS bucket name (or set GOOGLE_BUCKET_NAME env)")
  .option("--modal-url <url>", "Modal web endpoint URL (or set MODAL_ENDPOINT_URL env)")
  .option("--max-pages <n>", "Max pages to process", parseInt)
  .option("--mistral-only", "Only run Mistral OCR (skip PaddleOCR)")
  .option("--paddle-only", "Only run PaddleOCR (skip Mistral)")
  .action(async (pdfPath: string, opts: {
    output: string;
    apiKey?: string;
    bucket?: string;
    modalUrl?: string;
    maxPages?: number;
    mistralOnly?: boolean;
    paddleOnly?: boolean;
  }) => {
    const apiKey = opts.apiKey || process.env.MISTRAL_API_KEY;
    const bucketName = opts.bucket || process.env.GOOGLE_BUCKET_NAME || process.env.google_bucket_name
      || process.env.GOOGLE_STORAGE_BUCKET;
    const modalEndpoint = opts.modalUrl || process.env.MODAL_ENDPOINT_URL;
    const resolvedPdf = path.resolve(pdfPath);

    if (!fs.existsSync(resolvedPdf)) {
      console.error(`Error: File not found: ${resolvedPdf}`);
      process.exit(1);
    }

    if (!opts.paddleOnly && !apiKey) {
      console.error("Error: MISTRAL_API_KEY not set. Pass --api-key, set env, or use --paddle-only.");
      process.exit(1);
    }

    const runPaddle = !opts.mistralOnly;
    if (runPaddle && !bucketName) {
      console.error("Error: GCS bucket required for PaddleOCR. Set GOOGLE_BUCKET_NAME env, pass --bucket, or use --mistral-only.");
      process.exit(1);
    }

    if (runPaddle && !modalEndpoint) {
      console.error("Error: Modal endpoint URL required for PaddleOCR. Set MODAL_ENDPOINT_URL env, pass --modal-url, or use --mistral-only.");
      process.exit(1);
    }

    const outDir = path.resolve(opts.output);
    fs.mkdirSync(outDir, { recursive: true });
    const baseName = path.basename(resolvedPdf, ".pdf");

    let mistralResult: EvalResult | null = null;
    let paddleResult: EvalResult | null = null;
    let tempBlobPath: string | null = null;

    try {
      // --- Upload PDF to GCS if PaddleOCR is needed ---
      let pdfSignedUrl: string | null = null;
      if (runPaddle) {
        console.log("\n=== Uploading PDF to GCS ===");
        const upload = await uploadAndGetSignedUrl(resolvedPdf, bucketName!);
        pdfSignedUrl = upload.signedUrl;
        tempBlobPath = upload.blobPath;
      }

      // --- Run Mistral OCR ---
      if (!opts.paddleOnly) {
        console.log("\n=== Running Mistral OCR ===");
        mistralResult = await runMistralOCR(resolvedPdf, apiKey!);
        const mistralJsonPath = path.join(outDir, `${baseName}_mistral.json`);
        fs.writeFileSync(mistralJsonPath, JSON.stringify(mistralResult, null, 2));
        console.log(`Mistral report saved to: ${mistralJsonPath}`);
        printSummary("Mistral OCR", mistralResult.summary);
      }

      // --- Run PaddleOCR via Modal ---
      if (runPaddle && pdfSignedUrl) {
        console.log("\n=== Running PaddleOCR via Modal ===");
        const paddlePages = await runPaddleOCR(pdfSignedUrl, modalEndpoint!, opts.maxPages);

        const totalImages = paddlePages.reduce((s, p) => s + p.images.length, 0);
        const totalTables = paddlePages.reduce((s, p) => s + p.tables.length, 0);

        paddleResult = {
          totalPages: paddlePages.length,
          pages: paddlePages,
          summary: {
            totalImages,
            totalTables,
            pagesWithMedia: paddlePages.filter(p => p.images.length > 0 || p.tables.length > 0).length,
            pagesWithTables: paddlePages.filter(p => p.tables.length > 0).length,
            pagesWithImages: paddlePages.filter(p => p.images.length > 0).length,
          },
        };

        const paddleJsonPath = path.join(outDir, `${baseName}_paddle.json`);
        fs.writeFileSync(paddleJsonPath, JSON.stringify(paddleResult, null, 2));
        console.log(`PaddleOCR report saved to: ${paddleJsonPath}`);
        printSummary("PaddleOCR", paddleResult.summary);
      }

      // --- Comparison ---
      if (mistralResult && paddleResult) {
        console.log("\n=== Side-by-Side Comparison ===");

        const totalPages = Math.max(mistralResult.totalPages, paddleResult.totalPages);
        const perPage: PageComparison[] = [];

        for (let i = 0; i < totalPages; i++) {
          const mPage = mistralResult.pages.find(p => p.pageIndex === i);
          const pPage = paddleResult.pages.find(p => p.pageIndex === i);

          const cmp: PageComparison = {
            pageIndex: i,
            mistral: { images: mPage?.images.length ?? 0, tables: mPage?.tables.length ?? 0 },
            paddle: pPage ? { images: pPage.images.length, tables: pPage.tables.length } : null,
          };
          perPage.push(cmp);

          // Print pages where either source detected media
          const mTotal = cmp.mistral.images + cmp.mistral.tables;
          const pTotal = (cmp.paddle?.images ?? 0) + (cmp.paddle?.tables ?? 0);
          if (mTotal > 0 || pTotal > 0) {
            const mStr = `M: ${cmp.mistral.images}img/${cmp.mistral.tables}tbl`;
            const pStr = cmp.paddle
              ? `P: ${cmp.paddle.images}img/${cmp.paddle.tables}tbl`
              : "P: N/A";
            const match = mTotal === pTotal ? "" : " <-- DIFF";
            console.log(`  Page ${i + 1}: ${mStr}  |  ${pStr}${match}`);
          }
        }

        const comparison: ComparisonResult = {
          totalPages,
          mistral: mistralResult,
          paddle: paddleResult,
          perPage,
        };

        const comparisonPath = path.join(outDir, `${baseName}_comparison.json`);
        fs.writeFileSync(comparisonPath, JSON.stringify(comparison, null, 2));
        console.log(`\nComparison report saved to: ${comparisonPath}`);
      }

      // --- Annotated PDFs ---
      // Individual per-source annotated PDFs
      if (mistralResult) {
        const mPath = path.join(outDir, `${baseName}_mistral_annotated.pdf`);
        await annotateAndSave(resolvedPdf, mistralResult, mPath);
      }
      if (paddleResult) {
        const pPath = path.join(outDir, `${baseName}_paddle_annotated.pdf`);
        await annotateAndSave(resolvedPdf, paddleResult, pPath);
      }
      // Combined overlay if both sources ran
      if (mistralResult && paddleResult) {
        const combinedPath = path.join(outDir, `${baseName}_combined_annotated.pdf`);
        await annotateAndSave(resolvedPdf, mistralResult, combinedPath, paddleResult);
      }

      console.log("\nDone!");
    } catch (err) {
      console.error("Error during evaluation:", err);
      process.exit(1);
    } finally {
      // Clean up temp GCS blob
      if (tempBlobPath && bucketName) {
        await deleteTempBlob(tempBlobPath, bucketName);
      }
    }
  });

program.parse();
