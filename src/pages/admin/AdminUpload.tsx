import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { 
  Upload, 
  FileText, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  Brain,
  Database,
  Eye
} from "lucide-react";
import ExtractionPreviewDialog from "@/components/admin/ExtractionPreviewDialog";

interface HSCodeEntry {
  code: string;
  code_clean: string;
  description: string;
  level: string;
}

interface TariffLine {
  national_code: string;
  hs_code_6: string;
  description: string;
  duty_rate: number;
  unit?: string;
}

interface ExtractionData {
  summary: string;
  key_points: string[];
  hs_codes: HSCodeEntry[];
  tariff_lines: TariffLine[];
  chapter_info?: { number: number; title: string };
  pdfId?: string;
  pdfTitle?: string;
  countryCode?: string;
}

interface UploadedFile {
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

export default function AdminUpload() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<UploadedFile | null>(null);
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
      countryCode: "MA",
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
      const pdfTitle = file.name.replace(".pdf", "").replace(/_/g, " ");
      const { data: pdfDoc, error: insertError } = await supabase
        .from("pdf_documents")
        .insert({
          title: pdfTitle,
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
      updateFileStatus(fileId, { 
        progress: 60, 
        status: "analyzing",
        pdfId: pdfDoc.id,
        filePath: filePath,
      });

      // 3. Call AI analysis edge function (preview mode by default) with retry
      let analysisData = null;
      let analysisError = null;
      const MAX_RETRIES = 2;
      
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const result = await supabase.functions.invoke(
            "analyze-pdf",
            {
              body: { 
                pdfId: pdfDoc.id,
                filePath: filePath,
                previewOnly: true
              },
            }
          );
          
          if (result.error) {
            // Check if it's a rate limit or network error
            const errorMsg = result.error?.message || "";
            if (errorMsg.includes("429") || errorMsg.includes("rate") || errorMsg.includes("network")) {
              if (attempt < MAX_RETRIES) {
                console.log(`Retry ${attempt + 1}/${MAX_RETRIES} after network/rate error...`);
                updateFileStatus(fileId, { progress: 70 + attempt * 10 });
                await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
                continue;
              }
            }
            analysisError = result.error;
          } else {
            analysisData = result.data;
          }
          break;
        } catch (err: any) {
          // Network connection lost or fetch error
          if (attempt < MAX_RETRIES) {
            console.log(`Network error, retry ${attempt + 1}/${MAX_RETRIES}...`);
            updateFileStatus(fileId, { progress: 70 + attempt * 10 });
            await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
            continue;
          }
          analysisError = err;
        }
      }

      if (analysisError || !analysisData) {
        console.warn("Analysis error (non-blocking):", analysisError);
        updateFileStatus(fileId, {
          status: "error",
          progress: 100,
          error: analysisError?.message || "Erreur réseau - réessayez",
        });
        toast({
          title: "Erreur d'analyse",
          description: "Connexion perdue ou service surchargé. Réessayez dans quelques instants.",
          variant: "destructive",
        });
      } else {
        // Show preview instead of auto-inserting
        const extractionData: ExtractionData = {
          summary: analysisData?.summary || "",
          key_points: analysisData?.key_points || [],
          hs_codes: analysisData?.hs_codes || [],
          tariff_lines: analysisData?.tariff_lines || [],
          chapter_info: analysisData?.chapter_info,
          pdfId: pdfDoc.id,
          pdfTitle: pdfTitle,
          countryCode: "MA",
        };

        updateFileStatus(fileId, {
          status: "preview",
          progress: 100,
          pdfId: pdfDoc.id,
          analysis: extractionData,
        });
        
        const hsCount = extractionData.hs_codes?.length || 0;
        const tariffCount = extractionData.tariff_lines?.length || 0;
        
        toast({
          title: "📋 Analyse terminée - Prévisualisation",
          description: `${hsCount} codes SH et ${tariffCount} lignes tarifaires détectés. Cliquez sur "Prévisualiser" pour valider.`,
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

  const openPreview = (file: UploadedFile) => {
    setSelectedFile(file);
    setPreviewDialogOpen(true);
  };

  const handleInsertComplete = () => {
    if (selectedFile) {
      updateFileStatus(selectedFile.id, { status: "success" });
      toast({
        title: "✅ Données insérées",
        description: "Les codes ont été enregistrés en base de données",
      });
    }
    setSelectedFile(null);
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
      case "preview":
        return <Eye className="h-5 w-5 text-accent" />;
      case "success":
        return <CheckCircle2 className="h-5 w-5 text-success" />;
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
      case "preview":
        return "À valider";
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
          Déposez vos PDFs — L'IA analyse et vous permet de valider avant insertion
        </p>
      </div>

      {/* Process explanation */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
        <Card className="bg-accent/5 border-accent/20">
          <CardContent className="pt-6 text-center">
            <Eye className="h-8 w-8 mx-auto mb-2 text-accent" />
            <p className="font-medium">3. Prévisualisation</p>
            <p className="text-sm text-muted-foreground">Correction manuelle</p>
          </CardContent>
        </Card>
        <Card className="bg-success/5 border-success/20">
          <CardContent className="pt-6 text-center">
            <Database className="h-8 w-8 mx-auto mb-2 text-success" />
            <p className="font-medium">4. Insertion</p>
            <p className="text-sm text-muted-foreground">Données validées</p>
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
                          <FileText className="h-8 w-8 text-destructive shrink-0" />
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
                                : file.status === "preview"
                                ? "secondary"
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

                      {file.status === "preview" && file.analysis && (
                        <div className="pt-2 border-t space-y-3">
                          <p className="text-sm line-clamp-2">
                            <strong>Résumé:</strong> {file.analysis.summary}
                          </p>
                          <div className="flex items-center justify-between">
                            <div className="flex gap-2">
                              <Badge variant="outline" className="text-xs">
                                {file.analysis.hs_codes?.length || 0} codes SH
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                {file.analysis.tariff_lines?.length || 0} lignes tarifaires
                              </Badge>
                            </div>
                            <Button 
                              size="sm" 
                              onClick={() => openPreview(file)}
                              className="gap-2"
                            >
                              <Eye className="h-4 w-4" />
                              Prévisualiser
                            </Button>
                          </div>
                        </div>
                      )}

                      {file.status === "success" && file.analysis && (
                        <div className="pt-2 border-t">
                          <p className="text-xs text-success flex items-center gap-1">
                            <CheckCircle2 className="h-4 w-4" />
                            {file.analysis.hs_codes?.length || 0} codes SH et {file.analysis.tariff_lines?.length || 0} lignes tarifaires insérés
                          </p>
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

      {/* Preview Dialog */}
      {selectedFile && selectedFile.analysis && (
        <ExtractionPreviewDialog
          open={previewDialogOpen}
          onOpenChange={setPreviewDialogOpen}
          extractionData={selectedFile.analysis}
          pdfId={selectedFile.pdfId || ""}
          pdfTitle={selectedFile.name}
          countryCode={selectedFile.countryCode || "MA"}
          onInsertComplete={handleInsertComplete}
        />
      )}
    </div>
  );
}
