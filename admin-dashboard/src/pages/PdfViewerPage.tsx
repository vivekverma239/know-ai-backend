import { useQuery } from "@tanstack/react-query";
import { Document, Page } from "react-pdf";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getAdminDocumentDetail } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function PdfViewerPage() {
  const { id } = useParams<{ id: string }>();
  const accessToken = useAuthStore((state) => state.accessToken);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [pdfLoadError, setPdfLoadError] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [renderedPages, setRenderedPages] = useState(8);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pdfPageNodesRef = useRef<Map<number, HTMLDivElement>>(new Map());

  const detailQuery = useQuery({
    queryKey: ["admin-document-detail", accessToken, id],
    queryFn: () => getAdminDocumentDetail(accessToken ?? "", id ?? ""),
    enabled: Boolean(accessToken && id),
    staleTime: 30 * 60 * 1000,
    refetchOnMount: false,
  });
  const pdfDocumentOptions = useMemo(() => ({ withCredentials: false }), []);

  const totalPages = pdfPageCount ?? detailQuery.data?.numPages ?? 1;
  const visiblePages = useMemo(
    () => Math.min(totalPages, Math.max(1, renderedPages)),
    [renderedPages, totalPages],
  );

  const registerPdfPageNode = useCallback((pageNumber: number, node: HTMLDivElement | null) => {
    if (node) {
      pdfPageNodesRef.current.set(pageNumber, node);
      return;
    }
    pdfPageNodesRef.current.delete(pageNumber);
  }, []);

  const ensurePageRendered = useCallback(
    (pageNumber: number) => {
      const target = clamp(pageNumber + 2, 1, totalPages);
      setRenderedPages((prev) => Math.max(prev, target));
    },
    [totalPages],
  );

  const scrollToPdfPage = useCallback((pageNumber: number) => {
    const node = pdfPageNodesRef.current.get(pageNumber);
    if (!node) return;
    node.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const handleGoToPage = (page: number) => {
    const next = clamp(page, 1, totalPages);
    setCurrentPage(next);
    setPageInput(String(next));
    ensurePageRendered(next);
    requestAnimationFrame(() => {
      scrollToPdfPage(next);
    });
  };

  const handlePdfScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 320) {
      setRenderedPages((prev) => Math.min(totalPages, prev + 6));
    }

    let nearestPage = currentPage;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const [pageNumber, node] of pdfPageNodesRef.current.entries()) {
      const distance = Math.abs(node.offsetTop - container.scrollTop);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPage = pageNumber;
      }
    }

    if (nearestPage !== currentPage) {
      setCurrentPage(nearestPage);
    }
  }, [currentPage, totalPages]);

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

  if (document.type !== "pdf" || !document.signedUrl) {
    return (
      <section className="space-y-4">
        <div className="flex items-center gap-4">
          <Link to={`/dashboard/documents/${id}`}>
            <Button variant="outline" size="sm">Back to document</Button>
          </Link>
          <h2 className="text-lg font-semibold">PDF Viewer</h2>
        </div>
        <div className="border border-dashed border-border rounded-xl bg-muted p-8 text-center">
          <p className="text-muted-foreground">No PDF available for preview.</p>
          {document.sourceDocumentUrl ? (
            <a href={document.sourceDocumentUrl} target="_blank" rel="noreferrer" className="text-primary underline">
              Open source URL
            </a>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Link to={`/dashboard/documents/${id}`}>
          <Button variant="outline" size="sm">Back to document</Button>
        </Link>

        <div className="flex-1" />

        <Button
          variant="outline"
          size="sm"
          disabled={currentPage <= 1}
          onClick={() => handleGoToPage(currentPage - 1)}
        >
          Prev
        </Button>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            Page {currentPage} / {totalPages}
          </span>
          <Input
            type="number"
            min={1}
            max={totalPages}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            className="w-20"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const parsed = Number.parseInt(pageInput, 10);
              if (Number.isFinite(parsed)) handleGoToPage(parsed);
            }}
          >
            Go
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={currentPage >= totalPages}
          onClick={() => handleGoToPage(currentPage + 1)}
        >
          Next
        </Button>

        <div className="flex items-center gap-1 border-l border-border pl-3">
          <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
            -
          </Button>
          <span className="text-sm text-muted-foreground w-12 text-center">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
            +
          </Button>
        </div>
      </div>

      {/* PDF Display */}
      <div
        className="overflow-auto border border-border rounded-xl bg-popover p-4 min-h-[600px] max-h-[80vh]"
        ref={scrollContainerRef}
        onScroll={handlePdfScroll}
      >
        {!pdfLoadError ? (
          <Document
            key={document.signedUrl}
            file={document.signedUrl}
            options={pdfDocumentOptions}
            loading={<p className="text-muted-foreground">Loading PDF...</p>}
            onLoadSuccess={({ numPages }) => {
              setPdfPageCount(numPages);
              setPdfLoadError(false);
              setRenderedPages(Math.min(8, Math.max(1, numPages)));
            }}
            onLoadError={() => {
              setPdfPageCount(null);
              setPdfLoadError(true);
            }}
          >
            <div className="space-y-4">
              {Array.from({ length: visiblePages }, (_, index) => index + 1).map((pageNumber) => (
                <div
                  key={pageNumber}
                  ref={(node) => registerPdfPageNode(pageNumber, node)}
                  className={`rounded-md border p-2 ${
                    pageNumber === currentPage ? "border-primary" : "border-border"
                  }`}
                >
                  <Page
                    pageNumber={pageNumber}
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                    width={700 * zoom}
                  />
                </div>
              ))}
              {visiblePages < totalPages ? (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRenderedPages((prev) => Math.min(totalPages, prev + 6))}
                  >
                    Load More Pages
                  </Button>
                </div>
              ) : null}
            </div>
          </Document>
        ) : (
          <div className="w-full h-full min-h-[600px] space-y-2">
            <p className="text-sm text-muted-foreground">
              PDF.js preview failed (likely CORS). Showing browser PDF fallback.
            </p>
            <iframe
              src={document.signedUrl}
              title={`PDF preview for ${document.name}`}
              className="w-full h-[760px] rounded-lg border border-border bg-muted/30"
            />
          </div>
        )}
      </div>
    </section>
  );
}
