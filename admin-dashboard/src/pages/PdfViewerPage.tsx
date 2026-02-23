import { useQuery } from "@tanstack/react-query";
import { Document, Page } from "react-pdf";
import { useState } from "react";
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

  const detailQuery = useQuery({
    queryKey: ["admin-document-detail", accessToken, id],
    queryFn: () => getAdminDocumentDetail(accessToken ?? "", id ?? ""),
    enabled: Boolean(accessToken && id),
  });

  const totalPages = pdfPageCount ?? detailQuery.data?.numPages ?? 1;

  const handleGoToPage = (page: number) => {
    const next = clamp(page, 1, totalPages);
    setCurrentPage(next);
    setPageInput(String(next));
  };

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

  if (document.type !== "pdf" || !document.signedUrl || pdfLoadError) {
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
      <div className="overflow-auto border border-border rounded-xl bg-popover grid place-items-center p-4 min-h-[600px]">
        <Document
          file={document.signedUrl}
          loading={<p className="text-muted-foreground">Loading PDF...</p>}
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
            width={700 * zoom}
          />
        </Document>
      </div>
    </section>
  );
}
