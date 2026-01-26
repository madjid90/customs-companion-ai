import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Upload, 
  FileText, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  Sparkles,
  Database,
  Brain
} from "lucide-react";

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  status: "uploading" | "analyzing" | "success" | "error";
  progress: number;
  error?: string;
  analysis?: {
    summary: string;
    key_points: string[];
    hs_codes: Array<string | { code: string; code_clean: string; description: string; level: string }>;
    tariff_lines?: any[];
  };
}

export default function AdminUpload() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const { toast } = useToast();

  const updateFileStatus = (id: string, updates: Partial<UploadedFile>) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
    );
  };

  const detectDocumentType = (fileName: string): { category: string; label: string } => {
    const name = fileName.toLowerCase();
    
    if (name.includes("tarif") || name.includes("ddi") || name.includes("chapitre")) {
      return { category: "tarif", label: "Tarif douanier" };
    }
    if (name.includes("circulaire") || name.includes("circ")) {
      return { category: "circulaire", label: "Circulaire" };
    }
    if (name.includes("note") || name.includes("technique")) {
      return { category: "note", label: "Note technique" };
    }
    if (name.includes("avis") || name.includes("classement")) {
      return { category: "avis", label: "Avis de classement" };
    }
    if (name.includes("accord") || name.includes("convention")) {
      return { category: "accord", label: "Accord commercial" };
    }
    if (name.includes("reglement") || name.includes("loi") || name.includes("decret")) {
      return { category: "reglementation", label: "Réglementation" };
    }
    
    return { category: "autre", label: "Document douanier" };
  };

  const uploadAndAnalyze = async (file: File) => {
    const fileId = crypto.randomUUID();
    const docType = detectDocumentType(file.name);
    
    const uploadedFile: UploadedFile = {
      id: fileId,
      name: file.name,
      size: file.size,
      status: "uploading",
      progress: 0,
    };

    setFiles((prev) => [uploadedFile, ...prev]);

    try {
      // 1. Upload to Supabase Storage
      const filePath = `uploads/${Date.now()}_${file.name}`;
      updateFileStatus(fileId, { progress: 20 });

      const { error: uploadError } = await supabase.storage
        .from("pdf-documents")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;
      updateFileStatus(fileId, { progress: 40 });

      // 2. Create PDF document record with auto-detected category
      const { data: pdfDoc, error: insertError } = await supabase
        .from("pdf_documents")
        .insert({
          title: file.name.replace(".pdf", "").replace(/_/g, " "),
          file_name: file.name,
          file_path: filePath,
          file_size_bytes: file.size,
          category: docType.category,
          country_code: "MA",
          mime_type: "application/pdf",
          is_active: true,
          is_verified: false,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;
      updateFileStatus(fileId, { progress: 60, status: "analyzing" });

      // 3. Call AI analysis edge function
      const { data: analysisData, error: analysisError } = await supabase.functions.invoke(
        "analyze-pdf",
        {
          body: { 
            pdfId: pdfDoc.id,
            filePath: filePath 
          },
        }
      );

      if (analysisError) {
        console.warn("Analysis error (non-blocking):", analysisError);
        updateFileStatus(fileId, {
          status: "success",
          progress: 100,
          analysis: undefined,
        });
        toast({
          title: "Document uploadé",
          description: `${file.name} stocké (analyse IA en attente)`,
        });
      } else {
        // Store extracted tariff lines if available
        if (analysisData?.tariff_lines?.length > 0) {
          console.log(`Extracted ${analysisData.tariff_lines.length} tariff lines`);
        }

        updateFileStatus(fileId, {
          status: "success",
          progress: 100,
          analysis: analysisData,
        });
        
        const hsCount = analysisData?.hs_codes?.length || 0;
        const tariffCount = analysisData?.tariff_lines?.length || 0;
        
        toast({
          title: "✅ Document analysé avec succès",
          description: `${hsCount} codes SH et ${tariffCount} lignes tarifaires extraits`,
        });
      }
    } catch (error: any) {
      console.error("Upload error:", error);
      updateFileStatus(fileId, {
        status: "error",
        error: error.message || "Erreur lors de l'upload",
      });
      toast({
        title: "Erreur",
        description: error.message || "Impossible d'uploader le fichier",
        variant: "destructive",
      });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    Array.from(selectedFiles).forEach((file) => {
      if (file.type === "application/pdf") {
        uploadAndAnalyze(file);
      } else {
        toast({
          title: "Format non supporté",
          description: `${file.name} n'est pas un fichier PDF`,
          variant: "destructive",
        });
      }
    });
    
    e.target.value = "";
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const droppedFiles = e.dataTransfer.files;
      Array.from(droppedFiles).forEach((file) => {
        if (file.type === "application/pdf") {
          uploadAndAnalyze(file);
        } else {
          toast({
            title: "Format non supporté",
            description: `${file.name} n'est pas un fichier PDF`,
            variant: "destructive",
          });
        }
      });
    },
    []
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getStatusIcon = (status: UploadedFile["status"]) => {
    switch (status) {
      case "uploading":
        return <Loader2 className="h-5 w-5 animate-spin text-accent" />;
      case "analyzing":
        return <Brain className="h-5 w-5 animate-pulse text-warning" />;
      case "success":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case "error":
        return <XCircle className="h-5 w-5 text-destructive" />;
    }
  };

  const getStatusLabel = (status: UploadedFile["status"]) => {
    switch (status) {
      case "uploading":
        return "Upload...";
      case "analyzing":
        return "Analyse IA...";
      case "success":
        return "Terminé";
      case "error":
        return "Erreur";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="text-3xl font-bold text-foreground">Upload intelligent</h1>
        <p className="text-muted-foreground mt-1">
          Déposez vos PDFs — L'IA analyse et stocke automatiquement les données
        </p>
      </div>

      {/* Process explanation */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-accent/5 border-accent/20">
          <CardContent className="pt-6 text-center">
            <Upload className="h-8 w-8 mx-auto mb-2 text-accent" />
            <p className="font-medium">1. Upload</p>
            <p className="text-sm text-muted-foreground">Glissez vos PDFs</p>
          </CardContent>
        </Card>
        <Card className="bg-warning/5 border-warning/20">
          <CardContent className="pt-6 text-center">
            <Brain className="h-8 w-8 mx-auto mb-2 text-warning" />
            <p className="font-medium">2. Analyse IA</p>
            <p className="text-sm text-muted-foreground">Extraction automatique</p>
          </CardContent>
        </Card>
        <Card className="bg-green-500/5 border-green-500/20">
          <CardContent className="pt-6 text-center">
            <Database className="h-8 w-8 mx-auto mb-2 text-green-500" />
            <p className="font-medium">3. Stockage</p>
            <p className="text-sm text-muted-foreground">Données en base</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Drop Zone */}
        <Card className="animate-slide-up">
          <CardHeader>
            <CardTitle>Déposer des documents</CardTitle>
            <CardDescription>
              PDFs de tarifs, circulaires, notes, avis de classement...
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`
                relative border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer
                ${isDragging
                  ? "border-accent bg-accent/10 scale-[1.02]"
                  : "border-border hover:border-accent/50 hover:bg-accent/5"
                }
              `}
            >
              <input
                type="file"
                accept=".pdf"
                multiple
                onChange={handleFileSelect}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <Upload className={`h-16 w-16 mx-auto mb-4 transition-colors ${isDragging ? "text-accent" : "text-muted-foreground"}`} />
              <p className="text-xl font-medium mb-2">
                Glissez vos PDFs ici
              </p>
              <p className="text-muted-foreground">
                ou cliquez pour sélectionner
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Badge variant="outline">Tarifs douaniers</Badge>
                <Badge variant="outline">Circulaires</Badge>
                <Badge variant="outline">Notes techniques</Badge>
                <Badge variant="outline">Avis de classement</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Upload Queue */}
        <Card className="animate-slide-up" style={{ animationDelay: "0.1s" }}>
          <CardHeader>
            <CardTitle>Résultats</CardTitle>
            <CardDescription>
              {files.length === 0
                ? "En attente de fichiers..."
                : `${files.filter((f) => f.status === "success").length}/${files.length} traités`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {files.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <FileText className="h-16 w-16 mb-4 opacity-30" />
                <p className="text-lg">Aucun document</p>
                <p className="text-sm">Uploadez des PDFs pour commencer</p>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-4">
                  {files.map((file) => (
                    <div
                      key={file.id}
                      className="p-4 border rounded-lg space-y-3 bg-card"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <FileText className="h-8 w-8 text-red-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium truncate max-w-[180px]">
                              {file.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatFileSize(file.size)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(file.status)}
                          <Badge
                            variant={
                              file.status === "success"
                                ? "default"
                                : file.status === "error"
                                ? "destructive"
                                : "secondary"
                            }
                            className="shrink-0"
                          >
                            {getStatusLabel(file.status)}
                          </Badge>
                        </div>
                      </div>

                      {(file.status === "uploading" || file.status === "analyzing") && (
                        <Progress value={file.progress} className="h-2" />
                      )}

                      {file.error && (
                        <p className="text-sm text-destructive">{file.error}</p>
                      )}

                      {file.analysis && (
                        <div className="pt-2 border-t space-y-2">
                          <p className="text-sm line-clamp-2">
                            <strong>Résumé:</strong> {file.analysis.summary}
                          </p>
                          {file.analysis.hs_codes?.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">
                                Codes SH extraits:
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {file.analysis.hs_codes.slice(0, 8).map((hsCode, i) => (
                                  <Badge key={i} variant="outline" className="text-xs font-mono">
                                    {typeof hsCode === 'string' ? hsCode : hsCode.code || hsCode.code_clean}
                                  </Badge>
                                ))}
                                {file.analysis.hs_codes.length > 8 && (
                                  <Badge variant="secondary" className="text-xs">
                                    +{file.analysis.hs_codes.length - 8}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          )}
                          {file.analysis.tariff_lines && file.analysis.tariff_lines.length > 0 && (
                            <p className="text-xs text-green-600">
                              ✓ {file.analysis.tariff_lines.length} lignes tarifaires stockées
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
