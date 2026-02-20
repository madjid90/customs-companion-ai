import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { FileText, Loader2 } from "lucide-react";

export interface ImportFormData {
  product_description: string;
  hs_code: string;
  country_code: string;
  value: string;
  currency: string;
  incoterm: string;
  freight: string;
  insurance: string;
  quantity: string;
  weight: string;
  regime: string;
  agreement: string;
  sections: string[];
}

const COUNTRIES = [
  { code: "CN", name: "🇨🇳 Chine" }, { code: "FR", name: "🇫🇷 France" },
  { code: "ES", name: "🇪🇸 Espagne" }, { code: "US", name: "🇺🇸 États-Unis" },
  { code: "TR", name: "🇹🇷 Turquie" }, { code: "DE", name: "🇩🇪 Allemagne" },
  { code: "IT", name: "🇮🇹 Italie" }, { code: "IN", name: "🇮🇳 Inde" },
  { code: "AE", name: "🇦🇪 Émirats" }, { code: "SA", name: "🇸🇦 Arabie Saoudite" },
  { code: "EG", name: "🇪🇬 Égypte" }, { code: "TN", name: "🇹🇳 Tunisie" },
  { code: "GB", name: "🇬🇧 Royaume-Uni" }, { code: "JP", name: "🇯🇵 Japon" },
  { code: "KR", name: "🇰🇷 Corée du Sud" }, { code: "BE", name: "🇧🇪 Belgique" },
  { code: "NL", name: "🇳🇱 Pays-Bas" }, { code: "PT", name: "🇵🇹 Portugal" },
];

const CURRENCIES = [
  { code: "MAD", label: "MAD" }, { code: "USD", label: "USD" },
  { code: "EUR", label: "EUR" }, { code: "GBP", label: "GBP" },
  { code: "CNY", label: "CNY" }, { code: "AED", label: "AED" },
];

const INCOTERMS = [
  { code: "FOB", label: "FOB" }, { code: "CIF", label: "CIF" },
  { code: "EXW", label: "EXW" }, { code: "CFR", label: "CFR" },
  { code: "CIP", label: "CIP" }, { code: "CPT", label: "CPT" },
  { code: "DAP", label: "DAP" }, { code: "DDP", label: "DDP" },
];

const AGREEMENTS = [
  { code: "none", label: "Aucun" },
  { code: "UE-MA", label: "UE-Maroc" },
  { code: "US-MA", label: "USA-Maroc (ALE)" },
  { code: "TR-MA", label: "Turquie-Maroc" },
  { code: "AELE", label: "AELE" },
  { code: "AGADIR", label: "Accord d'Agadir" },
  { code: "ZLECAF", label: "ZLECAf" },
];

const SECTIONS = [
  { id: "classification", label: "Classification SH" },
  { id: "taxes", label: "Droits & Taxes" },
  { id: "conformity", label: "Conformités" },
  { id: "documents", label: "Documents requis" },
  { id: "procedure", label: "Procédure" },
  { id: "agreements", label: "Accords préférentiels" },
];

interface Props {
  onSubmit: (data: ImportFormData) => void;
  isLoading?: boolean;
}

export function ImportForm({ onSubmit, isLoading }: Props) {
  const [form, setForm] = useState<ImportFormData>({
    product_description: "", hs_code: "", country_code: "", value: "",
    currency: "EUR", incoterm: "FOB", freight: "", insurance: "",
    quantity: "", weight: "", regime: "mise_consommation", agreement: "none",
    sections: ["classification", "taxes", "conformity", "documents"],
  });

  const update = (key: keyof ImportFormData, value: any) => setForm(prev => ({ ...prev, [key]: value }));

  const toggleSection = (id: string) => {
    setForm(prev => ({
      ...prev,
      sections: prev.sections.includes(id)
        ? prev.sections.filter(s => s !== id)
        : [...prev.sections, id],
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Section 1: Product */}
      <fieldset className="space-y-4 p-4 rounded-xl border border-border bg-card">
        <legend className="text-sm font-semibold text-primary px-2">1 — Votre produit</legend>
        <div className="space-y-2">
          <Label>Description du produit *</Label>
          <Textarea placeholder="Ex: Écran LCD 55 pouces, résolution 4K, avec support mural" value={form.product_description} onChange={e => update("product_description", e.target.value)} rows={3} className="resize-none" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Code SH (si connu)</Label>
            <Input placeholder="Ex: 8528.72.00.00" value={form.hs_code} onChange={e => update("hs_code", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Pays d'origine *</Label>
            <Select value={form.country_code} onValueChange={v => update("country_code", v)}>
              <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
              <SelectContent>
                {COUNTRIES.map(c => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </fieldset>

      {/* Section 2: Value & Transport */}
      <fieldset className="space-y-4 p-4 rounded-xl border border-border bg-card">
        <legend className="text-sm font-semibold text-primary px-2">2 — Valeur et transport</legend>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>Valeur *</Label>
            <Input type="number" placeholder="10 000" value={form.value} onChange={e => update("value", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Devise</Label>
            <Select value={form.currency} onValueChange={v => update("currency", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map(c => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Incoterm</Label>
            <Select value={form.incoterm} onValueChange={v => update("incoterm", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INCOTERMS.map(i => <SelectItem key={i.code} value={i.code}>{i.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Fret</Label>
            <Input type="number" placeholder="500" value={form.freight} onChange={e => update("freight", e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Assurance</Label>
            <Input type="number" placeholder="Auto" value={form.insurance} onChange={e => update("insurance", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Quantité</Label>
            <Input type="number" placeholder="100" value={form.quantity} onChange={e => update("quantity", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Poids net (kg)</Label>
            <Input type="number" placeholder="500" value={form.weight} onChange={e => update("weight", e.target.value)} />
          </div>
        </div>
      </fieldset>

      {/* Section 3: Options */}
      <fieldset className="space-y-4 p-4 rounded-xl border border-border bg-card">
        <legend className="text-sm font-semibold text-primary px-2">3 — Options</legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Régime douanier</Label>
            <Select value={form.regime} onValueChange={v => update("regime", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mise_consommation">Mise à la consommation</SelectItem>
                <SelectItem value="admission_temporaire">Admission temporaire</SelectItem>
                <SelectItem value="entrepot">Entrepôt sous douane</SelectItem>
                <SelectItem value="transit">Transit</SelectItem>
                <SelectItem value="zone_franche">Zone franche</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Accord préférentiel</Label>
            <Select value={form.agreement} onValueChange={v => update("agreement", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {AGREEMENTS.map(a => <SelectItem key={a.code} value={a.code}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Sections du rapport</Label>
          <div className="flex flex-wrap gap-3">
            {SECTIONS.map(s => (
              <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={form.sections.includes(s.id)} onCheckedChange={() => toggleSection(s.id)} />
                {s.label}
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <Button type="submit" size="lg" className="w-full" disabled={isLoading || !form.product_description || !form.country_code || !form.value}>
        {isLoading ? <><Loader2 className="h-5 w-5 animate-spin mr-2" />Génération du rapport...</> : <><FileText className="h-5 w-5 mr-2" />Générer le rapport</>}
      </Button>
    </form>
  );
}
