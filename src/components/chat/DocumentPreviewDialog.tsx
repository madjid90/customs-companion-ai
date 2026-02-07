import { useState } from "react";
import { Dialog, DialogContent, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, AlertCircle, ExternalLink, FileText, RefreshCw } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { PdfViewer } from "./PdfViewer";

interface DocumentPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  title?: string;
  pageNumber?: number;
}

export function DocumentPreviewDialog({ 
  open, 
  onOpenChange, 
  url, 
  title,
  pageNumber 
}: DocumentPreviewDialogProps) {
  const [hasError, setHasError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const isMobile = useIsMobile();

  const hasValidUrl = url && url.length > 0 && (url.startsWith('http://') || url.startsWith('https://'));

  const handleDownload = async () => {
    if (hasValidUrl) {
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = title || 'document.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);
      } catch {
        window.open(url, '_blank');
      }
    }
  };

  const handleOpenExternal = () => {
    if (hasValidUrl) {
      const pageParam = pageNumber ? `#page=${pageNumber}` : '';
      window.open(`${url}${pageParam}`, '_blank');
    }
  };

  const handleRetry = () => {
    setHasError(false);
    setRetryKey((k) => k + 1);
  };

  const content = (
    <>
      <div className="px-3 md:px-4 py-2 md:py-3 border-b flex-shrink-0 bg-background">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {pageNumber && (
              <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full whitespace-nowrap">
                Page {pageNumber}
              </span>
            )}
            <span className="text-sm font-medium truncate hidden sm:block">
              {title || 'Document'}
            </span>
          </div>
          <div className="flex items-center gap-1 pr-8 md:pr-10">
            {hasValidUrl && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOpenExternal}
                  className="gap-1.5 h-8 px-2"
                  title="Ouvrir dans un nouvel onglet"
                >
                  <ExternalLink className="h-4 w-4" />
                  <span className="hidden sm:inline">Ouvrir</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  className="gap-1.5 h-8 px-2"
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">Télécharger</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
      
      <div className="flex-1 relative bg-muted/30 min-h-0">
        {!hasValidUrl ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center p-6">
              <AlertCircle className="h-12 w-12 text-warning" />
              <h3 className="text-lg font-medium">Document non disponible</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Le document source n'a pas pu être trouvé dans la base de données. 
                Veuillez réessayer ou contacter l'administrateur.
              </p>
            </div>
          </div>
        ) : hasError ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4 text-center p-6 max-w-md">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-lg font-medium mb-2">Erreur de chargement</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Le document n'a pas pu être chargé. Utilisez les boutons ci-dessous pour y accéder.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <Button
                  variant="default"
                  onClick={handleOpenExternal}
                  className="gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Ouvrir dans un nouvel onglet
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDownload}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  Télécharger
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRetry}
                className="text-muted-foreground gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Réessayer
              </Button>
            </div>
          </div>
        ) : (
          <PdfViewer
            key={`${retryKey}-${url}-${pageNumber}`}
            url={url}
            pageNumber={pageNumber}
            onError={() => setHasError(true)}
          />
        )}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="h-[90vh] flex flex-col">
          <DrawerHeader className="sr-only">
            <DrawerTitle>{title || 'Document'}</DrawerTitle>
            <DrawerDescription>Prévisualisation du document PDF</DrawerDescription>
          </DrawerHeader>
          {content}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0" aria-describedby="document-preview-description">
        <DialogDescription id="document-preview-description" className="sr-only">
          Prévisualisation du document PDF
        </DialogDescription>
        {content}
      </DialogContent>
    </Dialog>
  );
}
