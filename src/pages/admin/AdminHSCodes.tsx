import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Plus, Search, Edit, Trash2, Package, ChevronDown, ChevronUp } from "lucide-react";

interface HSCode {
  id: string;
  code: string;
  code_clean: string;
  description_fr: string;
  description_en: string | null;
  chapter_number: number | null;
  section_number: number | null;
  level: string | null;
  is_active: boolean;
  national_codes?: string[]; // Codes nationaux à 10 chiffres associés
}

interface TariffLine {
  id: string;
  country_code: string;
  hs_code_6: string;
  national_code: string;
  description_local: string | null;
  duty_rate: number | null;
  vat_rate: number | null;
  unit_code: string | null;
  is_active: boolean;
}

interface HSCodeForm {
  code: string;
  code_clean: string;
  description_fr: string;
  description_en: string;
  chapter_number: string;
  section_number: string;
  level: string;
  legal_notes: string;
  explanatory_notes: string;
}

interface TariffLineForm {
  id: string;
  national_code: string;
  description_local: string;
  duty_rate: string;
  vat_rate: string;
  unit_code: string;
  isNew?: boolean;
}

const initialFormState: HSCodeForm = {
  code: "",
  code_clean: "",
  description_fr: "",
  description_en: "",
  chapter_number: "",
  section_number: "",
  level: "subheading",
  legal_notes: "",
  explanatory_notes: "",
};

