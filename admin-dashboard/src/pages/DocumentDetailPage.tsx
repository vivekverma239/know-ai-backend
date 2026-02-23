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
  getAdminOrgs,
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


// --- Interactive TOC rendering ---
type TocEntry = {
  title?: string;
  page?: number;
  pageNumber?: number;
  children?: TocEntry[];
  items?: TocEntry[];
  [key: string]: unknown;
};

function TocTree({
  entries,
  depth,
  onGoToPage,
}: {
  entries: TocEntry[];
  depth: number;
  onGoToPage: (page: number) => void;
}) {
  return (
    <div className="space-y-0.5">
      {entries.map((entry, i) => {
        const title = entry.title ?? (typeof entry === "string" ? entry : `Item ${i + 1}`);
        const page = entry.page ?? entry.pageNumber;
        const children = entry.children ?? entry.items ?? [];

        return (
          <div key={i}>
            <button
              type="button"
              onClick={() => {
                if (typeof page === "number") onGoToPage(page);
              }}
              className={`w-full text-left px-2 py-1.5 rounded-md text-sm hover:bg-muted transition-colors flex items-center justify-between gap-2 ${
                typeof page === "number" ? "cursor-pointer" : "cursor-default"
              }`}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              <span className="truncate">{String(title)}</span>
              {typeof page === "number" ? (
                <span className="text-xs text-muted-foreground shrink-0">p.{page}</span>
              ) : null}
            </button>
            {Array.isArray(children) && children.length > 0 ? (
              <TocTree entries={children as TocEntry[]} depth={depth + 1} onGoToPage={onGoToPage} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function renderToc(toc: unknown, onGoToPage: (page: number) => void) {
  if (Array.isArray(toc)) {
    return <TocTree entries={toc as TocEntry[]} depth={0} onGoToPage={onGoToPage} />;
  }
  if (toc && typeof toc === "object") {
    // Try to find an array property
    const obj = toc as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (Array.isArray(obj[key])) {
        return <TocTree entries={obj[key] as TocEntry[]} depth={0} onGoToPage={onGoToPage} />;
      }
    }
    // Render as a single-level list from object keys
    const entries = Object.entries(obj).map(([key, val]) => ({
      title: key,
      page: typeof val === "number" ? val : undefined,
    }));
    return <TocTree entries={entries} depth={0} onGoToPage={onGoToPage} />;
  }
  return <p className="text-muted-foreground text-sm">No structured table of contents data.</p>;
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

  const detailQuery = useQuery({
    queryKey: ["admin-document-detail", accessToken, id],
    queryFn: () => getAdminDocumentDetail(accessToken ?? "", id ?? ""),
    enabled: Boolean(accessToken && id),
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

  const orgsQuery = useQuery({
    queryKey: ["admin-orgs", accessToken],
    queryFn: () => getAdminOrgs(accessToken ?? ""),
    enabled: Boolean(accessToken),
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

  const orgName = useMemo(() => {
    const orgId = detailQuery.data?.orgId;
    if (!orgId) return null;
    const org = orgsQuery.data?.items.find((o) => o.orgId === orgId);
    if (!org) return orgId;
    return org.name ?? `Org (${orgId.slice(0, 4)}...${orgId.slice(-4)})`;
  }, [detailQuery.data?.orgId, orgsQuery.data]);

  const registerParsedPageNode = useCallback((pageNumber: number, node: HTMLDivElement | null) => {
    if (node) {
      parsedPageNodesRef.current.set(pageNumber, node);
      return;
    }
    parsedPageNodesRef.current.delete(pageNumber);
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
      setActiveTab("parsed");
      setPendingScrollPage(nextPage);
    },
    [totalPages],
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
          <span className="text-muted-foreground">{orgName ?? document.orgId}</span>
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
              <div className="overflow-auto rounded-lg border border-border bg-muted/30 grid place-items-center max-h-[760px]">
                <Document
                  file={document.signedUrl}
                  loading={<p className="text-muted-foreground p-4">Loading PDF...</p>}
                  options={{ withCredentials: false }}
                  onLoadSuccess={({ numPages }) => {
                    setPdfPageCount(numPages);
                    setPdfLoadError(false);
                  }}
                  onLoadError={(error) => {
                    console.error("[PDF] Load error:", error);
                    console.error("[PDF] signedUrl:", document.signedUrl);
                    setPdfPageCount(null);
                    setPdfLoadError(true);
                  }}
                >
                  <Page
                    pageNumber={currentPage}
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                    width={700}
                  />
                </Document>
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
                <div className="space-y-2">
                  {chaptersQuery.isLoading ? <p className="text-muted-foreground">Loading chapters...</p> : null}
                  {chaptersQuery.isError ? (
                    <p className="text-destructive">Could not load chapters.</p>
                  ) : null}
                  {!chaptersQuery.isLoading && (chaptersQuery.data?.items.length ?? 0) === 0 ? (
                    <p className="text-muted-foreground">No chapters extracted for this document yet.</p>
                  ) : null}
                  {chaptersQuery.data?.items.map((chapter) => (
                    <div
                      key={chapter.id}
                      className="rounded-lg border border-border bg-popover p-3 flex justify-between items-start gap-3"
                    >
                      <div>
                        <h4 className="m-0 text-sm font-bold">{chapter.title}</h4>
                        <p className="m-0 mt-1 text-sm text-muted-foreground">{chapter.summary}</p>
                        <small className="text-xs text-muted-foreground">
                          Pages {chapter.startPage} - {chapter.endPage}
                        </small>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => handleGoToPage(chapter.startPage)}>
                        Go to page
                      </Button>
                    </div>
                  ))}
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
