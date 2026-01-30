import { useState } from "react";
import { Dialog, DialogContent, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Loader2, AlertCircle } from "lucide-react";

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
      } catch (error) {
        // Fallback: open in new tab if download fails
        window.open(url, '_blank');
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0" aria-describedby="document-preview-description">
        <DialogDescription id="document-preview-description" className="sr-only">
          Prévisualisation du document PDF
        </DialogDescription>
        <div className="px-4 py-3 border-b flex-shrink-0">
          <div className="flex items-center justify-end pr-8">
            {hasValidUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                className="gap-1.5"
              >
                <Download className="h-4 w-4" />
                Télécharger
              </Button>
            )}
          </div>
        </div>
        
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