export default function AdminHSCodes() {
  const [hsCodes, setHsCodes] = useState<HSCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<HSCodeForm>(initialFormState);
  const [tariffLines, setTariffLines] = useState<TariffLineForm[]>([]);
  const [loadingTariffs, setLoadingTariffs] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [activeTab, setActiveTab] = useState("hs");
  const pageSize = 50;
  const { toast } = useToast();

  const loadHSCodes = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from("hs_codes")
        .select("id, code, code_clean, description_fr, description_en, chapter_number, section_number, level, is_active", { count: "exact" })
        .order("code", { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (searchTerm) {
        query = query.or(`code.ilike.%${searchTerm}%,description_fr.ilike.%${searchTerm}%`);
      }

      const { data, error, count } = await query;

      if (error) throw error;

      // Charger les codes nationaux associés pour chaque code HS
      const hsCodesWithNational: HSCode[] = [];
      if (data && data.length > 0) {
        const codeCleans = data.map((hs) => hs.code_clean);
        const { data: tariffs } = await supabase
          .from("country_tariffs")
          .select("hs_code_6, national_code")
          .in("hs_code_6", codeCleans)
          .eq("is_active", true);

        // Grouper les codes nationaux par hs_code_6
        const nationalByHs: Record<string, string[]> = {};
        tariffs?.forEach((t) => {
          if (!nationalByHs[t.hs_code_6]) {
            nationalByHs[t.hs_code_6] = [];
          }
          nationalByHs[t.hs_code_6].push(t.national_code);
        });

        for (const hs of data) {
          hsCodesWithNational.push({
            ...hs,
            national_codes: nationalByHs[hs.code_clean] || [],
          });
        }
      }

      setHsCodes(hsCodesWithNational);
      setTotalCount(count || 0);
    } catch (error) {
      console.error("Error loading HS codes:", error);
      toast({
        title: "Erreur",
        description: "Impossible de charger les codes SH",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHSCodes();
  }, [page, searchTerm]);

  const handleSearch = (value: string) => {
    setSearchTerm(value);
    setPage(0);
  };

  const loadTariffLines = async (hsCodeClean: string) => {
    setLoadingTariffs(true);
    try {
      const { data, error } = await supabase
        .from("country_tariffs")
        .select("*")
        .eq("hs_code_6", hsCodeClean)
        .order("national_code");

      if (error) throw error;

      setTariffLines(
        (data || []).map((t) => ({
          id: t.id,
          national_code: t.national_code,
          description_local: t.description_local || "",
          duty_rate: t.duty_rate?.toString() || "0",
          vat_rate: t.vat_rate?.toString() || "20",
          unit_code: t.unit_code || "",
          isNew: false,
        }))
      );
    } catch (error) {
      console.error("Error loading tariff lines:", error);
    } finally {
      setLoadingTariffs(false);
    }
  };

  const openCreateDialog = () => {
    setEditingId(null);
    setForm(initialFormState);
    setTariffLines([]);
    setActiveTab("hs");
    setIsDialogOpen(true);
  };

  const openEditDialog = async (hsCode: HSCode) => {
    setEditingId(hsCode.id);
    setActiveTab("hs");

    // Load full details
    const { data } = await supabase
      .from("hs_codes")
      .select("*")
      .eq("id", hsCode.id)
      .single();

    if (data) {
      setForm({
        code: data.code,
        code_clean: data.code_clean,
        description_fr: data.description_fr,
        description_en: data.description_en || "",
        chapter_number: data.chapter_number?.toString() || "",
        section_number: data.section_number?.toString() || "",
        level: data.level || "subheading",
        legal_notes: data.legal_notes || "",
        explanatory_notes: data.explanatory_notes || "",
      });

      // Load associated tariff lines
      await loadTariffLines(data.code_clean);
    }
    setIsDialogOpen(true);
  };

  const handleCodeChange = (value: string) => {
    const cleanCode = value.replace(/\./g, "");
    setForm({ ...form, code: value, code_clean: cleanCode });
  };

  const addTariffLine = () => {
    const newLine: TariffLineForm = {
      id: `new-${Date.now()}`,
      national_code: form.code_clean + "0000",
      description_local: "",
      duty_rate: "0",
      vat_rate: "20",
      unit_code: "",
      isNew: true,
    };
    setTariffLines([...tariffLines, newLine]);
  };

  const updateTariffLine = (id: string, field: keyof TariffLineForm, value: string) => {
    setTariffLines(
      tariffLines.map((t) => (t.id === id ? { ...t, [field]: value } : t))
    );
  };

  const removeTariffLine = (id: string) => {
    setTariffLines(tariffLines.filter((t) => t.id !== id));
  };

  const handleSave = async () => {
    if (!form.code || !form.description_fr) {
      toast({
        title: "Champs requis",
        description: "Le code et la description française sont obligatoires",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const codeClean = form.code.replace(/\./g, "");
      const payload = {
        code: form.code,
        code_clean: codeClean,
        description_fr: form.description_fr,
        description_en: form.description_en || null,
        chapter_number: form.chapter_number ? parseInt(form.chapter_number) : null,
        section_number: form.section_number ? parseInt(form.section_number) : null,
        level: form.level,
        legal_notes: form.legal_notes || null,
        explanatory_notes: form.explanatory_notes || null,
        is_active: true,
      };

      if (editingId) {
        const { error } = await supabase
          .from("hs_codes")
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;

        // Save tariff lines
        for (const tariff of tariffLines) {
          const tariffPayload = {
            country_code: "MA",
            hs_code_6: codeClean,
            national_code: tariff.national_code,
            description_local: tariff.description_local || null,
            duty_rate: parseFloat(tariff.duty_rate) || 0,
            vat_rate: parseFloat(tariff.vat_rate) || 20,
            unit_code: tariff.unit_code || null,
            is_active: true,
          };

          if (tariff.isNew) {
            const { error: insertError } = await supabase
              .from("country_tariffs")
              .insert(tariffPayload);
            if (insertError) throw insertError;
          } else {
            const { error: updateError } = await supabase
              .from("country_tariffs")
              .update(tariffPayload)
              .eq("id", tariff.id);
            if (updateError) throw updateError;
          }
        }

        toast({ title: "Succès", description: "Code SH et lignes tarifaires mis à jour" });
      } else {
        const { error } = await supabase.from("hs_codes").insert(payload);
        if (error) throw error;

        // Insert new tariff lines
        if (tariffLines.length > 0) {
          const tariffPayloads = tariffLines.map((t) => ({
            country_code: "MA",
            hs_code_6: codeClean,
            national_code: t.national_code,
            description_local: t.description_local || null,
            duty_rate: parseFloat(t.duty_rate) || 0,
            vat_rate: parseFloat(t.vat_rate) || 20,
            unit_code: t.unit_code || null,
            is_active: true,
          }));

          const { error: tariffError } = await supabase
            .from("country_tariffs")
            .insert(tariffPayloads);
          if (tariffError) throw tariffError;
        }

        toast({ title: "Succès", description: "Code SH créé" });
      }

      setIsDialogOpen(false);
      loadHSCodes();
    } catch (error: any) {
      console.error("Save error:", error);
      toast({
        title: "Erreur",
        description: error.message || "Impossible de sauvegarder",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Êtes-vous sûr de vouloir supprimer ce code SH ?")) return;

    try {
      const { error } = await supabase
        .from("hs_codes")
        .update({ is_active: false })
        .eq("id", id);

      if (error) throw error;
      toast({ title: "Succès", description: "Code SH désactivé" });
      loadHSCodes();
    } catch (error) {
      console.error("Delete error:", error);
      toast({
        title: "Erreur",
        description: "Impossible de supprimer",
        variant: "destructive",
      });
    }
  };

  const handleDeleteTariffLine = async (tariffId: string, isNew: boolean) => {
    if (isNew) {
      removeTariffLine(tariffId);
      return;
    }

    if (!confirm("Supprimer cette ligne tarifaire ?")) return;

    try {
      const { error } = await supabase
        .from("country_tariffs")
        .delete()
        .eq("id", tariffId);

      if (error) throw error;
      removeTariffLine(tariffId);
      toast({ title: "Succès", description: "Ligne tarifaire supprimée" });
    } catch (error) {
      console.error("Delete tariff error:", error);
      toast({
        title: "Erreur",
        description: "Impossible de supprimer la ligne tarifaire",
        variant: "destructive",
      });
    }
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between animate-fade-in">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Codes SH</h1>
          <p className="text-muted-foreground mt-1">
            Gérer la nomenclature douanière ({totalCount.toLocaleString()} codes)
          </p>
        </div>
        <Button onClick={openCreateDialog} className="bg-accent hover:bg-accent/90">
          <Plus className="h-4 w-4 mr-2" />
          Nouveau code
        </Button>
      </div>

      {/* Search */}
      <Card className="animate-slide-up">
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher par code ou description..."
              value={searchTerm}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="animate-slide-up" style={{ animationDelay: "0.1s" }}>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-accent" />
            </div>
          ) : hsCodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Package className="h-12 w-12 mb-4 opacity-50" />
              <p>Aucun code SH trouvé</p>
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Code SH</TableHead>
                    <TableHead className="w-40">Code National</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-20">Chapitre</TableHead>
                    <TableHead className="w-24">Niveau</TableHead>
                    <TableHead className="w-20">Statut</TableHead>
                    <TableHead className="w-24 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hsCodes.map((hs) => (
                    <TableRow key={hs.id}>
                      <TableCell className="font-mono font-medium text-sm">{hs.code}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {hs.national_codes && hs.national_codes.length > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            {hs.national_codes.slice(0, 3).map((nc, idx) => (
                              <span key={idx} className="text-muted-foreground">
                                {nc.slice(0, 4)}.{nc.slice(4, 6)}.{nc.slice(6, 8)}.{nc.slice(8)}
                              </span>
                            ))}
                            {hs.national_codes.length > 3 && (
                              <span className="text-xs text-accent">
                                +{hs.national_codes.length - 3} autres
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-sm truncate text-sm">{hs.description_fr}</TableCell>
                      <TableCell className="text-sm">{hs.chapter_number || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {hs.level || "subheading"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={hs.is_active ? "default" : "secondary"}>
                          {hs.is_active ? "Actif" : "Inactif"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditDialog(hs)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(hs.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t">
            <p className="text-sm text-muted-foreground">
              Page {page + 1} sur {totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Précédent
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                Suivant
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Modifier le code SH" : "Nouveau code SH"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Modifiez les informations du code SH et ses lignes tarifaires"
                : "Ajoutez un nouveau code à la nomenclature"}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="hs">Code SH</TabsTrigger>
              <TabsTrigger value="tariffs">
                Lignes tarifaires ({tariffLines.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="hs" className="space-y-4 mt-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="code">Code SH (formaté) *</Label>
                  <Input
                    id="code"
                    placeholder="84.71.30"
                    value={form.code}
                    onChange={(e) => handleCodeChange(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="code_clean">Code nettoyé</Label>
                  <Input
                    id="code_clean"
                    placeholder="847130"
                    value={form.code_clean}
                    onChange={(e) => setForm({ ...form, code_clean: e.target.value })}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="level">Niveau</Label>
                  <select
                    id="level"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.level}
                    onChange={(e) => setForm({ ...form, level: e.target.value })}
                  >
                    <option value="chapter">Chapitre</option>
                    <option value="heading">Position</option>
                    <option value="subheading">Sous-position</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="chapter">Numéro de chapitre</Label>
                  <Input
                    id="chapter"
                    type="number"
                    placeholder="84"
                    value={form.chapter_number}
                    onChange={(e) => setForm({ ...form, chapter_number: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="section">Numéro de section</Label>
                  <Input
                    id="section"
                    type="number"
                    placeholder="16"
                    value={form.section_number}
                    onChange={(e) => setForm({ ...form, section_number: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description_fr">Description (FR) *</Label>
                <Textarea
                  id="description_fr"
                  placeholder="Machines automatiques de traitement de l'information..."
                  value={form.description_fr}
                  onChange={(e) => setForm({ ...form, description_fr: e.target.value })}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description_en">Description (EN)</Label>
                <Textarea
                  id="description_en"
                  placeholder="Automatic data processing machines..."
                  value={form.description_en}
                  onChange={(e) => setForm({ ...form, description_en: e.target.value })}
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="legal_notes">Notes légales</Label>
                <Textarea
                  id="legal_notes"
                  placeholder="Notes de chapitre, règles générales..."
                  value={form.legal_notes}
                  onChange={(e) => setForm({ ...form, legal_notes: e.target.value })}
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="explanatory_notes">Notes explicatives</Label>
                <Textarea
                  id="explanatory_notes"
                  placeholder="Notes explicatives du SH..."
                  value={form.explanatory_notes}
                  onChange={(e) => setForm({ ...form, explanatory_notes: e.target.value })}
                  rows={2}
                />
              </div>
            </TabsContent>

            <TabsContent value="tariffs" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Lignes tarifaires associées au code SH {form.code || "..."}
                </p>
                <Button variant="outline" size="sm" onClick={addTariffLine}>
                  <Plus className="h-4 w-4 mr-2" />
                  Ajouter une ligne
                </Button>
              </div>

              {loadingTariffs ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : tariffLines.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Aucune ligne tarifaire</p>
                  <p className="text-xs">Cliquez sur "Ajouter une ligne" pour en créer</p>
                </div>
              ) : (
                <ScrollArea className="h-[300px]">
                  <div className="space-y-3">
                    {tariffLines.map((tariff, index) => (
                      <Card key={tariff.id} className={tariff.isNew ? "border-accent" : ""}>
                        <CardContent className="p-4">
                          <div className="grid grid-cols-12 gap-3 items-end">
                            <div className="col-span-3 space-y-1">
                              <Label className="text-xs">Code national (10 chiffres)</Label>
                              <Input
                                value={tariff.national_code}
                                onChange={(e) =>
                                  updateTariffLine(tariff.id, "national_code", e.target.value)
                                }
                                className="font-mono text-sm"
                                placeholder="8471300010"
                              />
                            </div>
                            <div className="col-span-3 space-y-1">
                              <Label className="text-xs">Description locale</Label>
                              <Input
                                value={tariff.description_local}
                                onChange={(e) =>
                                  updateTariffLine(tariff.id, "description_local", e.target.value)
                                }
                                placeholder="Description..."
                              />
                            </div>
                            <div className="col-span-2 space-y-1">
                              <Label className="text-xs">DD %</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={tariff.duty_rate}
                                onChange={(e) =>
                                  updateTariffLine(tariff.id, "duty_rate", e.target.value)
                                }
                                className="text-sm"
                              />
                            </div>
                            <div className="col-span-2 space-y-1">
                              <Label className="text-xs">TVA %</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={tariff.vat_rate}
                                onChange={(e) =>
                                  updateTariffLine(tariff.id, "vat_rate", e.target.value)
                                }
                                className="text-sm"
                              />
                            </div>
                            <div className="col-span-1 space-y-1">
                              <Label className="text-xs">Unité</Label>
                              <Input
                                value={tariff.unit_code}
                                onChange={(e) =>
                                  updateTariffLine(tariff.id, "unit_code", e.target.value)
                                }
                                placeholder="KG"
                              />
                            </div>
                            <div className="col-span-1 flex justify-center">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteTariffLine(tariff.id, !!tariff.isNew)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                          {tariff.isNew && (
                            <Badge variant="outline" className="mt-2 text-xs">
                              Nouvelle ligne
                            </Badge>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingId ? "Mettre à jour" : "Créer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}