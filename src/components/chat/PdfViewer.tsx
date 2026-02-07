import { useState, useCallback, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { Loader2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface PdfViewerProps {
  url: string;
  pageNumber?: number;
  onError?: () => void;
}

export function PdfViewer({ url, pageNumber, onError }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(pageNumber || 1);
  const [scale, setScale] = useState<number>(1.0);
  const [loading, setLoading] = useState(true);

  // Sync currentPage when pageNumber prop changes (e.g., different article clicked)
  useEffect(() => {
    if (pageNumber && pageNumber > 0) {
      setCurrentPage(pageNumber);
    }
  }, [pageNumber]);

  const onDocumentLoadSuccess = useCallback(
    ({ numPages: total }: { numPages: number }) => {
      setNumPages(total);
      setLoading(false);
      if (pageNumber && pageNumber <= total) {
        setCurrentPage(pageNumber);
      }
    },
    [pageNumber]
  );

  const onDocumentLoadError = useCallback(() => {
    setLoading(false);
    onError?.();
  }, [onError]);

  const goToPrevPage = () => setCurrentPage((p) => Math.max(1, p - 1));
  const goToNextPage = () => setCurrentPage((p) => Math.min(numPages, p + 1));
  const zoomIn = () => setScale((s) => Math.min(2.5, s + 0.2));
  const zoomOut = () => setScale((s) => Math.max(0.5, s - 0.2));

  return (
    <div className="flex flex-col h-full">
      {/* Controls bar */}
      {!loading && numPages > 0 && (
        <div className="flex items-center justify-center gap-2 py-2 px-3 border-b bg-background/80 backdrop-blur-sm flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={goToPrevPage}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground min-w-[80px] text-center">
            {currentPage} / {numPages}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={goToNextPage}
            disabled={currentPage >= numPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="w-px h-5 bg-border mx-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={zoomOut}
            disabled={scale <= 0.5}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground w-12 text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={zoomIn}
            disabled={scale >= 2.5}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* PDF render area */}
      <div className="flex-1 overflow-auto flex justify-center min-h-0">
        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={
            <div className="flex flex-col items-center justify-center h-full gap-3 py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Chargement du document...
              </p>
            </div>
          }
        >
          <Page
            pageNumber={currentPage}
            scale={scale}
            loading={
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            }
          />
        </Document>
      </div>
    </div>
  );
}
