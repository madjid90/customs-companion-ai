import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react";

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

export interface TradeAgreement {
  code: string;
  name: string;
  type: string;
  countries: string[];
  mentioned_benefits?: string[];
}

export interface LegalReference {
  type: string;
  reference: string;
  title?: string;
  date?: string;
  context?: string;
}

export interface ImportantDate {
  date: string;
  type: string;
  description: string;
}

export interface IssuingAuthority {
  name: string;
  department?: string;
  signatory?: string;
}

export interface ExtractionData {
  summary: string;
  key_points: string[];
  hs_codes: HSCodeEntry[];
  hs_codes_full?: HSCodeEntry[]; // Full HS codes with descriptions from Claude
  tariff_lines: TariffLine[];
  chapter_info?: { number: number; title: string };
  pdfId?: string;
  pdfTitle?: string;
  countryCode?: string;
  document_type?: "tariff" | "regulatory";
  trade_agreements?: TradeAgreement[];
  full_text_length?: number;
  // Champs enrichis pour documents réglementaires
  document_reference?: string;
  publication_date?: string;
  effective_date?: string;
  expiry_date?: string;
  legal_references?: LegalReference[];
  important_dates?: ImportantDate[];
  issuing_authority?: IssuingAuthority;
  recipients?: string[];
  abrogates?: string[];
  modifies?: string[];
}

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  status: "queued" | "uploading" | "analyzing" | "preview" | "success" | "error";
  progress: number;
  error?: string;
  pdfId?: string;
  filePath?: string;
  countryCode?: string;
  analysis?: ExtractionData;
}

interface QueuedFile {
  file: File;
  fileId: string;
}

interface UploadStateContextType {
  files: UploadedFile[];
  setFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
  updateFileStatus: (id: string, updates: Partial<UploadedFile>) => void;
  addFile: (file: UploadedFile) => void;
  clearCompleted: () => void;
  pendingCount: number;
  queueFile: (file: File, uploadedFile: UploadedFile) => void;
  processNext: () => QueuedFile | null;
  isProcessing: boolean;
  setIsProcessing: (value: boolean) => void;
}

const UploadStateContext = createContext<UploadStateContextType | undefined>(undefined);

export function UploadStateProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const queueRef = useRef<QueuedFile[]>([]);

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

  const queueFile = useCallback((file: File, uploadedFile: UploadedFile) => {
    queueRef.current.push({ file, fileId: uploadedFile.id });
    addFile(uploadedFile);
  }, [addFile]);

  const processNext = useCallback((): QueuedFile | null => {
    if (queueRef.current.length === 0) {
      return null;
    }
    return queueRef.current.shift() || null;
  }, []);

  const pendingCount = files.filter(
    (f) => f.status === "preview" || f.status === "analyzing" || f.status === "uploading" || f.status === "queued"
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
        queueFile,
        processNext,
        isProcessing,
        setIsProcessing,
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
