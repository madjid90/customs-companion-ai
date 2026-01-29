import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  FileText, 
  Search, 
  Eye, 
  Download,
  CheckCircle,
  Clock,
  ExternalLink,
  Loader2,
  Sparkles,
  AlertCircle,
  FileSearch
} from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";

interface PdfDocument {
  id: string;
  title: string;
  file_name: string;
  file_path: string;
  category: string;
  country_code: string | null;
  is_verified: boolean;
  created_at: string;
  file_size_bytes: number | null;
  related_hs_codes: string[] | null;
}

interface PdfExtraction {
  id: string;
  pdf_id: string;
  summary: string | null;
  key_points: string[] | null;
  mentioned_hs_codes: string[] | null;
  detected_tariff_changes: any[] | null;
  extraction_confidence: number | null;
  created_at: string;
}

const categoryLabels: Record<string, string> = {
  tarif: "Tarif douanier",
  circulaire: "Circulaire",
  note: "Note technique",
  avis: "Avis de classement",
  accord: "Accord commercial",
  reglementation: "Réglementation",
  autre: "Autre",
};

export default function AdminDocuments() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<PdfDocument | null>(null);
  const [selectedExtraction, setSelectedExtraction] = useState<PdfExtraction | null>(null);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, success: 0, failed: 0 });
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewTitle, setPdfPreviewTitle] = useState<string>("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: documents, isLoading } = useQuery({
    queryKey: ["pdf-documents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pdf_documents")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as PdfDocument[];
    },
  });

  const { data: extractions } = useQuery({
    queryKey: ["pdf-extractions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pdf_extractions")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as PdfExtraction[];
    },
  });

  const getExtraction = (pdfId: string) => {
    return extractions?.find((e) => e.pdf_id === pdfId);
  };

  const filteredDocs = documents?.filter((doc) => {
    const search = searchTerm.toLowerCase();
    const extraction = getExtraction(doc.id);
    const hsCodes = extraction?.mentioned_hs_codes || doc.related_hs_codes || [];
    
    return (
      doc.title.toLowerCase().includes(search) ||
      doc.file_name.toLowerCase().includes(search) ||
      doc.category.toLowerCase().includes(search) ||
      hsCodes.some((code: string) => code.includes(search))
    );
  });

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const openDocument = (filePath: string, title?: string) => {
    try {
      // Construire l'URL manuellement pour éviter les problèmes d'encodage
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const bucketName = "pdf-documents";
      
      // Encoder correctement le chemin du fichier
      const encodedPath = filePath.split('/').map(part => encodeURIComponent(part)).join('/');
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucketName}/${encodedPath}`;
      
      console.log("Opening PDF in dialog:", publicUrl);
      
      // Ouvrir dans le dialogue intégré
      setPdfPreviewUrl(publicUrl);
      setPdfPreviewTitle(title || filePath.split('/').pop() || "Document PDF");
    } catch (error) {
      console.error("Error opening document:", error);
      toast({
        title: "❌ Erreur",
        description: "Impossible d'ouvrir le document",
        variant: "destructive",
      });
    }
  };

  const closePdfPreview = () => {
    setPdfPreviewUrl(null);
    setPdfPreviewTitle("");
  };

  const viewDetails = (doc: PdfDocument) => {
    setSelectedDoc(doc);
    setSelectedExtraction(getExtraction(doc.id) || null);
  };

  const analyzeDocument = async (doc: PdfDocument) => {
    if (analyzingIds.has(doc.id)) return;
    
    setAnalyzingIds(prev => new Set(prev).add(doc.id));
    
    toast({
      title: "🤖 Analyse en cours...",
      description: `Traitement de "${doc.title}"`,
    });

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-pdf`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            pdfId: doc.id,
            filePath: doc.file_path,
            previewOnly: false,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Erreur lors de l'analyse");
      }

      const data = await response.json();
      
      // Mark document as verified
      await supabase
        .from("pdf_documents")
        .update({ is_verified: true, verified_at: new Date().toISOString() })
        .eq("id", doc.id);

      toast({
        title: "✅ Analyse terminée",
        description: `${data.hs_codes?.length || 0} codes SH et ${data.tariff_lines?.length || 0} lignes tarifaires extraits`,
      });

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ["pdf-documents"] });
      queryClient.invalidateQueries({ queryKey: ["pdf-extractions"] });
    } catch (error: any) {
      console.error("Analysis error:", error);
      toast({
        title: "❌ Erreur d'analyse",
        description: error.message || "Une erreur est survenue",
        variant: "destructive",
      });
    } finally {
      setAnalyzingIds(prev => {
        const next = new Set(prev);
        next.delete(doc.id);
        return next;
      });
    }
  };

  // Batch analyze all pending documents - with retry and server-side check
  const analyzeAllPending = async () => {
    const pendingDocs = documents?.filter(d => !getExtraction(d.id)) || [];
    
    if (pendingDocs.length === 0) {
      toast({
        title: "✅ Aucun document en attente",
        description: "Tous les documents ont déjà été analysés",
      });
      return;
    }

    setBatchAnalyzing(true);
    setBatchProgress({ current: 0, total: pendingDocs.length, success: 0, failed: 0 });

    toast({
      title: "🚀 Analyse en lot démarrée",
      description: `Traitement de ${pendingDocs.length} documents. Chaque analyse prend le temps nécessaire.`,
    });

    let successCount = 0;
    let failCount = 0;

    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
    const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    const MAX_RETRIES = 3;
    const RETRY_DELAY = 5000; // 5 seconds between retries

    // Helper: Check if extraction already exists in DB
    const checkExtractionExists = async (pdfId: string): Promise<boolean> => {
      const { data } = await supabase
        .from("pdf_extractions")
        .select("id")
        .eq("pdf_id", pdfId)
        .maybeSingle();
      return !!data;
    };

    // Process documents one by one with retry logic
    for (let i = 0; i < pendingDocs.length; i++) {
      const doc = pendingDocs[i];
      setBatchProgress(prev => ({ ...prev, current: i + 1 }));

      // First, check if extraction already exists (maybe created by a previous failed request)
      const alreadyExists = await checkExtractionExists(doc.id);
      if (alreadyExists) {
        console.log(`✅ [${i + 1}/${pendingDocs.length}] ${doc.title} - Extraction déjà existante`);
        await supabase
          .from("pdf_documents")
          .update({ is_verified: true, verified_at: new Date().toISOString() })
          .eq("id", doc.id);
        successCount++;
        setBatchProgress(prev => ({ ...prev, success: successCount }));
        continue;
      }

      let success = false;
      let lastError = "";

      for (let attempt = 1; attempt <= MAX_RETRIES && !success; attempt++) {
        const startTime = Date.now();
        console.log(`🔄 [${i + 1}/${pendingDocs.length}] Tentative ${attempt}/${MAX_RETRIES}: ${doc.title}`);

        try {
          const response = await fetch(`${SUPABASE_URL}/functions/v1/analyze-pdf`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${ANON_KEY}`,
            },
            body: JSON.stringify({
              pdfId: doc.id,
              filePath: doc.file_path,
              previewOnly: false,
            }),
          });

          const elapsed = Math.round((Date.now() - startTime) / 1000);

          if (!response.ok) {
            const errorText = await response.text().catch(() => "Unknown error");
            lastError = `HTTP ${response.status}: ${errorText}`;
            console.warn(`⚠️ [${i + 1}] Tentative ${attempt} échouée (${elapsed}s): ${lastError}`);
          } else {
            const data = await response.json();
            if (data?.error) {
              lastError = data.error;
              console.warn(`⚠️ [${i + 1}] Tentative ${attempt} échouée (${elapsed}s): ${lastError}`);
            } else {
              await supabase
                .from("pdf_documents")
                .update({ is_verified: true, verified_at: new Date().toISOString() })
                .eq("id", doc.id);
              success = true;
              successCount++;
              console.log(`✅ [${i + 1}/${pendingDocs.length}] ${doc.title} - ${data.hs_codes?.length || 0} HS codes (${elapsed}s)`);
            }
          }
        } catch (error: any) {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          lastError = error.message || "Failed to fetch";
          console.warn(`⚠️ [${i + 1}] Tentative ${attempt} échouée (${elapsed}s): ${lastError}`);
          
          // After network error, check if extraction was actually saved server-side
          await new Promise(resolve => setTimeout(resolve, 2000));
          const savedAnyway = await checkExtractionExists(doc.id);
          if (savedAnyway) {
            console.log(`✅ [${i + 1}] ${doc.title} - Extraction trouvée après erreur réseau`);
            await supabase
              .from("pdf_documents")
              .update({ is_verified: true, verified_at: new Date().toISOString() })
              .eq("id", doc.id);
            success = true;
            successCount++;
          }
        }

        // Wait before retry (if not successful and more retries available)
        if (!success && attempt < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
      }

      if (!success) {
        console.error(`❌ [${i + 1}/${pendingDocs.length}] ${doc.title}: Échec après ${MAX_RETRIES} tentatives - ${lastError}`);
        failCount++;
      }

      setBatchProgress(prev => ({ ...prev, success: successCount, failed: failCount }));

      // Delay between documents (3 seconds)
      if (i < pendingDocs.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    setBatchAnalyzing(false);

    toast({
      title: "🎉 Analyse en lot terminée",
      description: `${successCount} réussies, ${failCount} échouées sur ${pendingDocs.length} documents`,
    });

    // Refresh data
    queryClient.invalidateQueries({ queryKey: ["pdf-documents"] });
    queryClient.invalidateQueries({ queryKey: ["pdf-extractions"] });
  };

  const pendingCount = documents?.filter(d => !getExtraction(d.id)).length || 0;

  // Utiliser le nombre de documents avec extractions
  const analyzedCount = documents?.filter(d => getExtraction(d.id)).length || 0;

  // Query pour les stats réelles des codes SH actifs dans la base
  const { data: hsCodesStats } = useQuery({
    queryKey: ["hs-codes-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("hs_codes")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true);
      
      if (error) throw error;
      return count || 0;
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Documents analysés</h1>
          <p className="text-muted-foreground mt-1">
            Consultez les PDFs uploadés et leurs codes SH extraits
          </p>
        </div>
        
        {pendingCount > 0 && (
          <Button
            onClick={analyzeAllPending}
            disabled={batchAnalyzing}
            className="gap-2"
          >
            {batchAnalyzing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {batchProgress.current}/{batchProgress.total} en cours...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Analyser tous ({pendingCount})
              </>
            )}
          </Button>
        )}
      </div>

      {/* Batch Progress */}
      {batchAnalyzing && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <div className="flex-1">
                <p className="font-medium">
                  Analyse en cours: {batchProgress.current} / {batchProgress.total}
                </p>
                <div className="flex gap-4 text-sm text-muted-foreground mt-1">
                  <span className="text-green-600">✓ {batchProgress.success} réussies</span>
                  {batchProgress.failed > 0 && (
                    <span className="text-red-600">✗ {batchProgress.failed} échouées</span>
                  )}
                </div>
                <div className="h-2 bg-muted rounded-full mt-2 overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{documents?.length || 0}</p>
                <p className="text-sm text-muted-foreground">Documents</p>
              </div>
              <FileText className="h-8 w-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{analyzedCount}</p>
                <p className="text-sm text-muted-foreground">Analysés</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-600/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{hsCodesStats || 0}</p>
                <p className="text-sm text-muted-foreground">Codes SH extraits</p>
              </div>
              <Badge variant="outline" className="text-lg px-3">SH</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-destructive">{pendingCount}</p>
                <p className="text-sm text-muted-foreground">Non analysés</p>
              </div>
              <AlertCircle className="h-8 w-8 text-destructive/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search & Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle>Liste des documents</CardTitle>
              <CardDescription>
                {filteredDocs?.length || 0} document(s) trouvé(s)
              </CardDescription>
            </div>
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher par titre, code SH..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredDocs?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>Aucun document trouvé</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Catégorie</TableHead>
                    <TableHead>Codes SH</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDocs?.map((doc) => {
                    const extraction = getExtraction(doc.id);
                    const hsCodes = extraction?.mentioned_hs_codes || doc.related_hs_codes || [];
                    
                    return (
                      <TableRow key={doc.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <FileText className="h-5 w-5 text-red-500 shrink-0" />
                            <div className="min-w-0">
                              <p className="font-medium truncate max-w-[200px]">
                                {doc.title}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatFileSize(doc.file_size_bytes)}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {categoryLabels[doc.category] || doc.category}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {hsCodes.length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {hsCodes.slice(0, 3).map((code: string, i: number) => (
                                <Badge key={i} variant="secondary" className="text-xs font-mono">
                                  {code}
                                </Badge>
                              ))}
                              {hsCodes.length > 3 && (
                                <Badge variant="outline" className="text-xs">
                                  +{hsCodes.length - 3}
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {doc.is_verified ? (
                            <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Analysé
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              <Clock className="h-3 w-3 mr-1" />
                              En attente
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(doc.created_at), "dd MMM yyyy", { locale: fr })}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {!extraction && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => analyzeDocument(doc)}
                                disabled={analyzingIds.has(doc.id)}
                                title="Analyser par IA"
                              >
                                {analyzingIds.has(doc.id) ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Sparkles className="h-4 w-4 text-amber-500" />
                                )}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => viewDetails(doc)}
                              title="Voir les détails"
                            >
                              <FileSearch className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openDocument(doc.file_path, doc.title)}
                              title="Aperçu du PDF"
                            >
                              <Eye className="h-4 w-4 text-primary" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedDoc} onOpenChange={() => setSelectedDoc(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-red-500" />
              {selectedDoc?.title}
            </DialogTitle>
            <DialogDescription>
              {categoryLabels[selectedDoc?.category || ""] || selectedDoc?.category}
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-6">
              {/* Document Info */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Fichier</p>
                  <p className="font-medium">{selectedDoc?.file_name}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Taille</p>
                  <p className="font-medium">{formatFileSize(selectedDoc?.file_size_bytes || null)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Pays</p>
                  <p className="font-medium">{selectedDoc?.country_code || "Non spécifié"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Date d'upload</p>
                  <p className="font-medium">
                    {selectedDoc && format(new Date(selectedDoc.created_at), "dd MMMM yyyy à HH:mm", { locale: fr })}
                  </p>
                </div>
              </div>

              {/* Extraction Results */}
              {selectedExtraction ? (
                <>
                  <div className="border-t pt-4">
                    <h4 className="font-semibold mb-2">Résumé IA</h4>
                    <p className="text-sm text-muted-foreground">
                      {selectedExtraction.summary || "Aucun résumé disponible"}
                    </p>
                  </div>

                  {selectedExtraction.key_points && selectedExtraction.key_points.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-2">Points clés</h4>
                      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                        {selectedExtraction.key_points.map((point: string, i: number) => (
                          <li key={i}>{point}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {selectedExtraction.mentioned_hs_codes && selectedExtraction.mentioned_hs_codes.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-2">
                        Codes SH extraits ({selectedExtraction.mentioned_hs_codes.length})
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {selectedExtraction.mentioned_hs_codes.map((code: string, i: number) => (
                          <Badge key={i} variant="outline" className="font-mono">
                            {code}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedExtraction.detected_tariff_changes && selectedExtraction.detected_tariff_changes.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-2">
                        Lignes tarifaires ({selectedExtraction.detected_tariff_changes.length})
                      </h4>
                      <div className="rounded-md border max-h-60 overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Code national</TableHead>
                              <TableHead>Description</TableHead>
                              <TableHead>DDI</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedExtraction.detected_tariff_changes.slice(0, 20).map((line: any, i: number) => (
                              <TableRow key={i}>
                                <TableCell className="font-mono text-xs">
                                  {line.national_code || "-"}
                                </TableCell>
                                <TableCell className="text-xs max-w-[200px] truncate">
                                  {line.description || "-"}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {line.duty_rate != null ? `${line.duty_rate}%` : "-"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  {selectedExtraction.extraction_confidence && (
                    <div className="text-xs text-muted-foreground">
                      Confiance: {Math.round(selectedExtraction.extraction_confidence * 100)}%
                    </div>
                  )}
                </>
              ) : (
                <div className="border-t pt-4 text-center text-muted-foreground">
                  <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Aucune extraction disponible</p>
                  <p className="text-sm">Le document n'a pas encore été analysé par l'IA</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => selectedDoc && openDocument(selectedDoc.file_path, selectedDoc.title)}
                >
                  <Eye className="h-4 w-4 mr-2" />
                  Aperçu du PDF
                </Button>
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* PDF Preview Dialog */}
      <Dialog open={!!pdfPreviewUrl} onOpenChange={closePdfPreview}>
        <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-destructive" />
              {pdfPreviewTitle}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-2 flex-wrap">
              Aperçu du document
              <div className="flex gap-2 ml-auto">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => pdfPreviewUrl && window.open(pdfPreviewUrl, "_blank")}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Nouvel onglet
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                >
                  <a href={pdfPreviewUrl || "#"} download>
                    <Download className="h-4 w-4 mr-2" />
                    Télécharger
                  </a>
                </Button>
              </div>
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 min-h-0 bg-muted/30 relative">
            {pdfPreviewUrl && (
              <iframe
                src={`https://docs.google.com/viewer?url=${encodeURIComponent(pdfPreviewUrl)}&embedded=true`}
                className="w-full h-full border-0"
                title="Aperçu PDF"
                sandbox="allow-scripts allow-same-origin allow-popups"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
