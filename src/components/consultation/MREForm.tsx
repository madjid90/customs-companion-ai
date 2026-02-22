import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ConsultationFileUpload, type ConsultationFile } from "./ConsultationFileUpload";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, Car, Sofa, ChevronDown, ChevronUp, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MREFormData {
  import_type: "vehicle" | "personal_effects" | "both";
  vehicle_brand: string;
  vehicle_year: string;
  vehicle_fuel: string;
  vehicle_cc: string;
  vehicle_value: string;
  vehicle_currency: string;
  vehicle_ownership_months: string;
  effects_description: string;
  effects_value: string;
  effects_transport: string;
  residence_country: string;
  residence_years: string;
  return_type: string;
  has_carte_sejour: boolean;
  has_certificat_residence: boolean;
  has_certificat_changement: boolean;
}

const COUNTRIES_MRE = [
  { code: "FR", name: "🇫🇷 France" }, { code: "ES", name: "🇪🇸 Espagne" },
  { code: "IT", name: "🇮🇹 Italie" }, { code: "BE", name: "🇧🇪 Belgique" },
  { code: "NL", name: "🇳🇱 Pays-Bas" }, { code: "DE", name: "🇩🇪 Allemagne" },
  { code: "GB", name: "🇬🇧 Royaume-Uni" }, { code: "US", name: "🇺🇸 États-Unis" },
  { code: "CA", name: "🇨🇦 Canada" }, { code: "AE", name: "🇦🇪 Émirats" },
  { code: "SA", name: "🇸🇦 Arabie Saoudite" }, { code: "CH", name: "🇨🇭 Suisse" },
];

interface Props {
  onSubmit: (data: MREFormData) => void;
  isLoading?: boolean;
}

