import { Send, Loader2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploadButton, type UploadedFile } from "./ImageUploadButton";

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
  return (
    <div className="border-t bg-card/80 backdrop-blur-sm p-3 md:p-4 chat-input-wrapper">
      <div className="max-w-3xl mx-auto">
        {/* Uploaded files preview */}
        {uploadedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3 p-2 bg-muted/30 rounded-xl border border-border/50">
            {uploadedFiles.map((upload, index) => (
              <div
                key={index}
                className="relative group flex items-center gap-2 bg-background rounded-lg p-2 pr-8 border border-border/50 shadow-sm"
              >
                {upload.type === "image" ? (
                  <img
                    src={upload.preview}
                    alt="Preview"
                    className="w-12 h-12 object-cover rounded-md"
                  />
                ) : (
                  <div className="w-12 h-12 flex items-center justify-center bg-muted rounded-md">
                    <FileText className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <span className="text-xs text-muted-foreground max-w-[100px] truncate">
                  {upload.file.name}
                </span>
                <button
                  onClick={() => onRemoveFile(index)}
                  className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
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
        <div className="flex items-end gap-2">
          <ImageUploadButton
            onFilesSelected={onFilesSelected}
            uploadedFiles={[]}
            onRemoveFile={onRemoveFile}
            disabled={isLoading}
            isUploading={isUploading}
          />
          <div className="relative flex-1">
            <Textarea
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={uploadedFiles.length > 0 
                ? "Décrivez votre produit ou posez une question..." 
                : "Posez votre question sur la douane..."}
              className="min-h-[52px] max-h-32 pr-14 resize-none rounded-xl border-border/50 focus:border-accent/50 bg-background shadow-sm transition-all"
              rows={1}
            />
            <Button
              onClick={onSend}
              disabled={(!input.trim() && uploadedFiles.length === 0) || isLoading || isUploading}
              size="icon"
              className="absolute right-2 bottom-2 h-9 w-9 rounded-lg bg-accent hover:bg-accent/90 shadow-md transition-all hover:scale-105 disabled:hover:scale-100"
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        
        {/* Footer hint */}
        <p className="text-xs text-muted-foreground text-center mt-3 opacity-70">
          Appuyez sur Entrée pour envoyer • Shift+Entrée pour un saut de ligne
        </p>
      </div>
    </div>
  );
}
