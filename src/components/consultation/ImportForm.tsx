import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ConsultationFileUpload, type ConsultationFile } from "./ConsultationFileUpload";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, ChevronDown, ChevronUp, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

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
  { code: "EUR", label: "EUR" }, { code: "USD", label: "USD" },
  { code: "MAD", label: "MAD" }, { code: "GBP", label: "GBP" },
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
  const [files, setFiles] = useState<ConsultationFile[]>([]);
  const [showOptions, setShowOptions] = useState(false);

  const update = (key: keyof ImportFormData, value: any) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const _files = files.filter(f => f.base64).map(f => ({
      type: f.type, base64: f.base64,
      file: { name: f.file.name, type: f.file.type },
    }));
    onSubmit({ ...form, _files } as any);
  };

  const canSubmit = form.product_description.trim().length > 0
    && form.country_code && form.value;

  const optionalFilled = [
    form.hs_code, form.freight, form.insurance, form.quantity, form.weight,
  ].filter(Boolean).length
    + (form.agreement !== "none" ? 1 : 0)
    + (form.regime !== "mise_consommation" ? 1 : 0);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* ── ESSENTIEL ── */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Décrivez votre produit</Label>
        <Textarea
          placeholder="Ex: Écran LCD 55 pouces 4K avec support mural, importé en cartons de 10"
          value={form.product_description}
          onChange={e => update("product_description", e.target.value)}
          rows={2} className="resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label className="text-sm font-semibold">Pays d'origine</Label>
          <Select value={form.country_code} onValueChange={v => update("country_code", v)}>
            <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
            <SelectContent>
              {COUNTRIES.map(c => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-semibold">Valeur</Label>
          <div className="flex gap-1.5">
            <Input type="number" placeholder="50 000" value={form.value}
              onChange={e => update("value", e.target.value)} className="flex-1" />
            <Select value={form.currency} onValueChange={v => update("currency", v)}>
              <SelectTrigger className="w-[80px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map(c => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ── UPLOAD toujours visible ── */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">📎 Documents pour plus de précision (facture, DUM, fiche technique...)</Label>
        <ConsultationFileUpload files={files} onFilesChange={setFiles} disabled={isLoading} />
      </div>

      {/* ── OPTIONS ── */}
      <button type="button" onClick={() => setShowOptions(!showOptions)}
        className={cn("w-full flex items-center justify-between px-4 py-2.5 rounded-lg text-sm border border-border hover:bg-muted/50 transition-colors", showOptions && "bg-muted/30")}>
        <span className="flex items-center gap-2 text-muted-foreground">
          <Settings2 className="w-4 h-4" /> Plus d'options
          {optionalFilled > 0 && !showOptions && (
            <span className="bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full font-medium">{optionalFilled}</span>
          )}
        </span>
        {showOptions ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {showOptions && (
        <div className="space-y-4 p-4 rounded-xl border border-border bg-muted/10 animate-in slide-in-from-top-2 duration-200">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Code SH (si connu)</Label>
              <Input placeholder="Ex: 8528.72.00.00" value={form.hs_code} onChange={e => update("hs_code", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Incoterm</Label>
              <Select value={form.incoterm} onValueChange={v => update("incoterm", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{INCOTERMS.map(i => <SelectItem key={i.code} value={i.code}>{i.code}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Fret ({form.currency})</Label>
              <Input type="number" placeholder="Auto" value={form.freight} onChange={e => update("freight", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Assurance ({form.currency})</Label>
              <Input type="number" placeholder="Auto (0.5%)" value={form.insurance} onChange={e => update("insurance", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Quantité</Label>
              <Input type="number" placeholder="Optionnel" value={form.quantity} onChange={e => update("quantity", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Poids net (kg)</Label>
              <Input type="number" placeholder="Optionnel" value={form.weight} onChange={e => update("weight", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Régime douanier</Label>
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
              <Label className="text-xs text-muted-foreground">Accord préférentiel</Label>
              <Select value={form.agreement} onValueChange={v => update("agreement", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{AGREEMENTS.map(a => <SelectItem key={a.code} value={a.code}>{a.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      <Button type="submit" className="w-full h-14 cta-gradient rounded-2xl text-base font-semibold" disabled={isLoading || !canSubmit}>
        {isLoading ? <><Loader2 className="h-5 w-5 animate-spin mr-2" />Génération du rapport...</> : <><FileText className="h-5 w-5 mr-2" />Générer le rapport</>}
      </Button>
    </form>
  );
}
