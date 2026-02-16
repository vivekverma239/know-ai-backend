import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Document, Page } from "react-pdf";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getAdminDocumentChapters,
  getAdminDocumentDetail,
  getAdminDocumentPages,
  getAdminDocumentSections,
  getAdminDocumentTocMetadata,
} from "../lib/api";
import { useAuthStore } from "../store/authStore";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const PARSED_PAGE_BATCH_SIZE = 20;

type DetailTab = "parsed" | "chapters" | "toc" | "metadata";

const formatJson = (value: unknown) => JSON.stringify(value, null, 2);

export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const accessToken = useAuthStore((state) => state.accessToken);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [pdfLoadError, setPdfLoadError] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>("parsed");
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
    queryFn: () => getAdminDocumentSections(accessToken ?? "", id ?? "", { page: 1, pageSize: 200 }),
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
    return <p className="state-text error">Invalid document id</p>;
  }

  if (detailQuery.isLoading) {
    return <p className="state-text">Loading document...</p>;
  }

  if (detailQuery.isError || !detailQuery.data) {
    return <p className="state-text error">Could not load document details.</p>;
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
      <div className="section-head with-link">
        <div>
          <p className="eyebrow">Document QA</p>
          <h2>{document.name}</h2>
        </div>
        <Link className="action-link" to="/dashboard/documents">
          Back to list
        </Link>
      </div>

      <div className="detail-meta-grid">
        <article>
          <h3>Status</h3>
          <p>{document.status}</p>
        </article>
        <article>
          <h3>Type</h3>
          <p>{document.type}</p>
        </article>
        <article>
          <h3>Org</h3>
          <p>{document.orgId}</p>
        </article>
        <article>
          <h3>Pages</h3>
          <p>{document.numPages}</p>
        </article>
      </div>

      <div className="pagination-row">
        <button
          type="button"
          onClick={() => handleGoToPage(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          Previous Page
        </button>
        <div className="page-jump">
          <span>
            Page {currentPage} / {totalPages}
          </span>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              const parsed = Number.parseInt(pageInput, 10);
              if (!Number.isFinite(parsed)) return;
              handleGoToPage(parsed);
            }}
          >
            Jump
          </button>
        </div>
        <button
          type="button"
          onClick={() => handleGoToPage(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          Next Page
        </button>
      </div>

      <div className="compare-grid">
        <article className="compare-card">
          <h3>Source</h3>
          {document.type === "pdf" && document.signedUrl && !pdfLoadError ? (
            <div className="pdf-viewer-shell">
              <Document
                file={document.signedUrl}
                loading={<p className="state-text">Loading PDF...</p>}
                onLoadSuccess={({ numPages }) => {
                  setPdfPageCount(numPages);
                  setPdfLoadError(false);
                }}
                onLoadError={() => {
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
            <div className="state-block">
              <p>No PDF available for preview.</p>
              {document.sourceDocumentUrl ? (
                <a href={document.sourceDocumentUrl} target="_blank" rel="noreferrer">
                  Open source URL
                </a>
              ) : null}
            </div>
          )}
        </article>

        <article className="compare-card">
          <h3>Parsed Output Workspace</h3>

          <div className="detail-tabs">
            <button
              type="button"
              className={activeTab === "parsed" ? "detail-tab active" : "detail-tab"}
              onClick={() => setActiveTab("parsed")}
            >
              Parsed Pages
            </button>
            <button
              type="button"
              className={activeTab === "chapters" ? "detail-tab active" : "detail-tab"}
              onClick={() => setActiveTab("chapters")}
            >
              Chapters
            </button>
            <button
              type="button"
              className={activeTab === "toc" ? "detail-tab active" : "detail-tab"}
              onClick={() => setActiveTab("toc")}
            >
              Table of Contents
            </button>
            <button
              type="button"
              className={activeTab === "metadata" ? "detail-tab active" : "detail-tab"}
              onClick={() => setActiveTab("metadata")}
            >
              Metadata
            </button>
          </div>

          {activeTab === "parsed" ? (
            <>
              {parsedPagesQuery.isLoading ? (
                <p className="state-text">Loading parsed pages...</p>
              ) : null}
              {parsedPagesQuery.isError ? (
                <p className="state-text error">Could not load parsed pages.</p>
              ) : null}
              {!parsedPagesQuery.isLoading && parsedPages.length === 0 ? (
                <p className="state-text">No parsed pages found yet.</p>
              ) : null}

              {parsedPages.length > 0 ? (
                <div className="parsed-scroll-panel" ref={parsedScrollRef} onScroll={handleParsedScroll}>
                  {parsedPages.map((page) => (
                    <div
                      key={page.id}
                      ref={(node) => registerParsedPageNode(page.pageNumber, node)}
                      className={`parsed-page-card ${currentPage === page.pageNumber ? "active" : ""}`}
                    >
                      <div className="parsed-page-header">
                        <strong>Page {page.pageNumber}</strong>
                        <button type="button" onClick={() => handleGoToPage(page.pageNumber)}>
                          Sync
                        </button>
                      </div>
                      <pre className="parsed-page-content">{page.content}</pre>
                    </div>
                  ))}
                  {parsedPagesQuery.isFetchingNextPage ? (
                    <p className="state-text">Loading more pages...</p>
                  ) : null}
                </div>
              ) : null}

              <div className="section-focus">
                <h4>Section Context</h4>
                {activeSection ? (
                  <>
                    <p className="section-title">{activeSection.title}</p>
                    <p>{activeSection.summary}</p>
                  </>
                ) : (
                  <p>No section mapped for this page.</p>
                )}
              </div>
            </>
          ) : null}

          {activeTab === "chapters" ? (
            <div className="tab-panel-list">
              {chaptersQuery.isLoading ? <p className="state-text">Loading chapters...</p> : null}
              {chaptersQuery.isError ? (
                <p className="state-text error">Could not load chapters.</p>
              ) : null}
              {!chaptersQuery.isLoading && (chaptersQuery.data?.items.length ?? 0) === 0 ? (
                <p className="state-text">No chapters extracted for this document yet.</p>
              ) : null}
              {chaptersQuery.data?.items.map((chapter) => (
                <article key={chapter.id} className="tab-panel-item">
                  <div>
                    <h4>{chapter.title}</h4>
                    <p>{chapter.summary}</p>
                    <small>
                      Pages {chapter.startPage} - {chapter.endPage}
                    </small>
                  </div>
                  <button type="button" onClick={() => handleGoToPage(chapter.startPage)}>
                    Go to page
                  </button>
                </article>
              ))}
            </div>
          ) : null}

          {activeTab === "toc" ? (
            <div className="tab-panel-list">
              {tocMetadataQuery.isLoading ? (
                <p className="state-text">Loading table of contents...</p>
              ) : null}
              {tocMetadataQuery.isError ? (
                <p className="state-text error">Could not load table of contents.</p>
              ) : null}
              {!tocMetadataQuery.isLoading && !tocMetadataQuery.data?.toc ? (
                <p className="state-text">No table of contents data found.</p>
              ) : null}
              {tocMetadataQuery.data?.toc ? (
                <pre className="json-block">{formatJson(tocMetadataQuery.data.toc)}</pre>
              ) : null}
            </div>
          ) : null}

          {activeTab === "metadata" ? (
            <div className="tab-panel-list">
              {tocMetadataQuery.isLoading ? <p className="state-text">Loading metadata...</p> : null}

              {!tocMetadataQuery.isLoading && !extractedMetadata && !fileMetadata ? (
                <p className="state-text">No metadata extracted yet.</p>
              ) : null}

              {extractedMetadata ? (
                <article className="tab-panel-item stack">
                  <h4>Extracted Metadata</h4>
                  <pre className="json-block">{formatJson(extractedMetadata)}</pre>
                </article>
              ) : null}

              {fileMetadata ? (
                <article className="tab-panel-item stack">
                  <h4>File Metadata</h4>
                  <pre className="json-block">{formatJson(fileMetadata)}</pre>
                </article>
              ) : null}
            </div>
          ) : null}
        </article>
      </div>
    </section>
  );
}
