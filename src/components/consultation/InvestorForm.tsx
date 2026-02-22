import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ConsultationFileUpload, type ConsultationFile } from "./ConsultationFileUpload";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Factory, Loader2, ChevronDown, ChevronUp, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface InvestorFormData {
  sector: string;
  zone: string;
  material_description: string;
  material_hs_code: string;
  material_value: string;
  material_currency: string;
  preferred_regime: string;
}

interface Props {
  onSubmit: (data: InvestorFormData) => void;
  isLoading?: boolean;
}

export function InvestorForm({ onSubmit, isLoading }: Props) {
  const [form, setForm] = useState<InvestorFormData>({
    sector: "", zone: "", material_description: "", material_hs_code: "",
    material_value: "", material_currency: "EUR", preferred_regime: "",
  });
  const [files, setFiles] = useState<ConsultationFile[]>([]);
  const [showOptions, setShowOptions] = useState(false);

  const update = (key: keyof InvestorFormData, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const _files = files.filter(f => f.base64).map(f => ({
      type: f.type, base64: f.base64, file: { name: f.file.name, type: f.file.type },
    }));
    onSubmit({ ...form, _files } as any);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* ── ESSENTIEL ── */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Secteur d'activité</Label>
        <Select value={form.sector} onValueChange={v => update("sector", v)}>
          <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="automobile">Automobile</SelectItem>
            <SelectItem value="aeronautique">Aéronautique</SelectItem>
            <SelectItem value="textile">Textile & Habillement</SelectItem>
            <SelectItem value="agroalimentaire">Agroalimentaire</SelectItem>
            <SelectItem value="electronique">Électronique</SelectItem>
            <SelectItem value="chimie">Chimie & Parachimie</SelectItem>
            <SelectItem value="btp">BTP & Immobilier</SelectItem>
            <SelectItem value="energie">Énergie renouvelable</SelectItem>
            <SelectItem value="logistique">Logistique</SelectItem>
            <SelectItem value="autre">Autre</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Description du matériel à importer</Label>
        <Textarea placeholder="Ex: Machine CNC 5 axes, ligne d'assemblage automatique..."
          value={form.material_description} onChange={e => update("material_description", e.target.value)}
          rows={2} className="resize-none" />
      </div>

      {/* ── UPLOAD toujours visible ── */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">📎 Documents pour plus de précision (convention, facture pro forma...)</Label>
        <ConsultationFileUpload files={files} onFilesChange={setFiles} disabled={isLoading} />
      </div>

      {/* ── OPTIONS ── */}
      <button type="button" onClick={() => setShowOptions(!showOptions)}
        className={cn("w-full flex items-center justify-between px-4 py-2.5 rounded-lg text-sm border border-border hover:bg-muted/50 transition-colors", showOptions && "bg-muted/30")}>
        <span className="flex items-center gap-2 text-muted-foreground">
          <Settings2 className="w-4 h-4" /> Plus d'options
        </span>
        {showOptions ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {showOptions && (
        <div className="space-y-4 p-4 rounded-xl border border-border bg-muted/10 animate-in slide-in-from-top-2 duration-200">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Zone d'implantation</Label>
            <Select value={form.zone} onValueChange={v => update("zone", v)}>
              <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="tanger_free_zone">Tanger Free Zone</SelectItem>
                <SelectItem value="casablanca_finance">CFC Casablanca</SelectItem>
                <SelectItem value="kenitra_atlantic">Atlantic Free Zone Kénitra</SelectItem>
                <SelectItem value="tanger_automotive">Tanger Automotive City</SelectItem>
                <SelectItem value="midparc">MidParc Nouaceur</SelectItem>
                <SelectItem value="zone_industrielle">Zone industrielle classique</SelectItem>
                <SelectItem value="hors_zone">Hors zone spéciale</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Code SH</Label>
              <Input placeholder="8456.10" value={form.material_hs_code} onChange={e => update("material_hs_code", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Valeur</Label>
              <Input type="number" placeholder="500 000" value={form.material_value} onChange={e => update("material_value", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Devise</Label>
              <Select value={form.material_currency} onValueChange={v => update("material_currency", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["EUR", "USD", "GBP", "CNY", "JPY"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Régime préféré</Label>
            <Select value={form.preferred_regime} onValueChange={v => update("preferred_regime", v)}>
              <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="droit_commun">Droit commun</SelectItem>
                <SelectItem value="franchise">Franchise investissement</SelectItem>
                <SelectItem value="zone_franche">Zone franche</SelectItem>
                <SelectItem value="admission_temporaire">Admission temporaire</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={isLoading || !form.sector || !form.material_description}>
        {isLoading ? <><Loader2 className="h-5 w-5 animate-spin mr-2" />Analyse en cours...</> : <><Factory className="h-5 w-5 mr-2" />Comparer les régimes</>}
      </Button>
    </form>
  );
}
