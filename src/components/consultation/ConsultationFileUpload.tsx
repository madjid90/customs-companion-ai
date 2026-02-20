import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip, X, FileText, Loader2 } from "lucide-react";

export interface ConsultationFile {
  file: File;
  preview: string;
  type: "image" | "pdf" | "other";
  base64?: string;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface ConsultationFileUploadProps {
  files: ConsultationFile[];
  onFilesChange: (files: ConsultationFile[]) => void;
  disabled?: boolean;
}

export function ConsultationFileUpload({ files, onFilesChange, disabled }: ConsultationFileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [converting, setConverting] = useState(false);

  const handleSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) return;

    setConverting(true);
    const newFiles: ConsultationFile[] = [];

    for (const file of selected) {
      const type = file.type.startsWith("image/") ? "image" as const
        : file.type === "application/pdf" ? "pdf" as const
        : "other" as const;

      let base64: string | undefined;
      if (type === "image" || type === "pdf") {
        try {
          base64 = await fileToBase64(file);
        } catch (err) {
          console.error("Failed to convert:", file.name, err);
        }
      }

      newFiles.push({
        file,
        preview: type === "image" ? URL.createObjectURL(file) : "",
        type,
        base64,
      });
    }

    onFilesChange([...files, ...newFiles]);
    setConverting(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div
              key={i}
              className="relative group flex items-center gap-2 bg-muted/50 rounded-lg p-2 pr-8 border border-border"
            >
              {f.type === "image" ? (
                <img src={f.preview} alt="" className="w-10 h-10 object-cover rounded" />
              ) : (
                <div className="w-10 h-10 flex items-center justify-center bg-background rounded">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium truncate max-w-[120px]">{f.file.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {(f.file.size / 1024).toFixed(0)} KB
                  {f.base64 ? " • Prêt" : " • Non analysable"}
                </p>
              </div>
              <button
                onClick={() => removeFile(i)}
                className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || converting}
        className="gap-2"
      >
        {converting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Paperclip className="h-4 w-4" />
        )}
        {converting ? "Préparation..." : "Joindre des documents"}
      </Button>

      <p className="text-[10px] text-muted-foreground">
        PDF, images, factures, fiches techniques — l'IA les utilise pour améliorer le rapport
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
        multiple
        className="hidden"
        onChange={handleSelect}
      />
    </div>
  );
}
