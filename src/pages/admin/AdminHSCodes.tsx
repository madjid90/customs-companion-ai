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
import { Loader2, Plus, Search, Edit, Trash2, Package } from "lucide-react";

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
}

interface HSCodeForm {
  code: string;
  description_fr: string;
  description_en: string;
  chapter_number: string;
  section_number: string;
  level: string;
  legal_notes: string;
  explanatory_notes: string;
}

const initialFormState: HSCodeForm = {
  code: "",
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
  const [isSaving, setIsSaving] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
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
      setHsCodes(data || []);
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

  const openCreateDialog = () => {
    setEditingId(null);
    setForm(initialFormState);
    setIsDialogOpen(true);
  };

  const openEditDialog = async (hsCode: HSCode) => {
    setEditingId(hsCode.id);
    
    // Load full details
    const { data } = await supabase
      .from("hs_codes")
      .select("*")
      .eq("id", hsCode.id)
      .single();
    
    if (data) {
      setForm({
        code: data.code,
        description_fr: data.description_fr,
        description_en: data.description_en || "",
        chapter_number: data.chapter_number?.toString() || "",
        section_number: data.section_number?.toString() || "",
        level: data.level || "subheading",
        legal_notes: data.legal_notes || "",
        explanatory_notes: data.explanatory_notes || "",
      });
    }
    setIsDialogOpen(true);
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
        toast({ title: "Succès", description: "Code SH mis à jour" });
      } else {
        const { error } = await supabase
          .from("hs_codes")
          .insert(payload);
        if (error) throw error;
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
                    <TableHead className="w-32">Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-24">Chapitre</TableHead>
                    <TableHead className="w-24">Niveau</TableHead>
                    <TableHead className="w-20">Statut</TableHead>
                    <TableHead className="w-24 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hsCodes.map((hs) => (
                    <TableRow key={hs.id}>
                      <TableCell className="font-mono font-medium">{hs.code}</TableCell>
                      <TableCell className="max-w-md truncate">{hs.description_fr}</TableCell>
                      <TableCell>{hs.chapter_number || "-"}</TableCell>
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Modifier le code SH" : "Nouveau code SH"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Modifiez les informations du code SH"
                : "Ajoutez un nouveau code à la nomenclature"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="code">Code SH *</Label>
                <Input
                  id="code"
                  placeholder="84.71.30"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
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
          </div>

          <DialogFooter>
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
