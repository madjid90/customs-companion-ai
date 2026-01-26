import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  FileText,
  Eye,
  CheckCircle,
  Clock,
  ExternalLink,
  Tag,
  Globe,
  Play,
  RefreshCw,
  Settings,
  History,
  Loader2,
  AlertCircle,
} from "lucide-react";

type VeilleKeyword = {
  id: string;
  keyword: string;
  category: string | null;
  country_code: string | null;
  priority: number | null;
  is_active: boolean | null;
  last_searched_at: string | null;
  total_searches: number | null;
  total_results: number | null;
  created_at: string;
};

type VeilleDocument = {
  id: string;
  title: string;
  source_name: string | null;
  source_url: string | null;
  category: string | null;
  country_code: string | null;
  publication_date: string | null;
  importance: string | null;
  is_verified: boolean | null;
  is_processed: boolean | null;
  summary: string | null;
  content: string | null;
  mentioned_hs_codes: string[];
  detected_tariff_changes: any[];
  confidence_score: number | null;
  created_at: string;
};

type VeilleSite = {
  id: string;
  name: string;
  url: string;
  description: string | null;
  country_code: string | null;
  site_type: string | null;
  scrape_type: string | null;
  scrape_selector: string | null;
  categories: string[] | null;
  is_active: boolean | null;
  scrape_frequency_hours: number | null;
  last_scraped_at: string | null;
  last_scrape_status: string | null;
  total_documents_found: number | null;
  created_at: string;
};

type VeilleLog = {
  id: string;
  cycle_started_at: string;
  cycle_ended_at: string | null;
  status: string | null;
  sites_scraped: number | null;
  keywords_searched: number | null;
  documents_found: number | null;
  documents_new: number | null;
  duration_seconds: number | null;
  errors: string[] | null;
};

const keywordCategories = [
  { value: "tariff", label: "Tarifs douaniers" },
  { value: "regulation", label: "Réglementation" },
  { value: "procedure", label: "Procédures" },
  { value: "control", label: "Contrôles" },
  { value: "trade", label: "Commerce" },
  { value: "general", label: "Général" },
];

const importanceLevels = [
  { value: "haute", label: "Haute", color: "destructive" },
  { value: "moyenne", label: "Moyenne", color: "default" },
  { value: "basse", label: "Basse", color: "secondary" },
];

const siteTypes = [
  { value: "official", label: "Site officiel" },
  { value: "wco", label: "OMD/WCO" },
  { value: "news", label: "Actualités" },
  { value: "trade", label: "Commerce" },
];

