import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ConsultationFileUpload, type ConsultationFile } from "./ConsultationFileUpload";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, Loader2 } from "lucide-react";

export interface ConformityFormData {
  product_description: string;
  hs_code: string;
  country_code: string;
  authorities: string[];
}

const AUTHORITIES = [
  { id: "all", label: "Toutes (recommandé)", desc: "Vérification complète" },
  { id: "onssa", label: "ONSSA", desc: "Sécurité sanitaire" },
  { id: "anrt", label: "ANRT", desc: "Homologation télécom" },
  { id: "coc", label: "CoC", desc: "Conformité à l'origine" },
  { id: "dmp", label: "DMP", desc: "Pharmaceutiques" },
  { id: "onicl", label: "ONICL", desc: "Céréales" },
  { id: "imanor", label: "IMANOR", desc: "Normes NM" },
  { id: "onee", label: "ONEE", desc: "Électriques" },
  { id: "licence", label: "Licence", desc: "MCINET" },
];

const COUNTRIES = [
  { code: "CN", name: "🇨🇳 Chine" }, { code: "FR", name: "🇫🇷 France" },
  { code: "ES", name: "🇪🇸 Espagne" }, { code: "US", name: "🇺🇸 États-Unis" },
  { code: "TR", name: "🇹🇷 Turquie" }, { code: "DE", name: "🇩🇪 Allemagne" },
  { code: "IT", name: "🇮🇹 Italie" }, { code: "IN", name: "🇮🇳 Inde" },
  { code: "AE", name: "🇦🇪 Émirats" }, { code: "GB", name: "🇬🇧 Royaume-Uni" },
];

interface Props {
  onSubmit: (data: ConformityFormData) => void;
  isLoading?: boolean;
}

export function ConformityForm({ onSubmit, isLoading }: Props) {
  const [form, setForm] = useState<ConformityFormData>({
    product_description: "", hs_code: "", country_code: "", authorities: ["all"],
  });
  const [files, setFiles] = useState<ConsultationFile[]>([]);

  const toggleAuth = (id: string) => {
    if (id === "all") {
      setForm(prev => ({ ...prev, authorities: prev.authorities.includes("all") ? [] : ["all"] }));
    } else {
      setForm(prev => ({
        ...prev,
        authorities: prev.authorities.filter(a => a !== "all").includes(id)
          ? prev.authorities.filter(a => a !== id)
          : [...prev.authorities.filter(a => a !== "all"), id],
      }));
    }
  };

  return (
    <form onSubmit={e => { e.preventDefault(); const _files = files.filter(f => f.base64).map(f => ({ type: f.type, base64: f.base64, file: { name: f.file.name, type: f.file.type } })); onSubmit({ ...form, _files } as any); }} className="space-y-6">
      <fieldset className="space-y-4 p-4 rounded-xl border border-border bg-card">
        <legend className="text-sm font-semibold text-warning px-2">1 — Votre produit</legend>
        <div className="space-y-2">
          <Label>Description du produit *</Label>
          <Textarea placeholder="Ex: Routeur Wi-Fi 6, double bande, avec antenne externe" value={form.product_description} onChange={e => setForm(p => ({ ...p, product_description: e.target.value }))} rows={3} className="resize-none" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Code SH (si connu)</Label>
            <Input placeholder="Ex: 8517.62.00.00" value={form.hs_code} onChange={e => setForm(p => ({ ...p, hs_code: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Pays d'origine</Label>
            <Select value={form.country_code} onValueChange={v => setForm(p => ({ ...p, country_code: v }))}>
              <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
              <SelectContent>
                {COUNTRIES.map(c => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4 p-4 rounded-xl border border-border bg-card">
        <legend className="text-sm font-semibold text-warning px-2">2 — Autorités à vérifier</legend>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {AUTHORITIES.map(a => (
            <label key={a.id} className="flex items-start gap-2 text-sm cursor-pointer p-2 rounded-lg hover:bg-muted/50">
              <Checkbox checked={form.authorities.includes(a.id)} onCheckedChange={() => toggleAuth(a.id)} className="mt-0.5" />
              <div>
                <span className="font-medium">{a.label}</span>
                <p className="text-xs text-muted-foreground">{a.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Documents */}
      <fieldset className="space-y-4 p-4 rounded-xl border border-border bg-card">
        <legend className="text-sm font-semibold text-warning px-2">3 — Documents (optionnel)</legend>
        <ConsultationFileUpload files={files} onFilesChange={setFiles} disabled={isLoading} />
      </fieldset>

      <Button type="submit" size="lg" className="w-full" disabled={isLoading || !form.product_description}>
        {isLoading ? <><Loader2 className="h-5 w-5 animate-spin mr-2" />Vérification en cours...</> : <><ClipboardCheck className="h-5 w-5 mr-2" />Vérifier les conformités</>}
      </Button>
    </form>
  );
}
