import { useState } from "react";
import { X, Download, ExternalLink, FileText, ZoomIn, ZoomOut } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FilePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: File | null;
  preview: string;
  type: "image" | "document";
}

export function FilePreviewDialog({
  open,
  onOpenChange,
  file,
  preview,
  type,
}: FilePreviewDialogProps) {
  const [zoom, setZoom] = useState(1);

  if (!file) return null;

  const handleDownload = () => {
    const url = type === "image" ? preview : URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (type !== "image") URL.revokeObjectURL(url);
  };

  const handleOpenExternal = () => {
    const url = type === "image" ? preview : URL.createObjectURL(file);
    window.open(url, "_blank");
  };

  const isPDF = file.type === "application/pdf";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2 border-b bg-card/80 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-base font-medium truncate pr-4">
              {type === "image" ? (
                <span className="text-2xl">🖼️</span>
              ) : (
                <FileText className="h-5 w-5 text-primary" />
              )}
              <span className="truncate">{file.name}</span>
              <span className="text-xs text-muted-foreground font-normal">
                ({(file.size / 1024).toFixed(1)} Ko)
              </span>
            </DialogTitle>
            <div className="flex items-center gap-1">
              {type === "image" && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
                    disabled={zoom <= 0.5}
                  >
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground w-12 text-center">
                    {Math.round(zoom * 100)}%
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setZoom(Math.min(3, zoom + 0.25))}
                    disabled={zoom >= 3}
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleDownload}
                title="Télécharger"
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleOpenExternal}
                title="Ouvrir dans un nouvel onglet"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto p-4 bg-muted/20 min-h-[400px] max-h-[calc(90vh-80px)]">
          {type === "image" ? (
            <div className="flex items-center justify-center h-full">
              <img
                src={preview}
                alt={file.name}
                className={cn(
                  "max-w-full max-h-full object-contain rounded-lg shadow-lg transition-transform duration-200",
                )}
                style={{ transform: `scale(${zoom})` }}
              />
            </div>
          ) : isPDF ? (
            <iframe
              src={URL.createObjectURL(file)}
              className="w-full h-full min-h-[500px] rounded-lg border bg-white"
              title={file.name}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className="w-24 h-24 rounded-2xl bg-primary/10 flex items-center justify-center">
                <FileText className="h-12 w-12 text-primary" />
              </div>
              <div>
                <p className="font-medium text-lg">{file.name}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {(file.size / 1024).toFixed(1)} Ko
                </p>
              </div>
              <div className="flex gap-2 mt-4">
                <Button onClick={handleDownload} variant="outline">
                  <Download className="h-4 w-4 mr-2" />
                  Télécharger
                </Button>
                <Button onClick={handleOpenExternal}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Ouvrir
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}