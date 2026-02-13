import { useState } from "react";
import { Send, Loader2, FileText, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploadButton, type UploadedFile } from "./ImageUploadButton";
import { FilePreviewDialog } from "./FilePreviewDialog";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  isLoading: boolean;
  isUploading: boolean;
  uploadedFiles: UploadedFile[];
  onFilesSelected: (files: UploadedFile[]) => void;
  onRemoveFile: (index: number) => void;
}

export function ChatInput({
  input,
  onInputChange,
  onSend,
  onKeyDown,
  isLoading,
  isUploading,
  uploadedFiles,
  onFilesSelected,
  onRemoveFile,
}: ChatInputProps) {
  const [previewFile, setPreviewFile] = useState<{
    file: File;
    preview: string;
    type: "image" | "document";
  } | null>(null);

  const handlePreviewClick = (upload: UploadedFile) => {
    setPreviewFile({
      file: upload.file,
      preview: upload.preview,
      type: upload.type,
    });
  };

  return (
    <>
      <div className="px-3 pt-2 pb-8 mb-4 md:mb-0 md:pb-4 md:border-t md:border-border md:bg-card/90 md:backdrop-blur-xl md:px-4 md:pt-4 flex-shrink-0 bg-transparent">
        <div className="max-w-3xl mx-auto">
          {/* Uploaded files preview - horizontal scroll on mobile */}
          {uploadedFiles.length > 0 && (
            <div className="flex gap-2 mb-2 md:mb-3 p-2 bg-muted/30 rounded-xl border border-border/50 overflow-x-auto scrollbar-hide">
              {uploadedFiles.map((upload, index) => (
                <div
                  key={index}
                  className={cn(
                    "relative group flex items-center gap-2 bg-background rounded-lg p-2 pr-8 border border-border/50 shadow-sm flex-shrink-0",
                    "cursor-pointer hover:border-primary/30 hover:bg-primary/5 transition-all duration-200"
                  )}
                  onClick={() => handlePreviewClick(upload)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handlePreviewClick(upload);
                    }
                  }}
                >
                  {upload.type === "image" ? (
                    <div className="relative flex-shrink-0">
                      <img
                        src={upload.preview}
                        alt="Preview"
                        className="w-10 h-10 object-cover rounded-md"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-md flex items-center justify-center">
                        <Eye className="h-4 w-4 text-white" />
                      </div>
                    </div>
                  ) : (
                    <div className="relative w-10 h-10 flex-shrink-0 flex items-center justify-center bg-primary/10 rounded-md group-hover:bg-primary/15 transition-colors">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>
                  )}
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-medium text-foreground max-w-[100px] truncate">
                      {upload.file.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {upload.type === "image" ? "Image" : "PDF"} • Voir
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveFile(index);
                    }}
                    className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:scale-110"
                    style={{ minHeight: 'auto' }}
                    disabled={isLoading || isUploading}
                  >
                    <span className="sr-only">Remove</span>
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          
          {/* Input row */}
          <div className="flex items-center gap-1.5 md:gap-2.5 md:bg-transparent rounded-2xl md:rounded-none px-3 py-1.5 md:px-3 md:py-1.5 md:border-0" style={{ background: 'linear-gradient(hsl(var(--background)), hsl(var(--background))) padding-box, var(--gradient-cta) border-box', border: '1.5px solid transparent', borderRadius: '1rem' }}>
            <ImageUploadButton
              onFilesSelected={onFilesSelected}
              uploadedFiles={[]}
              onRemoveFile={onRemoveFile}
              disabled={isLoading}
              isUploading={isUploading}
            />
            <div className="relative flex-1 min-w-0">
              <Textarea
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={uploadedFiles.length > 0 
                  ? "Décrivez votre produit..." 
                  : "Posez une question"}
                aria-label="Message à envoyer"
                className="min-h-[40px] md:min-h-[52px] max-h-28 md:max-h-32 pr-2 md:pr-4 resize-none rounded-xl md:rounded-2xl border-0 focus:ring-0 focus:outline-none bg-transparent text-base py-2.5 md:py-3.5 px-2 md:px-4"
                rows={1}
              />
            </div>
            <Button
              onClick={onSend}
              disabled={(!input.trim() && uploadedFiles.length === 0) || isLoading || isUploading}
              size="icon"
              aria-label="Envoyer le message"
              className="h-9 w-9 md:h-10 md:w-10 rounded-lg md:rounded-xl cta-gradient border-0 text-white disabled:opacity-50 flex-shrink-0"
              style={{ minHeight: 'auto' }}
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 md:h-4.5 md:w-4.5 animate-spin" />
              ) : (
                <Send className="h-4 w-4 md:h-4.5 md:w-4.5" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* File preview dialog */}
      <FilePreviewDialog
        open={!!previewFile}
        onOpenChange={(open) => !open && setPreviewFile(null)}
        file={previewFile?.file || null}
        preview={previewFile?.preview || ""}
        type={previewFile?.type || "document"}
      />
    </>
  );
}