export default function AdminVeille() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("documents");
  const [isKeywordDialogOpen, setIsKeywordDialogOpen] = useState(false);
  const [isSiteDialogOpen, setIsSiteDialogOpen] = useState(false);
  const [editingKeyword, setEditingKeyword] = useState<VeilleKeyword | null>(null);
  const [editingSite, setEditingSite] = useState<VeilleSite | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<VeilleDocument | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [documentFilter, setDocumentFilter] = useState<"all" | "pending" | "verified">("all");
  const [isRunningVeille, setIsRunningVeille] = useState(false);
  
  const [keywordForm, setKeywordForm] = useState({
    keyword: "",
    category: "",
    country_code: "",
    priority: 0,
    is_active: true,
  });

  const [siteForm, setSiteForm] = useState({
    name: "",
    url: "",
    description: "",
    country_code: "",
    site_type: "",
    scrape_frequency_hours: 24,
    is_active: true,
  });

  // Fetch keywords
  const { data: keywords, isLoading: loadingKeywords } = useQuery({
    queryKey: ["veille-keywords"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("veille_keywords")
        .select("*")
        .order("priority", { ascending: false });

      if (error) throw error;
      return data as VeilleKeyword[];
    },
  });

  // Fetch documents
  const { data: documents, isLoading: loadingDocuments } = useQuery({
    queryKey: ["veille-documents", searchTerm],
    queryFn: async () => {
      let query = supabase
        .from("veille_documents")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (searchTerm) {
        query = query.or(`title.ilike.%${searchTerm}%,summary.ilike.%${searchTerm}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as VeilleDocument[];
    },
  });

  // Fetch sites with document counts
  const { data: sites, isLoading: loadingSites } = useQuery({
    queryKey: ["veille-sites"],
    queryFn: async () => {
      // Get sites
      const { data: sitesData, error: sitesError } = await supabase
        .from("veille_sites")
        .select("*")
        .order("name");

      if (sitesError) throw sitesError;
      
      // Get document counts by source_name
      const { data: docCounts, error: countError } = await supabase
        .from("veille_documents")
        .select("source_name");
      
      if (countError) throw countError;
      
      // Count documents per source
      const countMap: Record<string, number> = {};
      docCounts?.forEach((doc) => {
        const name = doc.source_name || "";
        countMap[name] = (countMap[name] || 0) + 1;
      });
      
      // Merge counts into sites
      const sitesWithCounts = sitesData?.map((site) => ({
        ...site,
        total_documents_found: countMap[site.name] || 0,
      }));
      
      return sitesWithCounts as VeilleSite[];
    },
  });

  // Fetch logs
  const { data: logs } = useQuery({
    queryKey: ["veille-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("veille_logs")
        .select("*")
        .order("cycle_started_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      return data as VeilleLog[];
    },
  });

  // Fetch countries
  const { data: countries } = useQuery({
    queryKey: ["countries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("countries")
        .select("code, name_fr")
        .eq("is_active", true)
        .order("name_fr");

      if (error) throw error;
      return data;
    },
  });

  // Run veille mutation
  const runVeilleMutation = useMutation({
    mutationFn: async () => {
      setIsRunningVeille(true);
      const { data, error } = await supabase.functions.invoke("veille-scraper", {
        body: { mode: "full" },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["veille-documents"] });
      queryClient.invalidateQueries({ queryKey: ["veille-logs"] });
      queryClient.invalidateQueries({ queryKey: ["veille-sites"] });
      queryClient.invalidateQueries({ queryKey: ["veille-keywords"] });
      
      toast({
        title: "Veille terminée",
        description: `${data.documents_new || 0} nouveaux documents trouvés`,
      });
      setIsRunningVeille(false);
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description: error.message,
        variant: "destructive",
      });
      setIsRunningVeille(false);
    },
  });

  // Keyword mutations
  const saveKeywordMutation = useMutation({
    mutationFn: async (data: typeof keywordForm & { id?: string }) => {
      if (data.id) {
        const { error } = await supabase
          .from("veille_keywords")
          .update({
            keyword: data.keyword,
            category: data.category || null,
            country_code: data.country_code || null,
            priority: data.priority,
            is_active: data.is_active,
          })
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("veille_keywords").insert({
          keyword: data.keyword,
          category: data.category || null,
          country_code: data.country_code || null,
          priority: data.priority,
          is_active: data.is_active,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["veille-keywords"] });
      toast({
        title: editingKeyword ? "Mot-clé modifié" : "Mot-clé ajouté",
        description: "Le mot-clé a été enregistré avec succès.",
      });
      handleCloseKeywordDialog();
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteKeywordMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("veille_keywords").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["veille-keywords"] });
      toast({ title: "Mot-clé supprimé" });
    },
  });

  // Site mutations
  const saveSiteMutation = useMutation({
    mutationFn: async (data: typeof siteForm & { id?: string }) => {
      if (data.id) {
        const { error } = await supabase
          .from("veille_sites")
          .update({
            name: data.name,
            url: data.url,
            description: data.description || null,
            country_code: data.country_code || null,
            site_type: data.site_type || null,
            scrape_frequency_hours: data.scrape_frequency_hours,
            is_active: data.is_active,
          })
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("veille_sites").insert({
          name: data.name,
          url: data.url,
          description: data.description || null,
          country_code: data.country_code || null,
          site_type: data.site_type || null,
          scrape_frequency_hours: data.scrape_frequency_hours,
          is_active: data.is_active,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["veille-sites"] });
      toast({
        title: editingSite ? "Site modifié" : "Site ajouté",
        description: "Le site a été enregistré avec succès.",
      });
      handleCloseSiteDialog();
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteSiteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("veille_sites").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["veille-sites"] });
      toast({ title: "Site supprimé" });
    },
  });

  // Document mutations
  const verifyDocumentMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("veille_documents")
        .update({ is_verified: true, verified_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (validatedId) => {
      queryClient.invalidateQueries({ queryKey: ["veille-documents"] });
      toast({ title: "Document vérifié" });
      
      // Automatically move to next pending document
      if (documents) {
        const currentIndex = documents.findIndex((d) => d.id === validatedId);
        const nextPending = documents.find((d, index) => index > currentIndex && !d.is_verified);
        
        if (nextPending) {
          setSelectedDocument(nextPending);
          toast({ 
            title: "Document suivant", 
            description: `Passage au document: ${nextPending.title.substring(0, 50)}...` 
          });
        } else {
          // Check if there are any pending documents before the current one
          const anyPending = documents.find((d) => d.id !== validatedId && !d.is_verified);
          if (anyPending) {
            setSelectedDocument(anyPending);
            toast({ 
              title: "Document suivant", 
              description: `Passage au document: ${anyPending.title.substring(0, 50)}...` 
            });
          } else {
            setSelectedDocument(null);
            toast({ 
              title: "Validation terminée", 
              description: "Tous les documents ont été validés !" 
            });
          }
        }
      }
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("veille_documents").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["veille-documents"] });
      toast({ title: "Document supprimé" });
      setSelectedDocument(null);
    },
  });

  const handleOpenKeywordDialog = (keyword?: VeilleKeyword) => {
    if (keyword) {
      setEditingKeyword(keyword);
      setKeywordForm({
        keyword: keyword.keyword,
        category: keyword.category || "",
        country_code: keyword.country_code || "",
        priority: keyword.priority || 0,
        is_active: keyword.is_active ?? true,
      });
    } else {
      setEditingKeyword(null);
      setKeywordForm({
        keyword: "",
        category: "",
        country_code: "",
        priority: 0,
        is_active: true,
      });
    }
    setIsKeywordDialogOpen(true);
  };

  const handleCloseKeywordDialog = () => {
    setIsKeywordDialogOpen(false);
    setEditingKeyword(null);
  };

  const handleOpenSiteDialog = (site?: VeilleSite) => {
    if (site) {
      setEditingSite(site);
      setSiteForm({
        name: site.name,
        url: site.url,
        description: site.description || "",
        country_code: site.country_code || "",
        site_type: site.site_type || "",
        scrape_frequency_hours: site.scrape_frequency_hours || 24,
        is_active: site.is_active ?? true,
      });
    } else {
      setEditingSite(null);
      setSiteForm({
        name: "",
        url: "",
        description: "",
        country_code: "",
        site_type: "",
        scrape_frequency_hours: 24,
        is_active: true,
      });
    }
    setIsSiteDialogOpen(true);
  };

  const handleCloseSiteDialog = () => {
    setIsSiteDialogOpen(false);
    setEditingSite(null);
  };

  const handleSubmitKeyword = (e: React.FormEvent) => {
    e.preventDefault();
    saveKeywordMutation.mutate({
      ...keywordForm,
      id: editingKeyword?.id,
    });
  };

  const handleSubmitSite = (e: React.FormEvent) => {
    e.preventDefault();
    saveSiteMutation.mutate({
      ...siteForm,
      id: editingSite?.id,
    });
  };

  const getImportanceBadge = (importance: string | null) => {
    const level = importanceLevels.find((l) => l.value === importance);
    if (!level) return <Badge variant="outline">Non définie</Badge>;
    return <Badge variant={level.color as "destructive" | "default" | "secondary"}>{level.label}</Badge>;
  };

  const formatDate = (date: string | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case "success":
        return <Badge className="bg-green-500">Succès</Badge>;
      case "error":
        return <Badge variant="destructive">Erreur</Badge>;
      case "running":
        return <Badge className="bg-blue-500">En cours</Badge>;
      case "completed":
        return <Badge className="bg-green-500">Terminé</Badge>;
      case "completed_with_errors":
        return <Badge className="bg-orange-500">Avec erreurs</Badge>;
      default:
        return <Badge variant="outline">{status || "Inconnu"}</Badge>;
    }
  };

  const pendingCount = documents?.filter((d) => !d.is_verified).length || 0;
  const verifiedCount = documents?.filter((d) => d.is_verified).length || 0;
  const lastLog = logs?.[0];

  // Filter documents based on selected filter
  const filteredDocuments = documents?.filter((doc) => {
    if (documentFilter === "pending") return !doc.is_verified;
    if (documentFilter === "verified") return doc.is_verified;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Veille Automatique</h1>
          <p className="text-muted-foreground">
            Scraping automatique et analyse IA des sites officiels
          </p>
        </div>
        <Button
          onClick={() => runVeilleMutation.mutate()}
          disabled={isRunningVeille}
          size="lg"
        >
          {isRunningVeille ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Analyse en cours...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              Lancer la veille
            </>
          )}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sites surveillés
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {sites?.filter((s) => s.is_active).length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Mots-clés actifs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {keywords?.filter((k) => k.is_active).length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Documents collectés
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{documents?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              En attente
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{pendingCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Dernière exécution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm">
              {lastLog ? (
                <>
                  <div className="font-medium">{formatDate(lastLog.cycle_started_at)}</div>
                  <div className="text-muted-foreground text-xs">
                    {lastLog.documents_new || 0} nouveaux
                  </div>
                </>
              ) : (
                <span className="text-muted-foreground">Jamais</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="documents" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Documents ({documents?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="sites" className="flex items-center gap-2">
            <Globe className="w-4 h-4" />
            Sites ({sites?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="keywords" className="flex items-center gap-2">
            <Tag className="w-4 h-4" />
            Mots-clés ({keywords?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="logs" className="flex items-center gap-2">
            <History className="w-4 h-4" />
            Historique
          </TabsTrigger>
        </TabsList>

        {/* Documents Tab */}
        <TabsContent value="documents" className="space-y-4">
          <div className="flex gap-4 items-center flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Rechercher dans les documents..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant={documentFilter === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setDocumentFilter("all")}
              >
                Tous ({documents?.length || 0})
              </Button>
              <Button
                variant={documentFilter === "pending" ? "default" : "outline"}
                size="sm"
                onClick={() => setDocumentFilter("pending")}
              >
                <Clock className="w-4 h-4 mr-1" />
                En attente ({pendingCount})
              </Button>
              <Button
                variant={documentFilter === "verified" ? "default" : "outline"}
                size="sm"
                onClick={() => setDocumentFilter("verified")}
              >
                <CheckCircle className="w-4 h-4 mr-1" />
                Validés ({verifiedCount})
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Documents List */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Documents de veille</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingDocuments ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Chargement...
                  </div>
                ) : filteredDocuments?.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>
                      {documentFilter === "all" 
                        ? "Aucun document trouvé." 
                        : documentFilter === "pending"
                        ? "Aucun document en attente."
                        : "Aucun document validé."}
                    </p>
                    {documentFilter === "all" && (
                      <p className="text-sm mt-2">Lancez la veille pour collecter des documents.</p>
                    )}
                  </div>
                ) : (
                  <ScrollArea className="h-[500px]">
                    <div className="space-y-2">
                      {filteredDocuments?.map((doc) => (
                        <div
                          key={doc.id}
                          className={`p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors ${
                            selectedDocument?.id === doc.id ? "border-primary bg-muted/50" : ""
                          }`}
                          onClick={() => setSelectedDocument(doc)}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium truncate">{doc.title}</h4>
                              <p className="text-xs text-muted-foreground mt-1">
                                {doc.source_name || "Source inconnue"} •{" "}
                                {formatDate(doc.publication_date || doc.created_at)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 ml-2">
                              {getImportanceBadge(doc.importance)}
                              {doc.is_verified ? (
                                <CheckCircle className="w-4 h-4 text-green-500" />
                              ) : (
                                <Clock className="w-4 h-4 text-orange-500" />
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            {/* Document Detail */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Eye className="w-5 h-5" />
                  Détail
                </CardTitle>
              </CardHeader>
              <CardContent>
                {selectedDocument ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-semibold">{selectedDocument.title}</h3>
                      <div className="flex items-center gap-2 mt-2">
                        {getImportanceBadge(selectedDocument.importance)}
                        {selectedDocument.country_code && (
                          <Badge variant="outline">{selectedDocument.country_code}</Badge>
                        )}
                      </div>
                    </div>

                    {selectedDocument.summary && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Résumé</Label>
                        <p className="text-sm mt-1">{selectedDocument.summary}</p>
                      </div>
                    )}

                    {selectedDocument.source_url && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Source</Label>
                        <a
                          href={selectedDocument.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline flex items-center gap-1 mt-1"
                        >
                          {selectedDocument.source_name || "Voir la source"}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    )}

                    {selectedDocument.mentioned_hs_codes?.length > 0 && (
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Codes SH mentionnés
                        </Label>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {selectedDocument.mentioned_hs_codes.map(
                            (code: string, i: number) => (
                              <Badge key={i} variant="secondary" className="text-xs">
                                {code}
                              </Badge>
                            )
                          )}
                        </div>
                      </div>
                    )}

                    {selectedDocument.confidence_score && (
                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Score de confiance
                        </Label>
                        <div className="flex items-center gap-2 mt-1">
                          <Progress value={selectedDocument.confidence_score * 100} className="h-2 flex-1" />
                          <span className="text-sm">
                            {Math.round(selectedDocument.confidence_score * 100)}%
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 pt-4 border-t">
                      {!selectedDocument.is_verified && (
                        <Button
                          size="sm"
                          onClick={() => verifyDocumentMutation.mutate(selectedDocument.id)}
                          disabled={verifyDocumentMutation.isPending}
                        >
                          <CheckCircle className="w-4 h-4 mr-1" />
                          Valider
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          if (confirm("Supprimer ce document ?")) {
                            deleteDocumentMutation.mutate(selectedDocument.id);
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        Supprimer
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    Sélectionnez un document pour voir les détails
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Sites Tab */}
        <TabsContent value="sites" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={isSiteDialogOpen} onOpenChange={setIsSiteDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => handleOpenSiteDialog()}>
                  <Plus className="w-4 h-4 mr-2" />
                  Ajouter un site
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>
                    {editingSite ? "Modifier le site" : "Ajouter un site"}
                  </DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmitSite} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="site-name">Nom du site *</Label>
                    <Input
                      id="site-name"
                      value={siteForm.name}
                      onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })}
                      placeholder="Ex: Douane Marocaine"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="site-url">URL *</Label>
                    <Input
                      id="site-url"
                      type="url"
                      value={siteForm.url}
                      onChange={(e) => setSiteForm({ ...siteForm, url: e.target.value })}
                      placeholder="https://www.douane.gov.ma"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="site-description">Description</Label>
                    <Textarea
                      id="site-description"
                      value={siteForm.description}
                      onChange={(e) => setSiteForm({ ...siteForm, description: e.target.value })}
                      placeholder="Description du site..."
                      rows={2}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Type de site</Label>
                      <Select
                        value={siteForm.site_type}
                        onValueChange={(value) => setSiteForm({ ...siteForm, site_type: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner" />
                        </SelectTrigger>
                        <SelectContent>
                          {siteTypes.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Pays</Label>
                      <Select
                        value={siteForm.country_code || "all"}
                        onValueChange={(value) =>
                          setSiteForm({ ...siteForm, country_code: value === "all" ? "" : value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Tous" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">International</SelectItem>
                          {countries?.map((country) => (
                            <SelectItem key={country.code} value={country.code}>
                              {country.name_fr}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="frequency">Fréquence de scraping (heures)</Label>
                    <Input
                      id="frequency"
                      type="number"
                      min="1"
                      max="168"
                      value={siteForm.scrape_frequency_hours}
                      onChange={(e) =>
                        setSiteForm({
                          ...siteForm,
                          scrape_frequency_hours: parseInt(e.target.value) || 24,
                        })
                      }
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="site-active"
                      checked={siteForm.is_active}
                      onCheckedChange={(checked) => setSiteForm({ ...siteForm, is_active: checked })}
                    />
                    <Label htmlFor="site-active">Site actif</Label>
                  </div>

                  <div className="flex justify-end gap-2 pt-4">
                    <Button type="button" variant="outline" onClick={handleCloseSiteDialog}>
                      Annuler
                    </Button>
                    <Button type="submit" disabled={saveSiteMutation.isPending}>
                      {saveSiteMutation.isPending ? "Enregistrement..." : "Enregistrer"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Sites à surveiller</CardTitle>
              <CardDescription>
                Configurez les sites officiels à scraper automatiquement
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingSites ? (
                <div className="text-center py-8 text-muted-foreground">Chargement...</div>
              ) : sites?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Globe className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Aucun site configuré.</p>
                  <p className="text-sm mt-2">Ajoutez des sites officiels à surveiller.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Site</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Pays</TableHead>
                      <TableHead>Dernier scraping</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead>Documents</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sites?.map((site) => (
                      <TableRow key={site.id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{site.name}</div>
                            <a
                              href={site.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                            >
                              {new URL(site.url).hostname}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {siteTypes.find((t) => t.value === site.site_type)?.label ||
                              site.site_type ||
                              "-"}
                          </Badge>
                        </TableCell>
                        <TableCell>{site.country_code || "International"}</TableCell>
                        <TableCell className="text-sm">
                          {site.last_scraped_at ? formatDate(site.last_scraped_at) : "Jamais"}
                        </TableCell>
                        <TableCell>
                          {site.is_active ? (
                            getStatusBadge(site.last_scrape_status)
                          ) : (
                            <Badge variant="secondary">Inactif</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant={site.total_documents_found > 0 ? "default" : "secondary"}
                            className="cursor-pointer"
                            onClick={() => {
                              setActiveTab("documents");
                              setSearchTerm(site.name);
                            }}
                          >
                            {site.total_documents_found || 0} docs
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleOpenSiteDialog(site)}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (confirm("Supprimer ce site ?")) {
                                  deleteSiteMutation.mutate(site.id);
                                }
                              }}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Keywords Tab */}
        <TabsContent value="keywords" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={isKeywordDialogOpen} onOpenChange={setIsKeywordDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => handleOpenKeywordDialog()}>
                  <Plus className="w-4 h-4 mr-2" />
                  Ajouter un mot-clé
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {editingKeyword ? "Modifier le mot-clé" : "Ajouter un mot-clé"}
                  </DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmitKeyword} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="keyword">Mot-clé *</Label>
                    <Input
                      id="keyword"
                      value={keywordForm.keyword}
                      onChange={(e) =>
                        setKeywordForm({ ...keywordForm, keyword: e.target.value })
                      }
                      placeholder="Ex: modification tarifaire"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Catégorie</Label>
                      <Select
                        value={keywordForm.category}
                        onValueChange={(value) =>
                          setKeywordForm({ ...keywordForm, category: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner" />
                        </SelectTrigger>
                        <SelectContent>
                          {keywordCategories.map((cat) => (
                            <SelectItem key={cat.value} value={cat.value}>
                              {cat.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Pays</Label>
                      <Select
                        value={keywordForm.country_code || "all"}
                        onValueChange={(value) =>
                          setKeywordForm({ ...keywordForm, country_code: value === "all" ? "" : value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Tous" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Tous les pays</SelectItem>
                          {countries?.map((country) => (
                            <SelectItem key={country.code} value={country.code}>
                              {country.name_fr}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="priority">Priorité (0-10)</Label>
                    <Input
                      id="priority"
                      type="number"
                      min="0"
                      max="10"
                      value={keywordForm.priority}
                      onChange={(e) =>
                        setKeywordForm({
                          ...keywordForm,
                          priority: parseInt(e.target.value) || 0,
                        })
                      }
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="is_active"
                      checked={keywordForm.is_active}
                      onCheckedChange={(checked) =>
                        setKeywordForm({ ...keywordForm, is_active: checked })
                      }
                    />
                    <Label htmlFor="is_active">Mot-clé actif</Label>
                  </div>

                  <div className="flex justify-end gap-2 pt-4">
                    <Button type="button" variant="outline" onClick={handleCloseKeywordDialog}>
                      Annuler
                    </Button>
                    <Button type="submit" disabled={saveKeywordMutation.isPending}>
                      {saveKeywordMutation.isPending ? "Enregistrement..." : "Enregistrer"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Mots-clés de veille</CardTitle>
              <CardDescription>
                Mots-clés utilisés pour la recherche automatique
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingKeywords ? (
                <div className="text-center py-8 text-muted-foreground">Chargement...</div>
              ) : keywords?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Tag className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Aucun mot-clé configuré.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mot-clé</TableHead>
                      <TableHead>Catégorie</TableHead>
                      <TableHead>Pays</TableHead>
                      <TableHead>Priorité</TableHead>
                      <TableHead>Recherches</TableHead>
                      <TableHead>Résultats</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keywords?.map((keyword) => (
                      <TableRow key={keyword.id}>
                        <TableCell className="font-medium">{keyword.keyword}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {keywordCategories.find((c) => c.value === keyword.category)?.label ||
                              keyword.category ||
                              "-"}
                          </Badge>
                        </TableCell>
                        <TableCell>{keyword.country_code || "Tous"}</TableCell>
                        <TableCell>{keyword.priority || 0}</TableCell>
                        <TableCell>{keyword.total_searches || 0}</TableCell>
                        <TableCell>{keyword.total_results || 0}</TableCell>
                        <TableCell>
                          {keyword.is_active ? (
                            <Badge className="bg-green-500">Actif</Badge>
                          ) : (
                            <Badge variant="secondary">Inactif</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleOpenKeywordDialog(keyword)}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (confirm("Supprimer ce mot-clé ?")) {
                                  deleteKeywordMutation.mutate(keyword.id);
                                }
                              }}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Historique des exécutions</CardTitle>
              <CardDescription>
                Suivi des cycles de veille automatique
              </CardDescription>
            </CardHeader>
            <CardContent>
              {logs?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Aucune exécution enregistrée.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead>Sites</TableHead>
                      <TableHead>Mots-clés</TableHead>
                      <TableHead>Documents trouvés</TableHead>
                      <TableHead>Nouveaux</TableHead>
                      <TableHead>Durée</TableHead>
                      <TableHead>Erreurs</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs?.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-sm">
                          {formatDate(log.cycle_started_at)}
                        </TableCell>
                        <TableCell>{getStatusBadge(log.status)}</TableCell>
                        <TableCell>{log.sites_scraped || 0}</TableCell>
                        <TableCell>{log.keywords_searched || 0}</TableCell>
                        <TableCell>{log.documents_found || 0}</TableCell>
                        <TableCell className="font-medium text-green-600">
                          +{log.documents_new || 0}
                        </TableCell>
                        <TableCell>
                          {log.duration_seconds ? `${log.duration_seconds}s` : "-"}
                        </TableCell>
                        <TableCell>
                          {log.errors && log.errors.length > 0 ? (
                            <Badge variant="destructive" className="cursor-help" title={log.errors.join(", ")}>
                              <AlertCircle className="w-3 h-3 mr-1" />
                              {log.errors.length}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
