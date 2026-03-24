import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Document, Page } from "react-pdf";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getAdminDocumentChapters,
  getAdminDocumentDetail,
  getAdminDocumentPages,
  getAdminDocumentSections,
  getAdminDocumentTocMetadata,
} from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

// --- Collapsible JSON tree ---
function JsonValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const [collapsed, setCollapsed] = useState(depth > 1);

  if (value === null) return <span className="text-muted-foreground italic">null</span>;
  if (value === undefined) return <span className="text-muted-foreground italic">undefined</span>;
  if (typeof value === "boolean") return <span className="text-orange-600">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-blue-600">{value}</span>;
  if (typeof value === "string") {
    if (value.length > 200) {
      return <span className="text-green-700 break-all">&quot;{value.slice(0, 200)}...&quot;</span>;
    }
    return <span className="text-green-700 break-all">&quot;{value}&quot;</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">[]</span>;
    return (
      <span>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="text-muted-foreground hover:text-foreground font-mono text-xs mr-1"
        >
          {collapsed ? "▶" : "▼"}
        </button>
        <span className="text-muted-foreground">[{value.length}]</span>
        {!collapsed && (
          <div className="ml-4 border-l border-border pl-2 mt-0.5 space-y-0.5">
            {value.map((item, i) => (
              <div key={i} className="flex gap-1">
                <span className="text-muted-foreground shrink-0">{i}:</span>
                <JsonValue value={item} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-muted-foreground">{"{}"}</span>;
    return (
      <span>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="text-muted-foreground hover:text-foreground font-mono text-xs mr-1"
        >
          {collapsed ? "▶" : "▼"}
        </button>
        <span className="text-muted-foreground">{"{"}...{"}"}</span>
        {!collapsed && (
          <div className="ml-4 border-l border-border pl-2 mt-0.5 space-y-0.5">
            {entries.map(([key, val]) => (
              <div key={key} className="flex gap-1">
                <span className="text-purple-600 shrink-0">{key}:</span>
                <JsonValue value={val} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }

  return <span>{String(value)}</span>;
}
const PARSED_PAGE_BATCH_SIZE = 20;
const SOURCE_PDF_BATCH_SIZE = 6;


// --- Interactive TOC rendering with accordion ---
type TocEntry = {
  title?: string;
  page?: number;
  pageNumber?: number;
  pageStart?: number;
  pageEnd?: number;
  summary?: string;
  children?: TocEntry[];
  items?: TocEntry[];
  subsections?: TocEntry[];
  [key: string]: unknown;
};

function TocNode({
  entry,
  depth,
  onGoToPage,
}: {
  entry: TocEntry;
  depth: number;
  onGoToPage: (page: number) => void;
}) {
  const children = entry.children ?? entry.items ?? entry.subsections ?? [];
  const hasChildren = Array.isArray(children) && children.length > 0;
  const [open, setOpen] = useState(false);
  const title = entry.title ?? (typeof entry === "string" ? entry : "Untitled");
  const page = entry.page ?? entry.pageNumber ?? entry.pageStart;
  const pageEnd = entry.pageEnd;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (hasChildren) setOpen(!open);
          else if (typeof page === "number") onGoToPage(page);
        }}
        className={`w-full text-left px-2 py-1.5 rounded-md text-sm hover:bg-muted transition-colors flex items-center gap-2 group ${
          hasChildren ? "cursor-pointer" : typeof page === "number" ? "cursor-pointer" : "cursor-default"
        }`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {hasChildren && (
          <span className="text-muted-foreground text-xs font-mono shrink-0 w-3">
            {open ? "▼" : "▶"}
          </span>
        )}
        {!hasChildren && <span className="w-3 shrink-0" />}
        <span className="flex-1 min-w-0">
          <span className="truncate block font-medium">{String(title)}</span>
          {entry.summary && (
            <span className="text-xs text-muted-foreground line-clamp-1 block mt-0.5">
              {entry.summary}
            </span>
          )}
        </span>
        {typeof page === "number" && (
          <span
            className="text-xs text-primary shrink-0 hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              onGoToPage(page);
            }}
          >
            {pageEnd && pageEnd !== page ? `p.${page}–${pageEnd}` : `p.${page}`}
          </span>
        )}
      </button>
      {open && hasChildren && (
        <div className={depth === 0 ? "border-l border-border/50 ml-4" : ""}>
          {(children as TocEntry[]).map((child, i) => (
            <TocNode key={i} entry={child} depth={depth + 1} onGoToPage={onGoToPage} />
          ))}
        </div>
      )}
    </div>
  );
}

function TocTree({
  entries,
  onGoToPage,
}: {
  entries: TocEntry[];
  onGoToPage: (page: number) => void;
}) {
  return (
    <div className="space-y-0.5">
      {entries.map((entry, i) => (
        <TocNode key={i} entry={entry} depth={0} onGoToPage={onGoToPage} />
      ))}
    </div>
  );
}

function renderToc(toc: unknown, onGoToPage: (page: number) => void) {
  if (Array.isArray(toc)) {
    return <TocTree entries={toc as TocEntry[]} onGoToPage={onGoToPage} />;
  }
  if (toc && typeof toc === "object") {
    const obj = toc as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (Array.isArray(obj[key])) {
        return <TocTree entries={obj[key] as TocEntry[]} onGoToPage={onGoToPage} />;
      }
    }
    const entries = Object.entries(obj).map(([key, val]) => ({
      title: key,
      page: typeof val === "number" ? val : undefined,
    }));
    return <TocTree entries={entries} onGoToPage={onGoToPage} />;
  }
  return <p className="text-muted-foreground text-sm">No structured table of contents data.</p>;
}

// --- Chapter → Section → Subsection accordion ---
function ChapterAccordion({
  chapter,
  sections,
  onGoToPage,
}: {
  chapter: { id: string; title: string; summary: string; startPage: number; endPage: number };
  sections: { id: string; title: string; summary: string; startPage: number; endPage: number; subsections?: { id: string; title: string; startPage: number; endPage: number; summary: string }[] | null }[];
  onGoToPage: (page: number) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-popover">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-left p-3 flex items-start justify-between gap-3 hover:bg-muted/50 transition-colors rounded-lg"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs font-mono shrink-0">
              {open ? "▼" : "▶"}
            </span>
            <h4 className="m-0 text-sm font-bold truncate">{chapter.title}</h4>
          </div>
          <p className="m-0 mt-1 text-sm text-muted-foreground line-clamp-2 ml-5">
            {chapter.summary}
          </p>
          <small className="text-xs text-muted-foreground ml-5">
            Pages {chapter.startPage} – {chapter.endPage}
            {sections.length > 0 && ` · ${sections.length} section${sections.length !== 1 ? "s" : ""}`}
          </small>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onGoToPage(chapter.startPage);
          }}
        >
          Go to page
        </Button>
      </button>

      {open && sections.length > 0 && (
        <div className="border-t border-border px-3 pb-3 space-y-1.5 pt-2">
          {sections.map((section) => (
            <SectionAccordion
              key={section.id}
              section={section}
              onGoToPage={onGoToPage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SectionAccordion({
  section,
  onGoToPage,
}: {
  section: {
    id: string;
    title: string;
    summary: string;
    startPage: number;
    endPage: number;
    subsections?: { id: string; title: string; startPage: number; endPage: number; summary: string }[] | null;
  };
  onGoToPage: (page: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const subsections = section.subsections ?? [];

  return (
    <div className="rounded-md border border-border/60 bg-muted/20">
      <button
        type="button"
        onClick={() => subsections.length > 0 && setOpen(!open)}
        className={`w-full text-left px-3 py-2 flex items-start justify-between gap-2 transition-colors rounded-md ${
          subsections.length > 0 ? "hover:bg-muted/50 cursor-pointer" : "cursor-default"
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {subsections.length > 0 && (
              <span className="text-muted-foreground text-xs font-mono shrink-0">
                {open ? "▼" : "▶"}
              </span>
            )}
            <span className="text-sm font-medium">{section.title}</span>
          </div>
          <p className="m-0 mt-0.5 text-xs text-muted-foreground line-clamp-1 ml-5">
            {section.summary}
          </p>
        </div>
        <span
          className="text-xs text-primary shrink-0 cursor-pointer hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            onGoToPage(section.startPage);
          }}
        >
          p.{section.startPage}–{section.endPage}
        </span>
      </button>

      {open && subsections.length > 0 && (
        <div className="border-t border-border/40 px-3 pb-2 pt-1.5 ml-5 space-y-1">
          {subsections.map((sub) => (
            <button
              key={sub.id}
              type="button"
              onClick={() => onGoToPage(sub.startPage)}
              className="w-full text-left px-2 py-1 rounded text-xs hover:bg-muted/50 transition-colors flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <span className="font-medium">{sub.title}</span>
                {sub.summary && (
                  <span className="text-muted-foreground ml-1">– {sub.summary}</span>
                )}
              </div>
              <span className="text-muted-foreground shrink-0">
                p.{sub.startPage}–{sub.endPage}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const accessToken = useAuthStore((state) => state.accessToken);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [pdfLoadError, setPdfLoadError] = useState(false);
  const [activeTab, setActiveTab] = useState("parsed");
  const [pendingScrollPage, setPendingScrollPage] = useState<number | null>(null);
  const parsedScrollRef = useRef<HTMLDivElement | null>(null);
  const parsedPageNodesRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const sourcePdfScrollRef = useRef<HTMLDivElement | null>(null);
  const sourcePdfPageNodesRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const [sourceRenderedPdfPages, setSourceRenderedPdfPages] = useState(SOURCE_PDF_BATCH_SIZE);

  const detailQuery = useQuery({
    queryKey: ["admin-document-detail", accessToken, id],
    queryFn: () => getAdminDocumentDetail(accessToken ?? "", id ?? ""),
    enabled: Boolean(accessToken && id),
    staleTime: 30 * 60 * 1000,
    refetchOnMount: false,
  });

  const sectionsQuery = useQuery({
    queryKey: ["admin-document-sections", accessToken, id],
    queryFn: () => getAdminDocumentSections(accessToken ?? "", id ?? "", { page: 1, pageSize: 100 }),
    enabled: Boolean(accessToken && id),
  });

  const chaptersQuery = useQuery({
    queryKey: ["admin-document-chapters", accessToken, id],
    queryFn: () => getAdminDocumentChapters(accessToken ?? "", id ?? ""),
    enabled: Boolean(accessToken && id),
  });

  const tocMetadataQuery = useQuery({
    queryKey: ["admin-document-toc-meta", accessToken, id],
    queryFn: () => getAdminDocumentTocMetadata(accessToken ?? "", id ?? ""),
    enabled: Boolean(accessToken && id),
  });

  const parsedPagesQuery = useInfiniteQuery({
    queryKey: ["admin-document-pages", accessToken, id],
    enabled: Boolean(accessToken && id),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      getAdminDocumentPages(accessToken ?? "", id ?? "", {
        page: pageParam,
        pageSize: PARSED_PAGE_BATCH_SIZE,
      }),
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.items.length, 0);
      if (loaded >= lastPage.total) return undefined;
      return allPages.length + 1;
    },
  });

  const parsedPages = useMemo(
    () => parsedPagesQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [parsedPagesQuery.data?.pages],
  );
  const parsedPagesTotal = parsedPagesQuery.data?.pages[0]?.total ?? 0;
  const loadedMaxParsedPage = parsedPages.at(-1)?.pageNumber ?? 0;

  const totalPages = useMemo(
    () => Math.max(1, detailQuery.data?.numPages ?? 0, parsedPagesTotal, pdfPageCount ?? 0),
    [detailQuery.data?.numPages, parsedPagesTotal, pdfPageCount],
  );
  const sourcePdfTotalPages = pdfPageCount ?? detailQuery.data?.numPages ?? 1;
  const sourceVisiblePdfPages = useMemo(
    () => Math.min(Math.max(1, sourcePdfTotalPages), Math.max(1, sourceRenderedPdfPages)),
    [sourcePdfTotalPages, sourceRenderedPdfPages],
  );
  const pdfDocumentOptions = useMemo(() => ({ withCredentials: false }), []);

  const registerParsedPageNode = useCallback((pageNumber: number, node: HTMLDivElement | null) => {
    if (node) {
      parsedPageNodesRef.current.set(pageNumber, node);
      return;
    }
    parsedPageNodesRef.current.delete(pageNumber);
  }, []);

  const registerSourcePdfPageNode = useCallback((pageNumber: number, node: HTMLDivElement | null) => {
    if (node) {
      sourcePdfPageNodesRef.current.set(pageNumber, node);
      return;
    }
    sourcePdfPageNodesRef.current.delete(pageNumber);
  }, []);

  const ensureSourcePdfPageRendered = useCallback(
    (pageNumber: number) => {
      const target = clamp(pageNumber + 2, 1, sourcePdfTotalPages);
      setSourceRenderedPdfPages((prev) => Math.max(prev, target));
    },
    [sourcePdfTotalPages],
  );

  const scrollToSourcePdfPage = useCallback((pageNumber: number) => {
    const node = sourcePdfPageNodesRef.current.get(pageNumber);
    if (!node) return;
    node.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const ensureParsedPageLoaded = useCallback(
    async (targetPage: number) => {
      let safety = 0;
      let maxLoadedPage = loadedMaxParsedPage;
      while (maxLoadedPage < targetPage && parsedPagesQuery.hasNextPage && safety < 30) {
        const result = await parsedPagesQuery.fetchNextPage();
        maxLoadedPage =
          result.data?.pages.flatMap((page) => page.items).at(-1)?.pageNumber ?? maxLoadedPage;
        safety += 1;
      }
    },
    [loadedMaxParsedPage, parsedPagesQuery],
  );

  const scrollToParsedPage = useCallback(
    async (pageNumber: number) => {
      await ensureParsedPageLoaded(pageNumber);
      const node = parsedPageNodesRef.current.get(pageNumber);
      if (!node) return;
      node.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    },
    [ensureParsedPageLoaded],
  );

  const handleGoToPage = useCallback(
    (pageNumber: number) => {
      const nextPage = clamp(pageNumber, 1, totalPages);
      setCurrentPage(nextPage);
      ensureSourcePdfPageRendered(nextPage);
      requestAnimationFrame(() => {
        scrollToSourcePdfPage(nextPage);
      });
      setActiveTab("parsed");
      setPendingScrollPage(nextPage);
    },
    [ensureSourcePdfPageRendered, scrollToSourcePdfPage, totalPages],
  );

  const handleParsedScroll = useCallback(() => {
    const container = parsedScrollRef.current;
    if (!container) return;

    if (
      parsedPagesQuery.hasNextPage &&
      !parsedPagesQuery.isFetchingNextPage &&
      container.scrollTop + container.clientHeight >= container.scrollHeight - 240
    ) {
      void parsedPagesQuery.fetchNextPage();
    }

    let nearestPage = currentPage;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const [pageNumber, node] of parsedPageNodesRef.current.entries()) {
      const distance = Math.abs(node.offsetTop - container.scrollTop);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPage = pageNumber;
      }
    }

    if (nearestPage !== currentPage) {
      setCurrentPage(nearestPage);
    }
  }, [currentPage, parsedPagesQuery]);

  const handleSourcePdfScroll = useCallback(() => {
    const container = sourcePdfScrollRef.current;
    if (!container) return;

    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 320) {
      setSourceRenderedPdfPages((prev) => Math.min(sourcePdfTotalPages, prev + SOURCE_PDF_BATCH_SIZE));
    }

    let nearestPage = currentPage;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const [pageNumber, node] of sourcePdfPageNodesRef.current.entries()) {
      const distance = Math.abs(node.offsetTop - container.scrollTop);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPage = pageNumber;
      }
    }

    if (nearestPage !== currentPage) {
      setCurrentPage(nearestPage);
    }
  }, [currentPage, sourcePdfTotalPages]);

  useEffect(() => {
    setCurrentPage((value) => clamp(value, 1, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (activeTab !== "parsed") return;
    if (parsedPagesQuery.hasNextPage && !parsedPagesQuery.isFetchingNextPage) {
      if (loadedMaxParsedPage - currentPage <= 3) {
        void parsedPagesQuery.fetchNextPage();
      }
    }
  }, [activeTab, currentPage, loadedMaxParsedPage, parsedPagesQuery]);

  useEffect(() => {
    if (activeTab !== "parsed" || pendingScrollPage === null) return;
    let cancelled = false;

    const run = async () => {
      await scrollToParsedPage(pendingScrollPage);
      if (cancelled) return;
      setPendingScrollPage(null);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [activeTab, pendingScrollPage, scrollToParsedPage]);

  useEffect(() => {
    setPdfLoadError(false);
    setSourceRenderedPdfPages(SOURCE_PDF_BATCH_SIZE);
    sourcePdfPageNodesRef.current.clear();
  }, [detailQuery.data?.signedUrl, id]);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  if (!id) {
    return <p className="text-destructive">Invalid document id</p>;
  }

  if (detailQuery.isLoading) {
    return <p className="text-muted-foreground">Loading document...</p>;
  }

  if (detailQuery.isError || !detailQuery.data) {
    return <p className="text-destructive">Could not load document details.</p>;
  }

  const document = detailQuery.data;
  const activeSection =
    sectionsQuery.data?.items.find(
      (section) => currentPage >= section.startPage && currentPage <= section.endPage,
    ) ?? null;
  const extractedMetadata = tocMetadataQuery.data?.extractedMetadata;
  const fileMetadata = tocMetadataQuery.data?.fileMetadata ?? document.metadata ?? null;

  return (
    <section>
      {/* Compact header: title + meta inline */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/dashboard/documents">
            <Button variant="ghost" size="sm" className="shrink-0">Back</Button>
          </Link>
          <h2 className="m-0 text-lg font-semibold truncate">{document.name}</h2>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Badge variant={document.status === "completed" ? "default" : document.status === "failed" ? "destructive" : "secondary"}>
            {document.status}
          </Badge>
          <span className="text-muted-foreground">{document.type}</span>
          <span className="text-muted-foreground">{document.orgId}</span>
          <span className="text-muted-foreground">{document.numPages} pages</span>
        </div>
      </div>

      {/* Page navigation */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Button variant="outline" size="sm" onClick={() => handleGoToPage(currentPage - 1)} disabled={currentPage <= 1}>
          Prev
        </Button>
        <span className="text-sm text-muted-foreground">
          {currentPage} / {totalPages}
        </span>
        <Input
          type="number"
          min={1}
          max={totalPages}
          value={pageInput}
          onChange={(event) => setPageInput(event.target.value)}
          className="w-16"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const parsed = Number.parseInt(pageInput, 10);
            if (!Number.isFinite(parsed)) return;
            handleGoToPage(parsed);
          }}
        >
          Go
        </Button>
        <Button variant="outline" size="sm" onClick={() => handleGoToPage(currentPage + 1)} disabled={currentPage >= totalPages}>
          Next
        </Button>
      </div>

      {/* Compare grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Source panel */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center justify-between gap-2">
              Source
              {document.type === "pdf" && document.signedUrl ? (
                <Link to={`/dashboard/documents/${id}/pdf`}>
                  <Button variant="default" size="sm">Open PDF Viewer</Button>
                </Link>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {document.type === "pdf" && document.signedUrl && !pdfLoadError ? (
              <div
                className="overflow-auto rounded-lg border border-border bg-muted/30 max-h-[760px] p-2"
                ref={sourcePdfScrollRef}
                onScroll={handleSourcePdfScroll}
              >
                <Document
                  key={document.signedUrl}
                  file={document.signedUrl}
                  loading={<p className="text-muted-foreground p-4">Loading PDF...</p>}
                  options={pdfDocumentOptions}
                  onLoadSuccess={({ numPages }) => {
                    setPdfPageCount(numPages);
                    setPdfLoadError(false);
                    setSourceRenderedPdfPages(Math.min(Math.max(1, numPages), SOURCE_PDF_BATCH_SIZE));
                  }}
                  onLoadError={(error) => {
                    console.error("[PDF] Load error:", error);
                    console.error("[PDF] signedUrl:", document.signedUrl);
                    setPdfPageCount(null);
                    setPdfLoadError(true);
                  }}
                >
                  <div className="space-y-3">
                    {Array.from({ length: sourceVisiblePdfPages }, (_, index) => index + 1).map(
                      (pageNumber) => (
                        <div
                          key={pageNumber}
                          ref={(node) => registerSourcePdfPageNode(pageNumber, node)}
                          className={`rounded-md border p-2 ${
                            pageNumber === currentPage ? "border-primary" : "border-border"
                          }`}
                        >
                          <Page
                            pageNumber={pageNumber}
                            renderAnnotationLayer={false}
                            renderTextLayer={false}
                            width={700}
                          />
                        </div>
                      ),
                    )}
                    {sourceVisiblePdfPages < sourcePdfTotalPages ? (
                      <div className="flex justify-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setSourceRenderedPdfPages((prev) =>
                              Math.min(sourcePdfTotalPages, prev + SOURCE_PDF_BATCH_SIZE),
                            )
                          }
                        >
                          Load More Pages
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </Document>
              </div>
            ) : document.type === "pdf" && document.signedUrl && pdfLoadError ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  PDF.js preview failed (likely CORS). Showing browser PDF fallback.
                </p>
                <iframe
                  src={document.signedUrl}
                  title={`PDF preview for ${document.name}`}
                  className="w-full h-[760px] rounded-lg border border-border bg-muted/30"
                />
              </div>
            ) : (
              <div className="border border-dashed border-border rounded-lg bg-muted/30 p-6">
                <p className="text-muted-foreground">No PDF available for preview.</p>
                {document.sourceDocumentUrl ? (
                  <a href={document.sourceDocumentUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                    Open source URL
                  </a>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Parsed output panel */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Parsed Output Workspace</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 mb-3">
                <TabsTrigger value="parsed">Parsed Pages</TabsTrigger>
                <TabsTrigger value="chapters">Chapters</TabsTrigger>
                <TabsTrigger value="toc">Table of Contents</TabsTrigger>
                <TabsTrigger value="metadata">Metadata</TabsTrigger>
              </TabsList>

              <TabsContent value="parsed">
                {parsedPagesQuery.isLoading ? (
                  <p className="text-muted-foreground">Loading parsed pages...</p>
                ) : null}
                {parsedPagesQuery.isError ? (
                  <p className="text-destructive">Could not load parsed pages.</p>
                ) : null}
                {!parsedPagesQuery.isLoading && parsedPages.length === 0 ? (
                  <p className="text-muted-foreground">No parsed pages found yet.</p>
                ) : null}

                {parsedPages.length > 0 ? (
                  <div
                    className="max-h-[560px] overflow-auto rounded-lg border border-border bg-muted/20 p-2 space-y-2"
                    ref={parsedScrollRef}
                    onScroll={handleParsedScroll}
                  >
                    {parsedPages.map((page) => (
                      <div
                        key={page.id}
                        ref={(node) => registerParsedPageNode(page.pageNumber, node)}
                        className={`rounded-lg border bg-popover p-3 ${
                          currentPage === page.pageNumber
                            ? "border-primary shadow-sm shadow-primary/20"
                            : "border-border"
                        }`}
                      >
                        <div className="flex justify-between items-center gap-2 mb-2">
                          <strong className="text-sm">Page {page.pageNumber}</strong>
                          <Button variant="outline" size="sm" onClick={() => handleGoToPage(page.pageNumber)}>
                            Sync
                          </Button>
                        </div>
                        <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-code:bg-muted prose-code:px-1 prose-code:rounded prose-pre:bg-muted prose-pre:border prose-pre:border-border">
                          <Markdown remarkPlugins={[remarkGfm]}>{page.content}</Markdown>
                        </div>
                      </div>
                    ))}
                    {parsedPagesQuery.isFetchingNextPage ? (
                      <p className="text-muted-foreground text-sm text-center py-2">Loading more pages...</p>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-3 border-t border-dashed border-border pt-3">
                  <h4 className="text-sm font-bold m-0">Section Context</h4>
                  {activeSection ? (
                    <>
                      <p className="font-bold mt-1 mb-0.5 text-sm">{activeSection.title}</p>
                      <p className="text-sm text-muted-foreground m-0">{activeSection.summary}</p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground m-0">No section mapped for this page.</p>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="chapters">
                <div className="space-y-2 max-h-[560px] overflow-auto">
                  {chaptersQuery.isLoading ? <p className="text-muted-foreground">Loading chapters...</p> : null}
                  {chaptersQuery.isError ? (
                    <p className="text-destructive">Could not load chapters.</p>
                  ) : null}
                  {!chaptersQuery.isLoading && (chaptersQuery.data?.items.length ?? 0) === 0 ? (
                    <p className="text-muted-foreground">No chapters extracted for this document yet.</p>
                  ) : null}
                  {chaptersQuery.data?.items.map((chapter) => {
                    const chapterSections = sectionsQuery.data?.items.filter(
                      (s) => s.chapterId === chapter.id,
                    ) ?? [];
                    return (
                      <ChapterAccordion
                        key={chapter.id}
                        chapter={chapter}
                        sections={chapterSections}
                        onGoToPage={handleGoToPage}
                      />
                    );
                  })}
                </div>
              </TabsContent>

              <TabsContent value="toc">
                <div className="space-y-2">
                  {tocMetadataQuery.isLoading ? (
                    <p className="text-muted-foreground">Loading table of contents...</p>
                  ) : null}
                  {tocMetadataQuery.isError ? (
                    <p className="text-destructive">Could not load table of contents.</p>
                  ) : null}
                  {!tocMetadataQuery.isLoading && !tocMetadataQuery.data?.toc ? (
                    <p className="text-muted-foreground">No table of contents data found.</p>
                  ) : null}
                  {tocMetadataQuery.data?.toc ? (
                    <div className="rounded-lg border border-border bg-popover p-3 max-h-[460px] overflow-auto">
                      {renderToc(tocMetadataQuery.data.toc, handleGoToPage)}
                    </div>
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent value="metadata">
                <div className="space-y-3">
                  {tocMetadataQuery.isLoading ? <p className="text-muted-foreground">Loading metadata...</p> : null}

                  {!tocMetadataQuery.isLoading && !extractedMetadata && !fileMetadata ? (
                    <p className="text-muted-foreground">No metadata extracted yet.</p>
                  ) : null}

                  {extractedMetadata ? (
                    <div className="rounded-lg border border-border bg-popover p-3">
                      <h4 className="m-0 mb-2 text-sm font-bold">Extracted Metadata</h4>
                      <div className="rounded-md border border-border bg-muted/30 p-3 max-h-[420px] overflow-auto text-xs font-mono">
                        <JsonValue value={extractedMetadata} />
                      </div>
                    </div>
                  ) : null}

                  {fileMetadata ? (
                    <div className="rounded-lg border border-border bg-popover p-3">
                      <h4 className="m-0 mb-2 text-sm font-bold">File Metadata</h4>
                      <div className="rounded-md border border-border bg-muted/30 p-3 max-h-[420px] overflow-auto text-xs font-mono">
                        <JsonValue value={fileMetadata} />
                      </div>
                    </div>
                  ) : null}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
