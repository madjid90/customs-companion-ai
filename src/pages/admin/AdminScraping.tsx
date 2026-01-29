import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Globe,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  ExternalLink,
  Clock,
  CheckCircle,
  XCircle,
  FileText,
} from "lucide-react";


type VeilleSite = {
  id: string;
  name: string;
  url: string;
  description: string | null;
  site_type: string | null;
  country_code: string | null;
  is_active: boolean | null;
  scrape_type: string | null;
  scrape_selector: string | null;
  scrape_frequency_hours: number | null;
  last_scraped_at: string | null;
  last_scrape_status: string | null;
  total_documents_found: number | null;
  categories: any;
  created_at: string;
};

const siteTypes = [
  { value: "official", label: "Site officiel" },
  { value: "wco", label: "Organisation Mondiale des Douanes" },
  { value: "customs", label: "Administration douanière" },
  { value: "trade", label: "Commerce international" },
  { value: "regulation", label: "Réglementation" },
  { value: "news", label: "Actualités" },
];

export default function AdminScraping() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  
  const [editingSite, setEditingSite] = useState<VeilleSite | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    url: "",
    description: "",
    site_type: "",
    country_code: "",
    scrape_type: "page",
    scrape_selector: "",
    scrape_frequency_hours: 24,
    is_active: true,
  });

  // Fetch sites
  const { data: sites, isLoading } = useQuery({
    queryKey: ["veille-sites"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("veille_sites")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as VeilleSite[];
    },
  });

  // Fetch countries for dropdown
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

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData & { id?: string }) => {
      if (data.id) {
        const { error } = await supabase
          .from("veille_sites")
          .update({
            name: data.name,
            url: data.url,
            description: data.description || null,
            site_type: data.site_type || null,
            country_code: data.country_code || null,
            scrape_type: data.scrape_type,
            scrape_selector: data.scrape_selector || null,
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
          site_type: data.site_type || null,
          country_code: data.country_code || null,
          scrape_type: data.scrape_type,
          scrape_selector: data.scrape_selector || null,
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
      handleCloseDialog();
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("veille_sites").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["veille-sites"] });
      toast({
        title: "Site supprimé",
        description: "Le site a été supprimé avec succès.",
      });
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Scrape mutation - single site
  const scrapeSiteMutation = useMutation({
    mutationFn: async (siteId: string) => {
      const { data, error } = await supabase.functions.invoke('veille-scraper', {
        body: { mode: 'site', siteId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data.async) {
        toast({
          title: "Scraping lance",
          description: "Le scraping est en cours en arriere-plan.",
        });
      } else {
        toast({
          title: "Scraping termine",
          description: `${data.documents_new || 0} nouveaux documents trouves.`,
        });
      }
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["veille-sites"] });
      }, 5000);
    },
    onError: (error) => {
      toast({
        title: "Erreur de scraping",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Scrape all sites mutation
  const scrapeAllMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('veille-scraper', {
        body: { mode: 'full' },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      // Le scraping est async - afficher un message approprié
      if (data.async) {
        toast({
          title: "Scraping lance en arriere-plan",
          description: "Le scraping est en cours. Consultez l'onglet Historique dans Veille pour voir les resultats.",
        });
      } else {
        toast({
          title: "Scraping global termine",
          description: `${data.sites_scraped || 0} sites scrapes, ${data.documents_new || 0} nouveaux documents.`,
        });
      }
      // Rafraichir les données après un délai pour laisser le temps au scraping
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["veille-sites"] });
      }, 5000);
    },
    onError: (error) => {
      toast({
        title: "Erreur de scraping",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // WCO authenticated scraping
  const scrapeWcoMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('wco-authenticated-scraper', {
        body: { url: "https://www.wcotradetools.org/en/valuation/decisions" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Scraping WCO terminé",
        description: `${data.decisions_found || 0} décisions trouvées, ${data.new_documents || 0} nouveaux documents.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Erreur scraping WCO",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleOpenDialog = (site?: VeilleSite) => {
    if (site) {
      setEditingSite(site);
      setFormData({
        name: site.name,
        url: site.url,
        description: site.description || "",
        site_type: site.site_type || "",
        country_code: site.country_code || "",
        scrape_type: site.scrape_type || "page",
        scrape_selector: site.scrape_selector || "",
        scrape_frequency_hours: site.scrape_frequency_hours || 24,
        is_active: site.is_active ?? true,
      });
    } else {
      setEditingSite(null);
      setFormData({
        name: "",
        url: "",
        description: "",
        site_type: "",
        country_code: "",
        scrape_type: "page",
        scrape_selector: "",
        scrape_frequency_hours: 24,
        is_active: true,
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingSite(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({
      ...formData,
      id: editingSite?.id,
    });
  };

  const getStatusBadge = (status: string | null) => {
    if (!status) return <Badge variant="outline">Non scrapé</Badge>;
    if (status === "success")
      return (
        <Badge className="bg-green-500">
          <CheckCircle className="w-3 h-3 mr-1" /> Succès
        </Badge>
      );
    return (
      <Badge variant="destructive">
        <XCircle className="w-3 h-3 mr-1" /> Erreur
      </Badge>
    );
  };

  const formatDate = (date: string | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleString("fr-FR");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Scraping WCO</h1>
          <p className="text-muted-foreground">
            Gérez les sites à scraper pour la veille douanière
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => scrapeAllMutation.mutate()}
            disabled={scrapeAllMutation.isPending || scrapeSiteMutation.isPending || scrapeWcoMutation.isPending}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${scrapeAllMutation.isPending ? 'animate-spin' : ''}`} />
            {scrapeAllMutation.isPending ? "Scraping..." : "Scraping global"}
          </Button>
          <Button
            variant="outline"
            onClick={() => scrapeWcoMutation.mutate()}
            disabled={scrapeWcoMutation.isPending || scrapeAllMutation.isPending || scrapeSiteMutation.isPending}
            className="border-blue-500 text-blue-600 hover:bg-blue-50"
          >
            <Globe className={`w-4 h-4 mr-2 ${scrapeWcoMutation.isPending ? 'animate-spin' : ''}`} />
            {scrapeWcoMutation.isPending ? "Scraping WCO..." : "Scraping WCO"}
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => handleOpenDialog()}>
                <Plus className="w-4 h-4 mr-2" />
                Ajouter un site
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingSite ? "Modifier le site" : "Ajouter un site"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nom du site *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="Ex: WCO - OMD"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="site_type">Type de site</Label>
                  <Select
                    value={formData.site_type}
                    onValueChange={(value) =>
                      setFormData({ ...formData, site_type: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner un type" />
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
              </div>

              <div className="space-y-2">
                <Label htmlFor="url">URL *</Label>
                <Input
                  id="url"
                  type="url"
                  value={formData.url}
                  onChange={(e) =>
                    setFormData({ ...formData, url: e.target.value })
                  }
                  placeholder="https://www.wcoomd.org"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder="Description du site..."
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="country_code">Pays</Label>
                  <Select
                    value={formData.country_code || "international"}
                    onValueChange={(value) =>
                      setFormData({ ...formData, country_code: value === "international" ? "" : value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="International" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="international">International</SelectItem>
                      {countries?.map((country) => (
                        <SelectItem key={country.code} value={country.code}>
                          {country.name_fr}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="scrape_frequency">Fréquence (heures)</Label>
                  <Input
                    id="scrape_frequency"
                    type="number"
                    min="1"
                    value={formData.scrape_frequency_hours}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        scrape_frequency_hours: parseInt(e.target.value) || 24,
                      })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="scrape_type">Type de scraping</Label>
                  <Select
                    value={formData.scrape_type}
                    onValueChange={(value) =>
                      setFormData({ ...formData, scrape_type: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="page">Page unique</SelectItem>
                      <SelectItem value="sitemap">Sitemap</SelectItem>
                      <SelectItem value="rss">Flux RSS</SelectItem>
                      <SelectItem value="api">API</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="scrape_selector">Sélecteur CSS</Label>
                  <Input
                    id="scrape_selector"
                    value={formData.scrape_selector}
                    onChange={(e) =>
                      setFormData({ ...formData, scrape_selector: e.target.value })
                    }
                    placeholder="article.news-item"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_active: checked })
                  }
                />
                <Label htmlFor="is_active">Site actif</Label>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCloseDialog}
                >
                  Annuler
                </Button>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? "Enregistrement..." : "Enregistrer"}
                </Button>
              </div>
            </form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sites configurés
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sites?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sites actifs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {sites?.filter((s) => s.is_active).length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Documents trouvés
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {sites?.reduce((acc, s) => acc + (s.total_documents_found || 0), 0) ||
                0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Dernières erreurs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {sites?.filter((s) => s.last_scrape_status === "error").length || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sites Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            Sites de veille
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Chargement...
            </div>
          ) : sites?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Aucun site configuré. Cliquez sur "Ajouter un site" pour commencer.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Site</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Pays</TableHead>
                  <TableHead>Fréquence</TableHead>
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
                      <div className="flex flex-col">
                        <span className="font-medium">{site.name}</span>
                        <a
                          href={site.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:underline flex items-center gap-1"
                        >
                          {site.url.substring(0, 40)}...
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
                    <TableCell>{site.country_code || "INT"}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {site.scrape_frequency_hours}h
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDate(site.last_scraped_at)}
                    </TableCell>
                    <TableCell>{getStatusBadge(site.last_scrape_status)}</TableCell>
                    <TableCell>{site.total_documents_found || 0}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => scrapeSiteMutation.mutate(site.id)}
                          disabled={scrapeSiteMutation.isPending || scrapeAllMutation.isPending}
                          title="Lancer le scraping"
                        >
                          <RefreshCw className={`w-4 h-4 ${scrapeSiteMutation.isPending ? 'animate-spin' : ''}`} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenDialog(site)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (
                              confirm("Êtes-vous sûr de vouloir supprimer ce site ?")
                            ) {
                              deleteMutation.mutate(site.id);
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

    </div>
  );
}
