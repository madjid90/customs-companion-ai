import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConsultationFileUpload, type ConsultationFile } from "./ConsultationFileUpload";
import { WizardStepper, type WizardStep } from "./WizardStepper";
import { WizardGenerating } from "./WizardGenerating";
import { ConsultationReport } from "./ConsultationReport";
import type { ConsultationMode } from "./ConsultationModeSelector";
import {
  Package, Home, ClipboardCheck, Factory, ArrowLeft, ArrowRight,
  Sparkles, Car, Sofa, FileText, Pencil
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// ─── DATA ───
const COUNTRIES = [
  { code: "CN", name: "🇨🇳 Chine" }, { code: "FR", name: "🇫🇷 France" },
  { code: "ES", name: "🇪🇸 Espagne" }, { code: "US", name: "🇺🇸 États-Unis" },
  { code: "TR", name: "🇹🇷 Turquie" }, { code: "DE", name: "🇩🇪 Allemagne" },
  { code: "IT", name: "🇮🇹 Italie" }, { code: "IN", name: "🇮🇳 Inde" },
  { code: "AE", name: "🇦🇪 Émirats" }, { code: "GB", name: "🇬🇧 Royaume-Uni" },
  { code: "SA", name: "🇸🇦 Arabie Saoudite" }, { code: "BE", name: "🇧🇪 Belgique" },
  { code: "NL", name: "🇳🇱 Pays-Bas" }, { code: "CH", name: "🇨🇭 Suisse" },
  { code: "CA", name: "🇨🇦 Canada" }, { code: "JP", name: "🇯🇵 Japon" },
  { code: "EG", name: "🇪🇬 Égypte" }, { code: "TN", name: "🇹🇳 Tunisie" },
  { code: "KR", name: "🇰🇷 Corée du Sud" }, { code: "PT", name: "🇵🇹 Portugal" },
];

const MODES: { id: ConsultationMode; icon: React.ElementType; title: string; desc: string }[] = [
  { id: "import", icon: Package, title: "Import", desc: "Classification, taxes, documents" },
  { id: "mre", icon: Home, title: "MRE", desc: "Véhicule, effets personnels" },
  { id: "conformity", icon: ClipboardCheck, title: "Conformité", desc: "ONSSA, ANRT, CoC" },
  { id: "investor", icon: Factory, title: "Investissement", desc: "Zones franches, régimes" },
];

const STEPS_CONFIG: Record<ConsultationMode, WizardStep[]> = {
  import: [
    { id: "product", label: "Produit", required: true },
    { id: "origin", label: "Origine & Valeur", required: true },
    { id: "details", label: "Détails", required: false, smart: true },
    { id: "documents", label: "Documents", required: false },
    { id: "review", label: "Validation", required: true },
  ],
  mre: [
    { id: "type", label: "Type", required: true },
    { id: "details", label: "Détails", required: true },
    { id: "situation", label: "Situation", required: true },
    { id: "documents", label: "Documents", required: false },
    { id: "review", label: "Validation", required: true },
  ],
  conformity: [
    { id: "product", label: "Produit", required: true },
    { id: "documents", label: "Documents", required: false },
    { id: "review", label: "Validation", required: true },
  ],
  investor: [
    { id: "project", label: "Projet", required: true },
    { id: "material", label: "Matériel", required: true },
    { id: "documents", label: "Documents", required: false },
    { id: "review", label: "Validation", required: true },
  ],
};

const MODE_COLORS: Record<ConsultationMode, string> = {
  import: "border-primary bg-primary/5",
  mre: "border-secondary bg-secondary/5",
  conformity: "border-warning bg-warning/5",
  investor: "border-accent-foreground bg-accent",
};

interface Props {
  initialMode?: ConsultationMode;
  initialReport?: any;
  onReset?: () => void;
}

export function ConsultationWizard({ initialMode, initialReport, onReset }: Props) {
  const [mode, setMode] = useState<ConsultationMode | null>(initialMode || null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Record<string, any>>({});
  const [files, setFiles] = useState<ConsultationFile[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportData, setReportData] = useState<any>(initialReport || null);
  const { toast } = useToast();

  const steps = mode ? STEPS_CONFIG[mode] : [];
  const currentStep = steps[step];
  const modeInfo = MODES.find(m => m.id === mode);

  const update = useCallback((key: string, val: any) => {
    setForm(prev => ({ ...prev, [key]: val }));
  }, []);

  // ─── Can proceed logic ───
  const canProceed = (): boolean => {
    if (!currentStep) return false;
    const s = currentStep.id;
    if (mode === "import") {
      if (s === "product") return (form.product_description?.trim()?.length || 0) > 3;
      if (s === "origin") return !!form.country_code && !!form.value;
      return true;
    }
    if (mode === "mre") {
      if (s === "type") return !!form.import_type;
      if (s === "details") {
        if (form.import_type === "vehicle") return !!form.vehicle_brand && !!form.vehicle_value;
        if (form.import_type === "personal_effects") return !!form.effects_description;
        return !!form.vehicle_brand || !!form.effects_description;
      }
      if (s === "situation") return !!form.residence_country;
      return true;
    }
    if (mode === "conformity") {
      if (s === "product") return (form.product_description?.trim()?.length || 0) > 3;
      return true;
    }
    if (mode === "investor") {
      if (s === "project") return !!form.sector;
      if (s === "material") return (form.material_description?.trim()?.length || 0) > 3;
      return true;
    }
    return true;
  };

  const canSkipDetails = () =>
    mode === "import" && (form.product_description?.length || 0) > 20 && form.country_code && form.value;

  const next = () => { if (step < steps.length - 1) setStep(step + 1); };
  const prev = () => { if (step > 0) setStep(step - 1); };
  const goToStep = (i: number) => setStep(i);
  const skipToReview = () => setStep(steps.length - 1);

  const handleSelectMode = (m: ConsultationMode) => {
    setMode(m);
    setStep(0);
    if (m === "import") setForm({ currency: "EUR", incoterm: "FOB", regime: "mise_consommation", agreement: "none", sections: ["classification", "taxes", "conformity", "documents"] });
    else if (m === "mre") setForm({ import_type: "vehicle", vehicle_currency: "EUR", vehicle_fuel: "essence", effects_transport: "maritime", return_type: "definitif" });
    else if (m === "conformity") setForm({ authorities: ["all"] });
    else if (m === "investor") setForm({ material_currency: "EUR" });
  };

  const handleReset = () => {
    setMode(null); setStep(0); setForm({}); setFiles([]);
    setIsGenerating(false); setReportData(null);
    onReset?.();
  };

  // ─── Submit to backend ───
  const handleSubmit = async () => {
    setIsGenerating(true);
    setReportData(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Erreur", description: "Vous devez être connecté.", variant: "destructive" });
        setIsGenerating(false);
        return;
      }
      const _files = files.filter(f => f.base64).map(f => ({
        type: f.type, base64: f.base64, file: { name: f.file.name, type: f.file.type },
      }));
      const inputs = { ...form, _files };

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/consultation-report`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ type: mode, inputs }),
        }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Erreur ${response.status}`);
      }
      const data = await response.json();
      setReportData(data);
      toast({ title: "Rapport généré", description: `Référence: ${data.reference}` });
    } catch (error: any) {
      console.error("Consultation error:", error);
      toast({ title: "Erreur", description: error.message || "Erreur lors de la génération", variant: "destructive" });
      setIsGenerating(false);
    }
  };

  const getCountryName = (code: string) => COUNTRIES.find(c => c.code === code)?.name || code || "—";

  // ─── GENERATING SCREEN ───
  if (isGenerating) {
    return (
      <div className="min-h-0 pb-8">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <WizardGenerating
            mode={mode!}
            isDone={!!reportData}
            onViewReport={() => setIsGenerating(false)}
            onNewConsultation={handleReset}
          />
        </div>
      </div>
    );
  }

  // ─── REPORT VIEW ───
  if (reportData && !isGenerating) {
    return (
      <div className="min-h-0 bg-background pb-8">
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          <Button variant="outline" onClick={handleReset} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Nouvelle consultation
          </Button>
          <ConsultationReport
            data={reportData}
            type={mode!}
            onNewConsultation={handleReset}
          />
        </div>
      </div>
    );
  }

  // ─── MODE SELECTION ───
  if (!mode) {
    return (
      <div className="min-h-0 bg-background pb-8">
        <div className="max-w-xl mx-auto px-4 py-6">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-foreground">Consultation douanière</h1>
            <p className="text-sm text-muted-foreground mt-1">Quel type de consultation souhaitez-vous ?</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {MODES.map(m => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelectMode(m.id)}
                  className="flex flex-col items-center gap-2 p-5 rounded-2xl border-2 border-border bg-card cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md text-center"
                >
                  <Icon className="h-7 w-7 text-muted-foreground" />
                  <span className="text-sm font-semibold text-foreground">{m.title}</span>
                  <span className="text-xs text-muted-foreground leading-tight">{m.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ─── WIZARD STEPS ───
  const renderStepContent = () => {
    const sid = currentStep?.id;

    // === IMPORT ===
    if (mode === "import") {
      if (sid === "product") return (
        <StepCard title="Décrivez votre produit" desc="Soyez le plus précis possible pour une classification exacte">
          <Field label="Description du produit *">
            <Textarea placeholder="Ex: Écran LCD 55 pouces 4K, Samsung, avec support mural" value={form.product_description || ""} onChange={e => update("product_description", e.target.value)} rows={3} className="resize-none" />
          </Field>
          <Field label="Code SH (si vous le connaissez)">
            <Input placeholder="Ex: 8528.72.00.00" value={form.hs_code || ""} onChange={e => update("hs_code", e.target.value)} />
          </Field>
        </StepCard>
      );
      if (sid === "origin") return (
        <StepCard title="Origine et valeur" desc="D'où vient le produit et combien coûte-t-il ?">
          <Field label="Pays d'origine *">
            <Select value={form.country_code || ""} onValueChange={v => update("country_code", v)}>
              <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
              <SelectContent>{COUNTRIES.map(c => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Valeur de la marchandise *">
            <div className="flex gap-2">
              <Input type="number" placeholder="50 000" value={form.value || ""} onChange={e => update("value", e.target.value)} className="flex-1" />
              <Select value={form.currency || "EUR"} onValueChange={v => update("currency", v)}>
                <SelectTrigger className="w-[80px]"><SelectValue /></SelectTrigger>
                <SelectContent>{["EUR","USD","MAD","GBP","CNY","AED"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Incoterm">
              <Select value={form.incoterm || "FOB"} onValueChange={v => update("incoterm", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["FOB","CIF","EXW","CFR","CIP","DAP","DDP"].map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Accord préférentiel">
              <Select value={form.agreement || "none"} onValueChange={v => update("agreement", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Aucun</SelectItem>
                  <SelectItem value="UE-MA">UE-Maroc</SelectItem>
                  <SelectItem value="US-MA">USA-Maroc</SelectItem>
                  <SelectItem value="TR-MA">Turquie-Maroc</SelectItem>
                  <SelectItem value="AELE">AELE</SelectItem>
                  <SelectItem value="AGADIR">Agadir</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </StepCard>
      );
      if (sid === "details") return (
        <StepCard title="Détails complémentaires" desc="Optionnel — améliore la précision du calcul">
          {canSkipDetails() && <SkipBanner onSkip={skipToReview} />}
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Fret (${form.currency})`}>
              <Input type="number" placeholder="Calculé auto" value={form.freight || ""} onChange={e => update("freight", e.target.value)} />
            </Field>
            <Field label={`Assurance (${form.currency})`}>
              <Input type="number" placeholder="0.5% auto" value={form.insurance || ""} onChange={e => update("insurance", e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantité">
              <Input type="number" placeholder="Optionnel" value={form.quantity || ""} onChange={e => update("quantity", e.target.value)} />
            </Field>
            <Field label="Poids net (kg)">
              <Input type="number" placeholder="Optionnel" value={form.weight || ""} onChange={e => update("weight", e.target.value)} />
            </Field>
          </div>
          <Field label="Régime douanier">
            <Select value={form.regime || "mise_consommation"} onValueChange={v => update("regime", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mise_consommation">Mise à la consommation</SelectItem>
                <SelectItem value="admission_temporaire">Admission temporaire</SelectItem>
                <SelectItem value="entrepot">Entrepôt sous douane</SelectItem>
                <SelectItem value="zone_franche">Zone franche</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </StepCard>
      );
    }

    // === MRE ===
    if (mode === "mre") {
      if (sid === "type") return (
        <StepCard title="Que souhaitez-vous importer ?" desc="Sélectionnez le type de bien">
          <div className="grid grid-cols-3 gap-3">
            {([
              { id: "vehicle" as const, icon: Car, label: "Véhicule" },
              { id: "personal_effects" as const, icon: Sofa, label: "Effets personnels" },
              { id: "both" as const, icon: Package, label: "Les deux" },
            ]).map(opt => (
              <button key={opt.id} type="button" onClick={() => update("import_type", opt.id)}
                className={cn("flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all",
                  form.import_type === opt.id ? "border-secondary bg-secondary/5" : "border-border hover:border-secondary/30")}>
                <opt.icon className={cn("h-5 w-5", form.import_type === opt.id ? "text-secondary" : "text-muted-foreground")} />
                <span className="text-xs font-semibold">{opt.label}</span>
              </button>
            ))}
          </div>
        </StepCard>
      );
      if (sid === "details") {
        const showVehicle = form.import_type === "vehicle" || form.import_type === "both";
        const showEffects = form.import_type === "personal_effects" || form.import_type === "both";
        return (
          <StepCard title={showVehicle && showEffects ? "Véhicule & effets" : showVehicle ? "Votre véhicule" : "Vos effets personnels"} desc="Décrivez ce que vous importez">
            {showVehicle && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Marque / Modèle *">
                    <Input placeholder="Ex: Renault Clio V" value={form.vehicle_brand || ""} onChange={e => update("vehicle_brand", e.target.value)} />
                  </Field>
                  <Field label="Valeur estimée *">
                    <div className="flex gap-1.5">
                      <Input type="number" placeholder="15 000" value={form.vehicle_value || ""} onChange={e => update("vehicle_value", e.target.value)} className="flex-1" />
                      <Select value={form.vehicle_currency || "EUR"} onValueChange={v => update("vehicle_currency", v)}>
                        <SelectTrigger className="w-[80px]"><SelectValue /></SelectTrigger>
                        <SelectContent>{["EUR","USD","GBP","CAD","AED","CHF"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </Field>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Année">
                    <Select value={form.vehicle_year || ""} onValueChange={v => update("vehicle_year", v)}>
                      <SelectTrigger><SelectValue placeholder="---" /></SelectTrigger>
                      <SelectContent>{Array.from({ length: 15 }, (_, i) => 2026 - i).map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                  <Field label="Motorisation">
                    <Select value={form.vehicle_fuel || "essence"} onValueChange={v => update("vehicle_fuel", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="essence">Essence</SelectItem>
                        <SelectItem value="diesel">Diesel</SelectItem>
                        <SelectItem value="hybride">Hybride</SelectItem>
                        <SelectItem value="electrique">Électrique</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Cylindrée (cm³)">
                    <Input type="number" placeholder="1600" value={form.vehicle_cc || ""} onChange={e => update("vehicle_cc", e.target.value)} />
                  </Field>
                </div>
              </>
            )}
            {showEffects && (
              <Field label="Description des effets *">
                <Textarea placeholder="Meubles, électroménager, vêtements..." value={form.effects_description || ""} onChange={e => update("effects_description", e.target.value)} rows={2} className="resize-none" />
              </Field>
            )}
          </StepCard>
        );
      }
      if (sid === "situation") return (
        <StepCard title="Votre situation MRE" desc="Nécessaire pour vérifier vos droits">
          <Field label="Pays de résidence *">
            <Select value={form.residence_country || ""} onValueChange={v => update("residence_country", v)}>
              <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
              <SelectContent>{COUNTRIES.map(c => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Durée de résidence">
              <Select value={form.residence_years || ""} onValueChange={v => update("residence_years", v)}>
                <SelectTrigger><SelectValue placeholder="---" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="<1">Moins d'1 an</SelectItem>
                  <SelectItem value="1-2">1 à 2 ans</SelectItem>
                  <SelectItem value="2-5">2 à 5 ans</SelectItem>
                  <SelectItem value=">5">Plus de 5 ans</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Type de retour">
              <Select value={form.return_type || "definitif"} onValueChange={v => update("return_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="definitif">Retour définitif</SelectItem>
                  <SelectItem value="temporaire">Retour temporaire</SelectItem>
                  <SelectItem value="vacances">Vacances</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </StepCard>
      );
    }

    // === CONFORMITY ===
    if (mode === "conformity") {
      if (sid === "product") return (
        <StepCard title="Produit à vérifier" desc="L'IA identifiera les contrôles applicables (ONSSA, ANRT, CoC...)">
          <Field label="Description du produit *">
            <Textarea placeholder="Ex: Routeur Wi-Fi 6 double bande avec antenne externe" value={form.product_description || ""} onChange={e => update("product_description", e.target.value)} rows={3} className="resize-none" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code SH (optionnel)">
              <Input placeholder="Ex: 8517.62" value={form.hs_code || ""} onChange={e => update("hs_code", e.target.value)} />
            </Field>
            <Field label="Pays d'origine">
              <Select value={form.country_code || ""} onValueChange={v => update("country_code", v)}>
                <SelectTrigger><SelectValue placeholder="Tous pays" /></SelectTrigger>
                <SelectContent>{COUNTRIES.map(c => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
        </StepCard>
      );
    }

    // === INVESTOR ===
    if (mode === "investor") {
      if (sid === "project") return (
        <StepCard title="Votre projet d'investissement" desc="Secteur et zone d'implantation">
          <Field label="Secteur d'activité *">
            <Select value={form.sector || ""} onValueChange={v => update("sector", v)}>
              <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
              <SelectContent>
                {["automobile","aeronautique","textile","agroalimentaire","electronique","chimie","btp","energie","logistique","autre"].map(s =>
                  <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Zone d'implantation">
            <Select value={form.zone || ""} onValueChange={v => update("zone", v)}>
              <SelectTrigger><SelectValue placeholder="Non déterminée" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="tanger_free_zone">Tanger Free Zone</SelectItem>
                <SelectItem value="casablanca_finance">CFC Casablanca</SelectItem>
                <SelectItem value="kenitra_atlantic">Atlantic Free Zone Kénitra</SelectItem>
                <SelectItem value="midparc">MidParc Nouaceur</SelectItem>
                <SelectItem value="zone_industrielle">Zone industrielle classique</SelectItem>
                <SelectItem value="hors_zone">Hors zone spéciale</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </StepCard>
      );
      if (sid === "material") return (
        <StepCard title="Matériel à importer" desc="Décrivez le matériel pour comparer les régimes">
          <Field label="Description du matériel *">
            <Textarea placeholder="Ex: Machine CNC 5 axes, ligne d'assemblage..." value={form.material_description || ""} onChange={e => update("material_description", e.target.value)} rows={3} className="resize-none" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Code SH">
              <Input placeholder="8456.10" value={form.material_hs_code || ""} onChange={e => update("material_hs_code", e.target.value)} />
            </Field>
            <Field label="Valeur">
              <Input type="number" placeholder="500 000" value={form.material_value || ""} onChange={e => update("material_value", e.target.value)} />
            </Field>
            <Field label="Devise">
              <Select value={form.material_currency || "EUR"} onValueChange={v => update("material_currency", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["EUR","USD","GBP","CNY","JPY"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
        </StepCard>
      );
    }

    // === DOCUMENTS (shared) ===
    if (sid === "documents") return (
      <StepCard title="Documents" desc="Optionnel — l'IA les utilise pour améliorer la précision">
        <SkipBanner onSkip={next} label="Les documents sont optionnels. Vous pouvez passer cette étape." />
        <ConsultationFileUpload files={files} onFilesChange={setFiles} />
      </StepCard>
    );

    // === REVIEW (shared) ===
    if (sid === "review") return (
      <StepCard title="Vérifiez et lancez" desc="Tout est bon ? Lancez la génération du rapport">
        {mode === "import" && (
          <>
            <ReviewSection label="Produit" onEdit={() => goToStep(0)}>
              <p className="text-sm font-medium text-foreground">{form.product_description || "—"}</p>
              {form.hs_code && <p className="text-xs text-muted-foreground">Code SH: {form.hs_code}</p>}
            </ReviewSection>
            <ReviewSection label="Origine & Valeur" onEdit={() => goToStep(1)}>
              <ReviewRow label="Pays" value={getCountryName(form.country_code)} />
              <ReviewRow label="Valeur" value={form.value ? `${Number(form.value).toLocaleString()} ${form.currency}` : "—"} />
              <ReviewRow label="Incoterm" value={form.incoterm} />
              {form.agreement !== "none" && <ReviewRow label="Accord" value={form.agreement} />}
            </ReviewSection>
          </>
        )}
        {mode === "mre" && (
          <>
            <ReviewSection label="Import">
              <p className="text-sm font-medium text-foreground">{form.import_type === "vehicle" ? "Véhicule" : form.import_type === "personal_effects" ? "Effets personnels" : "Véhicule + Effets"}</p>
              {form.vehicle_brand && <p className="text-xs text-muted-foreground">{form.vehicle_brand} — {form.vehicle_value ? `${Number(form.vehicle_value).toLocaleString()} ${form.vehicle_currency}` : ""}</p>}
              {form.effects_description && <p className="text-xs text-muted-foreground">{form.effects_description}</p>}
            </ReviewSection>
            <ReviewSection label="Situation">
              <p className="text-sm font-medium text-foreground">{getCountryName(form.residence_country)}</p>
              <p className="text-xs text-muted-foreground">Retour {form.return_type}</p>
            </ReviewSection>
          </>
        )}
        {mode === "conformity" && (
          <ReviewSection label="Produit">
            <p className="text-sm font-medium text-foreground">{form.product_description || "—"}</p>
            {form.country_code && <p className="text-xs text-muted-foreground">Origine: {getCountryName(form.country_code)}</p>}
          </ReviewSection>
        )}
        {mode === "investor" && (
          <>
            <ReviewSection label="Projet">
              <p className="text-sm font-medium text-foreground">{form.sector ? form.sector.charAt(0).toUpperCase() + form.sector.slice(1) : "—"}</p>
              {form.zone && <p className="text-xs text-muted-foreground">Zone: {form.zone.replace(/_/g, " ")}</p>}
            </ReviewSection>
            <ReviewSection label="Matériel">
              <p className="text-sm font-medium text-foreground">{form.material_description || "—"}</p>
              {form.material_value && <p className="text-xs text-muted-foreground">Valeur: {Number(form.material_value).toLocaleString()} {form.material_currency}</p>}
            </ReviewSection>
          </>
        )}
        {files.length > 0 && (
          <ReviewSection label="Documents">
            <p className="text-sm text-foreground">{files.length} fichier(s) joint(s)</p>
          </ReviewSection>
        )}
        <Button className="w-full mt-4 gap-2" size="lg" onClick={handleSubmit}>
          <Sparkles className="h-4 w-4" /> Générer le rapport
        </Button>
      </StepCard>
    );

    return null;
  };

  return (
    <div className="min-h-0 bg-background pb-8">
      <div className="max-w-xl mx-auto px-4 py-6">
        {/* Header with back */}
        <div className="flex items-center gap-3 mb-6">
          <Button variant="outline" size="icon" onClick={step === 0 ? handleReset : prev} className="shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-bold text-foreground">{modeInfo?.title}</h1>
            <p className="text-xs text-muted-foreground">Étape {step + 1} sur {steps.length}</p>
          </div>
        </div>

        {/* Stepper */}
        <div className="mb-10">
          <WizardStepper steps={steps} currentStep={step} onStepClick={goToStep} />
        </div>

        {/* Step content */}
        <div className="animate-fade-in">{renderStepContent()}</div>

        {/* Navigation */}
        {currentStep?.id !== "review" && (
          <div className="flex justify-end mt-6">
            <Button onClick={next} disabled={!canProceed()} className="gap-2">
              Continuer <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helper components ───
function StepCard({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-2xl p-6 border border-border shadow-sm space-y-4">
      <div>
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
    </div>
  );
}

function SkipBanner({ onSkip, label }: { onSkip: () => void; label?: string }) {
  return (
    <div className="flex items-center gap-3 p-3.5 rounded-xl bg-success/5 border border-success/20">
      <Sparkles className="h-4 w-4 text-success shrink-0" />
      <span className="text-sm text-success font-medium flex-1">{label || "Vous avez renseigné l'essentiel. Ces détails sont optionnels."}</span>
      <Button variant="ghost" size="sm" onClick={onSkip} className="text-success hover:text-success shrink-0">
        Passer →
      </Button>
    </div>
  );
}

function ReviewSection({ label, onEdit, children }: { label: string; onEdit?: () => void; children: React.ReactNode }) {
  return (
    <div className="p-4 rounded-xl bg-muted/30 border border-border/50 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
        {onEdit && (
          <button onClick={onEdit} className="flex items-center gap-1 text-xs text-primary font-medium hover:underline">
            <Pencil className="h-3 w-3" /> Modifier
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}
