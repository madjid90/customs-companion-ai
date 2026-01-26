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
            variant="ghost"
            size="icon"
            className={cn(
              "h-10 w-10",
              uploadedFiles.length > 0 && "text-accent"
            )}
            disabled={disabled || isUploading}
          >
            {isUploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ImagePlus className="h-5 w-5" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start" side="top">
          <div className="flex flex-col gap-1">
            <Button
              variant="ghost"
              className="justify-start gap-2"
              onClick={() => imageInputRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" />
              Photo du produit
            </Button>
            <Button
              variant="ghost"
              className="justify-start gap-2"
              onClick={() => docInputRef.current?.click()}
            >
              <FileText className="h-4 w-4" />
              Facture / Fiche technique
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
