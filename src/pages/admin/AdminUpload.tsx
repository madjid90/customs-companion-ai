import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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
  AlertTriangle
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
    hs_codes: string[];
  };
}

interface PDFCategory {
  value: string;
  label: string;
}

const categories: PDFCategory[] = [
  { value: "tarif", label: "Tarif douanier" },
  { value: "circulaire", label: "Circulaire" },
  { value: "note", label: "Note technique" },
  { value: "avis", label: "Avis de classement" },
  { value: "accord", label: "Accord commercial" },
  { value: "reglementation", label: "Réglementation" },
  { value: "autre", label: "Autre" },
];

export default function AdminUpload() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("circulaire");
  const [countryCode, setCountryCode] = useState("MA");
  const [isDragging, setIsDragging] = useState(false);
  const { toast } = useToast();

  const updateFileStatus = (id: string, updates: Partial<UploadedFile>) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
    );
  };

  const uploadAndAnalyze = async (file: File) => {
    const fileId = crypto.randomUUID();
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

      // 2. Create PDF document record
      const { data: pdfDoc, error: insertError } = await supabase
        .from("pdf_documents")
        .insert({
          title: title || file.name.replace(".pdf", ""),
          file_name: file.name,
          file_path: filePath,
          file_size_bytes: file.size,
          category: category,
          country_code: countryCode,
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
        // Analysis failed but upload succeeded
        updateFileStatus(fileId, {
          status: "success",
          progress: 100,
          analysis: undefined,
        });
        toast({
          title: "Document uploadé",
          description: `${file.name} uploadé avec succès (analyse en attente)`,
        });
      } else {
        updateFileStatus(fileId, {
          status: "success",
          progress: 100,
          analysis: analysisData,
        });
        toast({
          title: "Document analysé",
          description: `${file.name} uploadé et analysé avec succès`,
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
    
    // Reset input
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
    [title, category, countryCode]
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
        return <Sparkles className="h-5 w-5 animate-pulse text-warning" />;
      case "success":
        return <CheckCircle2 className="h-5 w-5 text-success" />;
      case "error":
        return <XCircle className="h-5 w-5 text-destructive" />;
    }
  };

  const getStatusLabel = (status: UploadedFile["status"]) => {
    switch (status) {
      case "uploading":
        return "Upload en cours...";
      case "analyzing":
        return "Analyse IA en cours...";
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
        <h1 className="text-3xl font-bold text-foreground">Upload de documents</h1>
        <p className="text-muted-foreground mt-1">
          Uploadez des PDFs pour extraction automatique avec l'IA
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload Form */}
        <Card className="animate-slide-up">
          <CardHeader>
            <CardTitle>Nouveau document</CardTitle>
            <CardDescription>
              Configurez les métadonnées et uploadez votre PDF
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Titre du document (optionnel)</Label>
              <Input
                id="title"
                placeholder="Laisser vide pour utiliser le nom du fichier"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="category">Catégorie</Label>
                <select
                  id="category"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {categories.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="country">Pays</Label>
                <select
                  id="country"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                >
                  <option value="MA">🇲🇦 Maroc</option>
                  <option value="SN">🇸🇳 Sénégal</option>
                  <option value="CI">🇨🇮 Côte d'Ivoire</option>
                  <option value="CM">🇨🇲 Cameroun</option>
                  <option value="INT">🌍 International</option>
                </select>
              </div>
            </div>

            {/* Drop Zone */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`
                relative border-2 border-dashed rounded-xl p-8 text-center transition-all
                ${isDragging
                  ? "border-accent bg-accent/10"
                  : "border-border hover:border-accent/50"
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
              <Upload className={`h-12 w-12 mx-auto mb-4 ${isDragging ? "text-accent" : "text-muted-foreground"}`} />
              <p className="text-lg font-medium mb-1">
                Glissez vos PDFs ici
              </p>
              <p className="text-sm text-muted-foreground">
                ou cliquez pour sélectionner des fichiers
              </p>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              <span>L'analyse IA extrait automatiquement les codes SH et résume le contenu</span>
            </div>
          </CardContent>
        </Card>

        {/* Upload Queue */}
        <Card className="animate-slide-up" style={{ animationDelay: "0.1s" }}>
          <CardHeader>
            <CardTitle>File d'attente</CardTitle>
            <CardDescription>
              {files.length === 0
                ? "Aucun fichier en cours"
                : `${files.filter((f) => f.status === "success").length}/${files.length} terminés`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {files.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mb-4 opacity-50" />
                <p>Aucun document uploadé</p>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-4">
                  {files.map((file) => (
                    <div
                      key={file.id}
                      className="p-4 border rounded-lg space-y-3"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <FileText className="h-8 w-8 text-destructive" />
                          <div>
                            <p className="font-medium truncate max-w-[200px]">
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
                          <p className="text-sm">
                            <strong>Résumé :</strong> {file.analysis.summary}
                          </p>
                          {file.analysis.hs_codes?.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {file.analysis.hs_codes.map((code, i) => (
                                <Badge key={i} variant="outline" className="text-xs">
                                  {code}
                                </Badge>
                              ))}
                            </div>
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