export function MREForm({ onSubmit, isLoading }: Props) {
  const [form, setForm] = useState<MREFormData>({
    import_type: "vehicle", vehicle_brand: "", vehicle_year: "", vehicle_fuel: "essence",
    vehicle_cc: "", vehicle_value: "", vehicle_currency: "EUR", vehicle_ownership_months: "",
    effects_description: "", effects_value: "", effects_transport: "maritime",
    residence_country: "", residence_years: "", return_type: "definitif",
    has_carte_sejour: false, has_certificat_residence: false, has_certificat_changement: false,
  });
  const [files, setFiles] = useState<ConsultationFile[]>([]);
  const [showOptions, setShowOptions] = useState(false);

  const update = (key: keyof MREFormData, value: any) => setForm(prev => ({ ...prev, [key]: value }));
  const showVehicle = form.import_type === "vehicle" || form.import_type === "both";
  const showEffects = form.import_type === "personal_effects" || form.import_type === "both";

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

      {/* Type d'import */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Qu'importez-vous ?</Label>
        <div className="grid grid-cols-3 gap-3">
          {([
            { id: "vehicle" as const, icon: Car, label: "Véhicule" },
            { id: "personal_effects" as const, icon: Sofa, label: "Effets personnels" },
            { id: "both" as const, icon: FileText, label: "Les deux" },
          ]).map(opt => (
            <button key={opt.id} type="button" onClick={() => update("import_type", opt.id)}
              className={cn("flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all",
                form.import_type === opt.id ? "border-secondary bg-secondary/5" : "border-border hover:border-secondary/30")}>
              <opt.icon className={cn("h-5 w-5", form.import_type === opt.id ? "text-secondary" : "text-muted-foreground")} />
              <span className="text-xs font-medium">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Pays de résidence */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Pays de résidence</Label>
        <Select value={form.residence_country} onValueChange={v => update("residence_country", v)}>
          <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
          <SelectContent>
            {COUNTRIES_MRE.map(c => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Véhicule : juste marque + valeur si type = vehicle */}
      {showVehicle && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Marque / Modèle</Label>
            <Input placeholder="Ex: Renault Clio V" value={form.vehicle_brand} onChange={e => update("vehicle_brand", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Valeur estimée</Label>
            <div className="flex gap-1.5">
              <Input type="number" placeholder="15 000" value={form.vehicle_value}
                onChange={e => update("vehicle_value", e.target.value)} className="flex-1" />
              <Select value={form.vehicle_currency} onValueChange={v => update("vehicle_currency", v)}>
                <SelectTrigger className="w-[80px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["EUR", "USD", "GBP", "CAD", "AED", "CHF"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {/* Effets : juste description si type = personal_effects */}
      {showEffects && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Description des effets</Label>
          <Textarea placeholder="Meubles, électroménager, vêtements..." value={form.effects_description}
            onChange={e => update("effects_description", e.target.value)} rows={2} className="resize-none" />
        </div>
      )}

      {/* ── UPLOAD toujours visible ── */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">📎 Documents pour plus de précision (carte grise, carte de séjour...)</Label>
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
          {showVehicle && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Année</Label>
                  <Select value={form.vehicle_year} onValueChange={v => update("vehicle_year", v)}>
                    <SelectTrigger><SelectValue placeholder="Année" /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 15 }, (_, i) => 2026 - i).map(y => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Motorisation</Label>
                  <Select value={form.vehicle_fuel} onValueChange={v => update("vehicle_fuel", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="essence">Essence</SelectItem>
                      <SelectItem value="diesel">Diesel</SelectItem>
                      <SelectItem value="hybride">Hybride</SelectItem>
                      <SelectItem value="electrique">Électrique</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Cylindrée (cm³)</Label>
                  <Input type="number" placeholder="1600" value={form.vehicle_cc} onChange={e => update("vehicle_cc", e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Durée de possession</Label>
                <Select value={form.vehicle_ownership_months} onValueChange={v => update("vehicle_ownership_months", v)}>
                  <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="<6">Moins de 6 mois</SelectItem>
                    <SelectItem value="6-12">6 à 12 mois</SelectItem>
                    <SelectItem value=">12">Plus d'1 an</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {showEffects && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Valeur estimée (MAD)</Label>
                <Input type="number" placeholder="50 000" value={form.effects_value} onChange={e => update("effects_value", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Mode de transport</Label>
                <Select value={form.effects_transport} onValueChange={v => update("effects_transport", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="maritime">Conteneur maritime</SelectItem>
                    <SelectItem value="groupage">Groupage maritime</SelectItem>
                    <SelectItem value="aerien">Aérien</SelectItem>
                    <SelectItem value="routier">Routier</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Durée de résidence</Label>
              <Select value={form.residence_years} onValueChange={v => update("residence_years", v)}>
                <SelectTrigger><SelectValue placeholder="Sélectionner" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="<1">Moins d'1 an</SelectItem>
                  <SelectItem value="1-2">1 à 2 ans</SelectItem>
                  <SelectItem value="2-5">2 à 5 ans</SelectItem>
                  <SelectItem value=">5">Plus de 5 ans</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Type de retour</Label>
              <Select value={form.return_type} onValueChange={v => update("return_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="definitif">Retour définitif</SelectItem>
                  <SelectItem value="temporaire">Retour temporaire</SelectItem>
                  <SelectItem value="vacances">Vacances</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Documents que vous avez</Label>
            <div className="flex flex-wrap gap-4">
              {([
                { key: "has_carte_sejour" as const, label: "Carte de séjour valide" },
                { key: "has_certificat_residence" as const, label: "Certificat de résidence" },
                { key: "has_certificat_changement" as const, label: "Certificat de changement de résidence" },
              ]).map(doc => (
                <label key={doc.key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={form[doc.key] as boolean} onCheckedChange={(checked) => update(doc.key, !!checked)} />
                  {doc.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={isLoading || !form.residence_country}>
        {isLoading ? <><Loader2 className="h-5 w-5 animate-spin mr-2" />Génération du rapport MRE...</> : <><FileText className="h-5 w-5 mr-2" />Générer le rapport MRE</>}
      </Button>
    </form>
  );
}
