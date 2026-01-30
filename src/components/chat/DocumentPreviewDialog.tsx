import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink, Download, X, FileText, Loader2, AlertCircle } from "lucide-react";

interface DocumentPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  title?: string;
}

export function DocumentPreviewDialog({ 
  open, 
  onOpenChange, 
  url, 
  title 
}: DocumentPreviewDialogProps) {
  const [isLoading, setIsLoading] = useState(true);

  // Check if we have a valid URL
  const hasValidUrl = url && url.length > 0 && (url.startsWith('http://') || url.startsWith('https://'));

  // Use Google Docs Viewer for PDF preview
  const viewerUrl = hasValidUrl 
    ? `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`
    : '';

  const handleDownload = () => {
    if (hasValidUrl) {
      window.open(url, '_blank');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <DialogTitle className="text-base font-medium truncate max-w-[400px]">
                {title || "Document"}
              </DialogTitle>
            </div>
            <div className="flex items-center gap-2">
              {hasValidUrl && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownload}
                    className="gap-1.5"
                  >
                    <Download className="h-4 w-4" />
                    Télécharger
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(url, '_blank')}
                    className="gap-1.5"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Ouvrir
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                className="h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>
        
        <div className="flex-1 relative bg-muted/30">
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
          ) : (
            <>
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Chargement du document...</p>
                  </div>
                </div>
              )}
              <iframe
                src={viewerUrl}
                className="w-full h-full border-0"
                onLoad={() => setIsLoading(false)}
                title={title || "Document preview"}
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
