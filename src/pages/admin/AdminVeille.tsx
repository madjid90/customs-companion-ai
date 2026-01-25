import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  FileText,
  Eye,
  CheckCircle,
  Clock,
  AlertTriangle,
  ExternalLink,
  Tag,
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
  mentioned_hs_codes: any;
  detected_tariff_changes: any;
  confidence_score: number | null;
  created_at: string;
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

export default function AdminVeille() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("documents");
  const [isKeywordDialogOpen, setIsKeywordDialogOpen] = useState(false);
  const [editingKeyword, setEditingKeyword] = useState<VeilleKeyword | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<VeilleDocument | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [keywordForm, setKeywordForm] = useState({
    keyword: "",
    category: "",
    country_code: "",
    priority: 0,
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

  // Document mutations
  const verifyDocumentMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("veille_documents")
        .update({ is_verified: true, verified_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["veille-documents"] });
      toast({ title: "Document vérifié" });
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

  const handleSubmitKeyword = (e: React.FormEvent) => {
    e.preventDefault();
    saveKeywordMutation.mutate({
      ...keywordForm,
      id: editingKeyword?.id,
    });
  };

  const getImportanceBadge = (importance: string | null) => {
    const level = importanceLevels.find((l) => l.value === importance);
    if (!level) return <Badge variant="outline">Non définie</Badge>;
    return <Badge variant={level.color as any}>{level.label}</Badge>;
  };

  const formatDate = (date: string | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleDateString("fr-FR");
  };

  const pendingCount = documents?.filter((d) => !d.is_verified).length || 0;
  const verifiedCount = documents?.filter((d) => d.is_verified).length || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Veille Web</h1>
          <p className="text-muted-foreground">
            Gestion des mots-clés et documents de veille réglementaire
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
              En attente de validation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{pendingCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Documents vérifiés
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{verifiedCount}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="documents" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Documents ({documents?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="keywords" className="flex items-center gap-2">
            <Tag className="w-4 h-4" />
            Mots-clés ({keywords?.length || 0})
          </TabsTrigger>
        </TabsList>

        {/* Documents Tab */}
        <TabsContent value="documents" className="space-y-4">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Rechercher dans les documents..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
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
                ) : documents?.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Aucun document trouvé.
                  </div>
                ) : (
                  <ScrollArea className="h-[500px]">
                    <div className="space-y-2">
                      {documents?.map((doc) => (
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
                        <p className="text-sm mt-1">
                          {Math.round(selectedDocument.confidence_score * 100)}%
                        </p>
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
                        value={keywordForm.country_code}
                        onValueChange={(value) =>
                          setKeywordForm({ ...keywordForm, country_code: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Tous" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Tous les pays</SelectItem>
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
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleCloseKeywordDialog}
                    >
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
            </CardHeader>
            <CardContent>
              {loadingKeywords ? (
                <div className="text-center py-8 text-muted-foreground">
                  Chargement...
                </div>
              ) : keywords?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Aucun mot-clé configuré.
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
                            {keywordCategories.find((c) => c.value === keyword.category)
                              ?.label || keyword.category || "-"}
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
      </Tabs>
    </div>
  );
}
