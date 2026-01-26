import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export interface HSCodeEntry {
  code: string;
  code_clean: string;
  description: string;
  level: string;
}

export interface TariffLine {
  national_code: string;
  hs_code_6: string;
  description: string;
  duty_rate: number;
  unit?: string;
}

export interface ExtractionData {
  summary: string;
  key_points: string[];
  hs_codes: HSCodeEntry[];
  tariff_lines: TariffLine[];
  chapter_info?: { number: number; title: string };
  pdfId?: string;
  pdfTitle?: string;
  countryCode?: string;
}

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  status: "uploading" | "analyzing" | "preview" | "success" | "error";
  progress: number;
  error?: string;
  pdfId?: string;
  filePath?: string;
  countryCode?: string;
  analysis?: ExtractionData;
}

interface UploadStateContextType {
  files: UploadedFile[];
  setFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
  updateFileStatus: (id: string, updates: Partial<UploadedFile>) => void;
  addFile: (file: UploadedFile) => void;
  clearCompleted: () => void;
  pendingCount: number;
}

const UploadStateContext = createContext<UploadStateContextType | undefined>(undefined);

export function UploadStateProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<UploadedFile[]>([]);

  const updateFileStatus = useCallback((id: string, updates: Partial<UploadedFile>) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
    );
  }, []);

  const addFile = useCallback((file: UploadedFile) => {
    setFiles((prev) => [file, ...prev]);
  }, []);

  const clearCompleted = useCallback(() => {
    setFiles((prev) => prev.filter((f) => f.status !== "success"));
  }, []);

  const pendingCount = files.filter(
    (f) => f.status === "preview" || f.status === "analyzing" || f.status === "uploading"
  ).length;

  return (
    <UploadStateContext.Provider
      value={{
        files,
        setFiles,
        updateFileStatus,
        addFile,
        clearCompleted,
        pendingCount,
      }}
    >
      {children}
    </UploadStateContext.Provider>
  );
}

export function useUploadState() {
  const context = useContext(UploadStateContext);
  if (context === undefined) {
    throw new Error("useUploadState must be used within an UploadStateProvider");
  }
  return context;
}
