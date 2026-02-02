import { createContext, useContext, useState, useCallback, useRef, ReactNode, useEffect } from "react";

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

export interface ExtractedNote {
  note_type: string;
  anchor?: string;
  note_text: string;
  page_number?: number;
}

export interface ExtractionData {
  summary: string;
  key_points: string[];
  hs_codes: HSCodeEntry[];
  hs_codes_full?: HSCodeEntry[]; // Full HS codes with descriptions from Claude
  tariff_lines: TariffLine[];
  notes?: ExtractedNote[]; // Notes extraites (définitions, notes de chapitre, etc.)
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

export type DocumentType = "tarif" | "accord" | "reglementation" | "circulaire";

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
  documentType?: DocumentType;
  analysis?: ExtractionData;
}

interface QueuedFile {
  file: File;
  fileId: string;
}

// Clé de stockage localStorage
const STORAGE_KEY = "admin_upload_state";

// Fonction pour sérialiser l'état (sans les données d'analyse volumineuses)
function serializeForStorage(files: UploadedFile[]): string {
  const lightFiles = files.map(f => ({
    ...f,
    // Ne pas persister les données d'analyse volumineuses
    analysis: f.analysis ? {
      summary: f.analysis.summary,
      pdfId: f.analysis.pdfId,
      pdfTitle: f.analysis.pdfTitle,
      document_type: f.analysis.document_type,
      // Compteurs seulement
      hs_codes_count: f.analysis.hs_codes?.length || 0,
      tariff_lines_count: f.analysis.tariff_lines?.length || 0,
      notes_count: f.analysis.notes?.length || 0,
    } : undefined,
  }));
  return JSON.stringify(lightFiles);
}

// Fonction pour désérialiser l'état
function deserializeFromStorage(data: string): UploadedFile[] {
  try {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    
    return parsed.map((f: any) => ({
      ...f,
      // Marquer les uploads interrompus comme "error" avec possibilité de reprendre
      status: f.status === "uploading" || f.status === "analyzing" || f.status === "queued"
        ? "error" as const
        : f.status,
      error: f.status === "uploading" || f.status === "analyzing" || f.status === "queued"
        ? "Upload interrompu - rechargez le fichier"
        : f.error,
      // Reconstituer un objet analysis minimal si présent
      analysis: f.analysis ? {
        summary: f.analysis.summary || "",
        key_points: [],
        hs_codes: [],
        tariff_lines: [],
        pdfId: f.analysis.pdfId,
        pdfTitle: f.analysis.pdfTitle,
        document_type: f.analysis.document_type,
      } : undefined,
    }));
  } catch {
    return [];
  }
}

interface UploadStateContextType {
  files: UploadedFile[];
  setFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
  updateFileStatus: (id: string, updates: Partial<UploadedFile>) => void;
  addFile: (file: UploadedFile) => void;
  clearCompleted: () => void;
  clearAll: () => void;
  removeFile: (id: string) => void;
  pendingCount: number;
  queueFile: (file: File, uploadedFile: UploadedFile) => void;
  processNext: () => QueuedFile | null;
  isProcessing: boolean;
  setIsProcessing: (value: boolean) => void;
}

const UploadStateContext = createContext<UploadStateContextType | undefined>(undefined);

export function UploadStateProvider({ children }: { children: ReactNode }) {
  // Initialiser depuis localStorage
  const [files, setFilesInternal] = useState<UploadedFile[]>(() => {
    if (typeof window === "undefined") return [];
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const restored = deserializeFromStorage(stored);
      console.log("[UploadState] Restored", restored.length, "files from storage");
      return restored;
    }
    return [];
  });
  
  const [isProcessing, setIsProcessing] = useState(false);
  const queueRef = useRef<QueuedFile[]>([]);

  // Persister dans localStorage à chaque changement
  useEffect(() => {
    if (typeof window === "undefined") return;
    const serialized = serializeForStorage(files);
    localStorage.setItem(STORAGE_KEY, serialized);
  }, [files]);

  // Wrapper setFiles pour mise à jour
  const setFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>> = useCallback((action) => {
    setFilesInternal(action);
  }, []);

  const updateFileStatus = useCallback((id: string, updates: Partial<UploadedFile>) => {
    setFilesInternal((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
    );
  }, []);

  const addFile = useCallback((file: UploadedFile) => {
    setFilesInternal((prev) => [file, ...prev]);
  }, []);

  const clearCompleted = useCallback(() => {
    setFilesInternal((prev) => prev.filter((f) => f.status !== "success"));
  }, []);

  const clearAll = useCallback(() => {
    setFilesInternal([]);
    queueRef.current = [];
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const removeFile = useCallback((id: string) => {
    setFilesInternal((prev) => prev.filter((f) => f.id !== id));
    queueRef.current = queueRef.current.filter((q) => q.fileId !== id);
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
        clearAll,
        removeFile,
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
