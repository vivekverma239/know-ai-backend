import type { Chapter, Section as DBSection, SubsectionAPI } from "@/@types/fileIndex";
import type { Cluster, Company, PageSummary } from "@/@types/metadata";
import type { ParsedPDF } from "@/@types/parsedData";
import type { ParsedDocument } from "parse-engine";
import type {
  Toc,
  TocSection,
  DocumentMetadata as ToCDocMetadata,
} from "@/agents/document/parseToCMeta";

/**
 * Shape expected by updateParsedMetadata.
 * Defined locally to work around the duplicate DocumentMetadata declaration
 * in @/@types/metadata.ts which causes interface merging issues.
 */
export interface MappedMetadataCallback {
  clusters: Cluster[];
  total_pages: number;
  page_summaries: PageSummary[];
  document_metadata: {
    document_type: string;
    document_published_date?: string;
    industry: string;
    summary: string;
    short_summary: string;
    title: string;
    entities: string[];
    reference_period?: string;
    reference_period_end_date?: string;
    companies?: Company[];
    published_year: number;
  };
  usage_metadata: Record<string, unknown>;
}

/**
 * Shift a 0-indexed page number to 1-indexed.
 */
const toOneBased = (page: number): number => page + 1;

/**
 * Map parse-engine pages to existing ParsedPDF format.
 */
export function mapPages(result: ParsedDocument): ParsedPDF {
  return {
    title: result.summary?.title ?? "",
    summary: {
      title: result.summary?.title ?? "",
      short_summary: result.summary?.shortSummary ?? "",
      year: result.summary?.year ?? 0,
      date: result.summary?.date ?? "",
      companies: result.summary?.companies ?? [],
      document_type: result.summary?.documentType ?? "OTHER",
    },
    metadata: {
      title: result.metadata?.title ?? result.summary?.title ?? "",
      publication_date: result.metadata?.publicationDate ?? "",
      year: result.metadata?.year ?? "",
      summary: result.metadata?.summary ?? "",
      category: result.metadata?.category ?? "other",
      subcategory: result.metadata?.subcategory ?? "other",
      id: "",
    },
    pages: result.pages.map((p) => ({
      page_number: toOneBased(p.pageNumber),
      content: p.content,
      page_images: [],
    })),
    chart_blocks: result.mediaBlocks.map((mb) => ({
      reference_idx: mb.referenceIdx,
      parsed_data: mb.parsedData,
      page: toOneBased(mb.page),
      idx: mb.idx,
      bounds: mb.bounds as number[],
    })),
  };
}

/**
 * Map parse-engine output to existing MetadataCallback format for updateParsedMetadata.
 */
export function mapMetadata(result: ParsedDocument): MappedMetadataCallback {
  const pageSummaries = (result.pageSummaries ?? []).map((ps) => ({
    page_number: toOneBased(ps.pageNumber),
    summary: ps.summary,
  }));

  // Derive clusters by grouping consecutive page summaries (~10 pages per cluster)
  const clusterSize = 10;
  const clusters = [];
  for (let i = 0; i < pageSummaries.length; i += clusterSize) {
    const batch = pageSummaries.slice(i, i + clusterSize);
    const startPage = batch[0]!.page_number;
    const endPage = batch[batch.length - 1]!.page_number;
    const clusterSummary = batch.map((p) => p.summary).join(" ");
    clusters.push({
      start_page: startPage,
      end_page: endPage,
      cluster_summary: clusterSummary.slice(0, 500),
    });
  }

  return {
    clusters,
    total_pages: result.totalPages,
    page_summaries: pageSummaries,
    document_metadata: {
      document_type: result.metadata?.category ?? result.summary?.documentType ?? "OTHER",
      document_published_date: result.metadata?.publicationDate,
      industry: result.metadata?.industry ?? "other",
      summary: result.metadata?.summary ?? result.summary?.shortSummary ?? "",
      short_summary: result.summary?.shortSummary ?? "",
      title: result.summary?.title ?? result.metadata?.title ?? "",
      entities: result.summary?.companies ?? [],
      reference_period: undefined,
      reference_period_end_date: undefined,
      companies: (result.summary?.companies ?? []).map((name) => ({
        name,
        countries: [],
        industry: [],
        products_or_services: [],
        customers: [],
        suppliers: [],
      })),
      published_year: result.summary?.year ?? 0,
    },
    usage_metadata: {},
  };
}

/**
 * Map parse-engine chapters to existing Chapter[] format for updateOutline.
 */
export function mapOutline(result: ParsedDocument): {
  chapters: Chapter[];
  title: string;
  summary: string;
} {
  const chapters: Chapter[] = (result.chapters ?? []).map((ch) => ({
    title: ch.title,
    summary: ch.summary,
    start_page: toOneBased(ch.startPage),
    end_page: toOneBased(ch.endPage),
    sections: ch.sections.map(
      (sec): DBSection => ({
        id: sec.id,
        title: sec.title,
        start_page: toOneBased(sec.startPage),
        end_page: toOneBased(sec.endPage),
        section_summary: sec.summary,
        subsections: sec.subsections.map(
          (sub): SubsectionAPI => ({
            id: sub.id,
            title: sub.title,
            start_page: toOneBased(sub.startPage),
            end_page: toOneBased(sub.endPage),
            subsection_summary: sub.summary,
          }),
        ),
      }),
    ),
  }));

  return {
    chapters,
    title: result.summary?.title ?? "",
    summary: result.summary?.shortSummary ?? "",
  };
}

/**
 * Map parse-engine output to userFileToCMeta format (replaces separate parseToCMeta agent).
 */
export function mapToCMeta(result: ParsedDocument): {
  toc: Toc;
  metadata: ToCDocMetadata;
  pages: Array<{ pageNumber: number; summary: string; keyPoints: string[] }>;
} {
  // Map chapters -> TocSection format
  const sections: TocSection[] = (result.chapters ?? []).map((ch) => ({
    title: ch.title,
    pageStart: toOneBased(ch.startPage),
    pageEnd: toOneBased(ch.endPage),
    summary: ch.summary,
    subsections: ch.sections.map((sec) => ({
      title: sec.title,
      pageStart: toOneBased(sec.startPage),
      pageEnd: toOneBased(sec.endPage),
      summary: sec.summary,
    })),
  }));

  const metadata: ToCDocMetadata = {
    title: result.summary?.title ?? result.metadata?.title ?? "",
    shortSummary: result.summary?.shortSummary ?? "",
    summary: result.metadata?.summary ?? result.summary?.shortSummary ?? "",
    publishedDate: result.metadata?.publicationDate,
  };

  const pages = (result.pageSummaries ?? []).map((ps) => ({
    pageNumber: toOneBased(ps.pageNumber),
    summary: ps.summary,
    keyPoints: [] as string[],
  }));

  return {
    toc: { sections },
    metadata,
    pages,
  };
}
