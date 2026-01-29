import { useRef, useState } from "react";
import { ImagePlus, FileText, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface UploadedFile {
  file: File;
  preview: string;
  type: "image" | "document";
}

interface ImageUploadButtonProps {
  onFilesSelected: (files: UploadedFile[]) => void;
  uploadedFiles: UploadedFile[];
  onRemoveFile: (index: number) => void;
  disabled?: boolean;
  isUploading?: boolean;
}

export function ImageUploadButton({
  onFilesSelected,
  uploadedFiles,
  onRemoveFile,
  disabled,
  isUploading,
}: ImageUploadButtonProps) {
  const [open, setOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const processed: UploadedFile[] = files.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      type: "image" as const,
    }));
    onFilesSelected(processed);
    setOpen(false);
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const handleDocSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const processed: UploadedFile[] = files.map((file) => ({
      file,
      preview: file.name,
      type: "document" as const,
    }));
    onFilesSelected(processed);
    setOpen(false);
    if (docInputRef.current) docInputRef.current.value = "";
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Uploaded files preview */}
      {uploadedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 p-2 bg-muted/50 rounded-lg">
          {uploadedFiles.map((upload, index) => (
            <div
              key={index}
              className="relative group flex items-center gap-2 bg-background rounded-md p-2 pr-8 border"
            >
              {upload.type === "image" ? (
                <img
                  src={upload.preview}
                  alt="Preview"
                  className="w-12 h-12 object-cover rounded"
                />
              ) : (
                <div className="w-12 h-12 flex items-center justify-center bg-muted rounded">
                  <FileText className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              <span className="text-xs text-muted-foreground max-w-[100px] truncate">
                {upload.file.name}
              </span>
              <button
                onClick={() => onRemoveFile(index)}
                className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                disabled={disabled || isUploading}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upload button */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className={cn(
              "h-11 w-11 rounded-xl border-border/50 bg-background hover:bg-accent/10 hover:border-accent/50 transition-all duration-200 shadow-sm hover:shadow-md",
              uploadedFiles.length > 0 && "border-accent/50 bg-accent/5 text-accent"
            )}
            disabled={disabled || isUploading}
          >
            {isUploading ? (
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
            ) : (
              <ImagePlus className="h-5 w-5 text-muted-foreground group-hover:text-accent transition-colors" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3 rounded-xl shadow-lg border-border/50" align="start" side="top">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 px-1">
            Ajouter un fichier
          </p>
          <div className="flex flex-col gap-1">
            <Button
              variant="ghost"
              className="justify-start gap-3 h-11 rounded-lg hover:bg-accent/10 hover:text-accent transition-colors"
              onClick={() => imageInputRef.current?.click()}
            >
              <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                <ImagePlus className="h-4 w-4 text-accent" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium">Photo du produit</p>
                <p className="text-xs text-muted-foreground">JPG, PNG, WEBP</p>
              </div>
            </Button>
            <Button
              variant="ghost"
              className="justify-start gap-3 h-11 rounded-lg hover:bg-accent/10 hover:text-accent transition-colors"
              onClick={() => docInputRef.current?.click()}
            >
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <FileText className="h-4 w-4 text-primary" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium">Document</p>
                <p className="text-xs text-muted-foreground">PDF, Facture, Fiche technique</p>
              </div>
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Hidden inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleImageSelect}
      />
      <input
        ref={docInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
        multiple
        className="hidden"
        onChange={handleDocSelect}
      />
    </div>
  );
}

export type { UploadedFile };
