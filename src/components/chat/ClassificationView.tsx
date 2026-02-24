import { useState, useMemo, useRef } from "react";
import {
  Search, Loader2, Check, ChevronDown, ChevronRight, BookOpen, Scale,
  FileText, Database, ArrowLeft, Sparkles, ImagePlus, X, ArrowRight,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { getAuthHeaders } from "@/lib/authHeaders";
import { useToast } from "@/hooks/use-toast";
import { WizardStepper, type WizardStep } from "@/components/consultation/WizardStepper";

// ── Types ──
interface Source {
  type: "rgi" | "note" | "circulaire" | "db";
  ref: string;
  text: string;
}
interface Alternative {
  hs_code: string;
  description: string;
  score: number;
  duty_rate: number;
  reasoning: string;
  sources: Source[];
}
interface ClassificationResult {
  query: string;
  confidence: "high" | "medium" | "low";
  alternatives: Alternative[];
  ai_extracted_info?: string;
}

interface UploadedFile {
  file: File;
  preview: string;
  type: "image" | "document";
}

const SOURCE_BADGE: Record<string, { className: string; label: string; icon: any }> = {
  rgi: { className: "bg-primary/15 text-primary", label: "RGI", icon: Scale },
  note: { className: "bg-warning/15 text-warning", label: "Note", icon: BookOpen },
  circulaire: { className: "bg-secondary/15 text-secondary", label: "Circulaire", icon: FileText },
  db: { className: "bg-success/15 text-success", label: "Base données", icon: Database },
};

const CLASSIFY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/classify`;

// ── File helpers ──
const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

// ── Smart Questions ──
interface QuestionOption {
  label: string;
  value?: string;
  subQuestions?: SmartQuestion[];
}
interface SmartQuestion {
  id: string;
  question: string;
  hint?: string;
  type: "choice" | "text" | "upload";
  options?: QuestionOption[];
  placeholder?: string;
  required?: boolean;
  skipLabel?: string;
}

const QUESTIONS: SmartQuestion[] = [
  {
    id: "category",
    question: "Quelle est la catégorie du produit ?",
    type: "choice",
    required: true,
    options: [
      {
        label: "Électronique & Tech",
        subQuestions: [
          { id: "tech_type", question: "Quel type d'appareil ?", type: "choice", options: [
            { label: "Téléphone / Tablette" },
            { label: "Ordinateur / Serveur" },
            { label: "TV / Écran / Moniteur" },
            { label: "Composants / Pièces" },
            { label: "Autre électronique" },
          ]},
        ],
      },
      {
        label: "Machines & Équipements",
        subQuestions: [
          { id: "machine_type", question: "Quel type de machine ?", type: "choice", options: [
            { label: "Machine industrielle" },
            { label: "Machine agricole" },
            { label: "Outillage" },
            { label: "Véhicule / Transport" },
          ]},
        ],
      },
      {
        label: "Textile & Habillement",
        subQuestions: [
          { id: "textile_type", question: "Quel type de textile ?", type: "choice", options: [
            { label: "Vêtements" },
            { label: "Tissus / Matières premières" },
            { label: "Accessoires (sacs, chaussures)" },
            { label: "Linge de maison" },
          ]},
        ],
      },
      {
        label: "Alimentaire",
        subQuestions: [
          { id: "food_type", question: "Quel type de produit alimentaire ?", type: "choice", options: [
            { label: "Fruits & Légumes" },
            { label: "Viande & Poisson" },
            { label: "Céréales & Farines" },
            { label: "Boissons" },
            { label: "Produits transformés" },
          ]},
        ],
      },
      {
        label: "Chimie & Pharma",
        subQuestions: [
          { id: "chem_type", question: "Quel type de produit ?", type: "choice", options: [
            { label: "Médicament" },
            { label: "Cosmétique / Hygiène" },
            { label: "Produit chimique brut" },
            { label: "Engrais / Pesticide" },
          ]},
        ],
      },
      {
        label: "Matériaux de construction",
        subQuestions: [
          { id: "build_type", question: "Quel type de matériau ?", type: "choice", options: [
            { label: "Métaux (acier, aluminium…)" },
            { label: "Bois" },
            { label: "Plastiques" },
            { label: "Céramique / Verre" },
          ]},
        ],
      },
      { label: "Autre catégorie" },
    ],
  },
  {
    id: "description",
    question: "Décrivez précisément le produit",
    hint: "Marque, modèle, caractéristiques techniques",
    type: "text",
    placeholder: "Ex: Samsung QN55Q80B, TV QLED 55\" 4K, avec tuner TNT intégré",
    required: true,
  },
  {
    id: "material",
    question: "Quelle est la matière principale ?",
    hint: "La matière détermine souvent le chapitre SH",
    type: "choice",
    options: [
      { label: "Plastique / Polymère", value: "plastique" },
      { label: "Métal (acier, alu, cuivre…)", value: "métal" },
      { label: "Bois", value: "bois" },
      { label: "Textile (coton, synthétique…)", value: "textile" },
      { label: "Verre / Céramique", value: "verre/céramique" },
      { label: "Cuir", value: "cuir" },
      { label: "Papier / Carton", value: "papier" },
      { label: "Mixte / Composite", value: "composite" },
    ],
    skipLabel: "Je ne sais pas",
  },
  {
    id: "condition",
    question: "Quel est l'état du produit ?",
    hint: "L'état peut impacter la classification et les droits",
    type: "choice",
    options: [
      { label: "Neuf", value: "neuf" },
      { label: "Occasion", value: "occasion" },
      { label: "Reconditionné", value: "reconditionné" },
      { label: "En pièces détachées", value: "en pièces détachées" },
    ],
    skipLabel: "Non pertinent",
  },
  {
    id: "packaging",
    question: "Comment le produit est-il conditionné ?",
    hint: "Le conditionnement peut influencer la sous-position",
    type: "choice",
    options: [
      { label: "Unité / À la pièce" },
      { label: "En vrac" },
      { label: "Lot / Assortiment" },
      { label: "En kit (à assembler)" },
    ],
    skipLabel: "Passer",
  },
  {
    id: "weight",
    question: "Poids et quantité approximatifs ?",
    type: "text",
    placeholder: "Ex: 15 kg, 100 unités, 2 palettes…",
    skipLabel: "Passer",
  },
  {
    id: "usage",
    question: "Quelle est l'utilisation prévue ?",
    type: "choice",
    options: [
      { label: "Usage industriel" },
      { label: "Usage commercial (revente)" },
      { label: "Usage personnel" },
      { label: "Usage agricole" },
    ],
    skipLabel: "Passer",
  },
  {
    id: "origin",
    question: "Quel est le pays d'origine ?",
    type: "text",
    placeholder: "Ex: Chine, Turquie, France…",
    skipLabel: "Passer",
  },
  {
    id: "documents",
    question: "Avez-vous des documents à joindre ?",
    hint: "Facture, fiche technique ou photo — l'IA les analysera pour affiner la classification",
    type: "upload",
    skipLabel: "Non, classifier maintenant",
  },
  {
    id: "hs_hint",
    question: "Avez-vous une idée du code SH ?",
    type: "text",
    placeholder: "Ex: 8528 (optionnel)",
    skipLabel: "Non, laisser l'IA décider",
  },
];

// ── Wizard steps for stepper ──
const WIZARD_STEPS: WizardStep[] = [
  { id: "product", label: "Produit", required: true },
  { id: "details", label: "Détails", required: false },
  { id: "documents", label: "Documents", required: false },
  { id: "classify", label: "Classifier", required: true },
];

// Map question IDs to wizard step indices
const getWizardStepIndex = (questionId: string): number => {
  if (["category", "description"].includes(questionId)) return 0;
  if (["material", "condition", "packaging", "weight", "usage", "origin"].includes(questionId)) return 1;
  if (questionId === "documents") return 2;
  return 3; // hs_hint => classify
};

// ── Component ──
export function ClassificationView() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState("");
  const [result, setResult] = useState<ClassificationResult | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  // Build the active question list (with dynamic sub-questions)
  const activeQuestions = useMemo(() => {
    const list: SmartQuestion[] = [];
    for (const q of QUESTIONS) {
      list.push(q);
      if (q.id === "category" && answers.category) {
        const selectedOpt = q.options?.find(o => o.label === answers.category);
        if (selectedOpt?.subQuestions) {
          list.splice(list.length, 0, ...selectedOpt.subQuestions);
        }
      }
    }
    return list;
  }, [answers.category]);

  const currentQ = activeQuestions[step];
  const totalSteps = activeQuestions.length;
  const wizardStepIndex = currentQ ? getWizardStepIndex(currentQ.id) : 0;
  // Also check sub-question IDs
  const getWizardStepForQ = (q: SmartQuestion) => {
    if (["tech_type", "machine_type", "textile_type", "food_type", "chem_type", "build_type"].includes(q.id)) return 0;
    return getWizardStepIndex(q.id);
  };
  const currentWizardStep = currentQ ? getWizardStepForQ(currentQ) : 0;

  // Build enriched description from all answers
  const buildDescription = () => {
    const parts: string[] = [];
    if (answers.category) parts.push(`Catégorie: ${answers.category}`);
    for (const q of activeQuestions) {
      if (!["category", "description", "usage", "origin", "hs_hint", "documents", "weight", "material", "condition", "packaging"].includes(q.id) && answers[q.id]) {
        parts.push(`Sous-type: ${answers[q.id]}`);
      }
    }
    if (answers.description) parts.push(`Description: ${answers.description}`);
    if (answers.material) parts.push(`Matière principale: ${answers.material}`);
    if (answers.condition) parts.push(`État: ${answers.condition}`);
    if (answers.packaging) parts.push(`Conditionnement: ${answers.packaging}`);
    if (answers.weight) parts.push(`Poids/Quantité: ${answers.weight}`);
    if (answers.usage) parts.push(`Usage: ${answers.usage}`);
    return parts.join(". ");
  };

  const canProceed = () => {
    if (!currentQ) return false;
    if (currentQ.required && !answers[currentQ.id]?.trim()) return false;
    return true;
  };

  const handleNext = () => {
    if (step < totalSteps - 1) setStep(step + 1);
    else classify();
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleSkip = () => {
    if (step < totalSteps - 1) setStep(step + 1);
    else classify();
  };

  const selectOption = (label: string) => {
    const opt = currentQ?.options?.find(o => o.label === label);
    setAnswers(prev => ({ ...prev, [currentQ.id]: opt?.value || label }));
    setTimeout(() => {
      if (step < totalSteps - 1) setStep(s => s + 1);
    }, 200);
  };

  // File upload handlers
  const handleFileSelect = (files: FileList | null, type: "image" | "document") => {
    if (!files) return;
    const processed: UploadedFile[] = Array.from(files).map(file => ({
      file,
      preview: URL.createObjectURL(file),
      type,
    }));
    setUploadedFiles(prev => [...prev, ...processed]);
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => {
      const f = prev[index];
      if (f?.preview.startsWith("blob:")) URL.revokeObjectURL(f.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  // ── CLASSIFY ──
  const classify = async () => {
    const desc = buildDescription();
    if (!desc.trim() || loading) return;
    setLoading(true);
    setResult(null);
    setExpanded(null);
    setSelected(null);

    try {
      const headers = await getAuthHeaders(true);

      // Prepare files as base64
      setLoadingStage("Préparation des documents...");
      const images: { base64: string; mediaType: string }[] = [];
      const pdfs: { base64: string; fileName: string }[] = [];

      for (const uf of uploadedFiles) {
        const b64 = await fileToBase64(uf.file);
        if (uf.type === "image" || uf.file.type.startsWith("image/")) {
          images.push({ base64: b64, mediaType: uf.file.type || "image/jpeg" });
        } else if (uf.file.type === "application/pdf") {
          pdfs.push({ base64: b64, fileName: uf.file.name });
        }
      }

      setLoadingStage("Classification en cours...");

      const res = await fetch(CLASSIFY_URL, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          description: desc.trim(),
          hs_code_hint: answers.hs_hint?.trim() || undefined,
          origin_country: answers.origin?.trim() || undefined,
          material: answers.material?.trim() || undefined,
          condition: answers.condition?.trim() || undefined,
          packaging: answers.packaging?.trim() || undefined,
          weight_info: answers.weight?.trim() || undefined,
          usage: answers.usage?.trim() || undefined,
          images: images.length > 0 ? images : undefined,
          pdf_documents: pdfs.length > 0 ? pdfs : undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Erreur ${res.status}`);
      }

      const data: ClassificationResult = await res.json();
      setResult(data);
      if (data.alternatives.length > 0) {
        setSelected(data.alternatives[0].hs_code);
      }
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
      setLoadingStage("");
    }
  };

  const handleValidate = async () => {
    if (!selected || !result || saving) return;
    setSaving(true);
    try {
      const desc = buildDescription();
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("classification_history").insert({
        question: desc,
        product_description: desc,
        suggested_code: result.alternatives[0]?.hs_code,
        confirmed_code: selected,
        was_correct: selected === result.alternatives[0]?.hs_code,
        session_id: sessionStorage.getItem("chat_session_id"),
        user_id: user?.id,
      });
      if (error) throw error;
      toast({ title: "Classification sauvegardée", description: `Code ${selected} confirmé.` });
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setStep(0);
    setAnswers({});
    setUploadedFiles([]);
    setResult(null);
    setExpanded(null);
    setSelected(null);
  };

  // ════════════════════════════════════════════════
  // FORM: Wizard — same design as ConsultationWizard
  // ════════════════════════════════════════════════
  if (!result && !loading) {
    return (
      <div className="flex-1 overflow-auto page-gradient pb-8">
        <div className="max-w-xl mx-auto px-4 py-6 md:py-8">
          {/* Header with back */}
          <div className="flex items-center gap-3 mb-6">
            {step > 0 && (
              <Button variant="outline" size="icon" onClick={handleBack} className="shrink-0 rounded-xl">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div>
              <h1 className="text-lg font-extrabold text-foreground">Classification tarifaire</h1>
              <p className="text-xs text-muted-foreground">Étape {step + 1} sur {totalSteps}</p>
            </div>
          </div>

          {/* Stepper */}
          <div className="mb-10">
            <WizardStepper
              steps={WIZARD_STEPS}
              currentStep={currentWizardStep}
              onStepClick={() => {}}
            />
          </div>

          {/* Question Card */}
          <div className="card-elevated p-5 md:p-6 space-y-4 animate-fade-in">
            <div>
              <h2 className="text-base md:text-lg font-extrabold text-card-foreground">{currentQ?.question}</h2>
              {currentQ?.hint && (
                <p className="text-xs md:text-sm text-muted-foreground mt-0.5">{currentQ.hint}</p>
              )}
            </div>

            {/* Type: choice */}
            {currentQ?.type === "choice" && currentQ.options && (
              <div className="grid grid-cols-2 gap-3">
                {currentQ.options.map((opt) => {
                  const isSelected = answers[currentQ.id] === (opt.value || opt.label);
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => selectOption(opt.label)}
                      className={cn(
                        "flex items-center gap-2.5 p-4 rounded-xl border-2 text-left transition-all",
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/30"
                      )}
                    >
                      <span className="text-xs font-semibold text-foreground leading-tight">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Type: text */}
            {currentQ?.type === "text" && (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">{currentQ.id === "description" ? "Description du produit *" : ""}</Label>
                {currentQ.id === "description" ? (
                  <Textarea
                    rows={3}
                    placeholder={currentQ.placeholder}
                    value={answers[currentQ.id] || ""}
                    onChange={(e) => setAnswers(prev => ({ ...prev, [currentQ.id]: e.target.value }))}
                    className="resize-none"
                  />
                ) : (
                  <Input
                    placeholder={currentQ.placeholder}
                    value={answers[currentQ.id] || ""}
                    onChange={(e) => setAnswers(prev => ({ ...prev, [currentQ.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && canProceed() && handleNext()}
                  />
                )}
              </div>
            )}

            {/* Type: upload */}
            {currentQ?.type === "upload" && (
              <div className="space-y-4">
                {/* Preview uploaded files */}
                {uploadedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 p-3 bg-muted/30 rounded-xl border border-border/50">
                    {uploadedFiles.map((uf, i) => (
                      <div key={i} className="relative group flex items-center gap-2 bg-card rounded-lg p-2 pr-7 border border-border/50">
                        {uf.type === "image" ? (
                          <img src={uf.preview} alt="" className="w-10 h-10 object-cover rounded-md" />
                        ) : (
                          <div className="w-10 h-10 flex items-center justify-center bg-primary/10 rounded-md">
                            <FileText className="h-5 w-5 text-primary" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <span className="text-xs font-medium text-foreground block max-w-[100px] truncate">{uf.file.name}</span>
                          <span className="text-[10px] text-muted-foreground">{(uf.file.size / 1024).toFixed(0)} KB</span>
                        </div>
                        <button onClick={() => removeFile(i)}
                          className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Upload buttons */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer"
                  >
                    <ImagePlus className="h-6 w-6 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">Photo produit</span>
                    <span className="text-[10px] text-muted-foreground/60">JPG, PNG</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => docInputRef.current?.click()}
                    className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer"
                  >
                    <FileText className="h-6 w-6 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">Document</span>
                    <span className="text-[10px] text-muted-foreground/60">PDF, facture</span>
                  </button>
                </div>

                {/* IA info */}
                <div className="flex items-center gap-3 p-3.5 rounded-xl bg-success/5 border border-success/20">
                  <Sparkles className="h-4 w-4 text-success shrink-0" />
                  <span className="text-sm text-success font-medium flex-1">
                    L'IA analysera vos documents pour extraire les informations et affiner la classification.
                  </span>
                </div>

                {/* Hidden inputs */}
                <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={(e) => handleFileSelect(e.target.files, "image")} />
                <input ref={docInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" multiple className="hidden"
                  onChange={(e) => handleFileSelect(e.target.files, "document")} />
              </div>
            )}

            {/* Answers recap */}
            {Object.keys(answers).length > 0 && (
              <div className="p-4 rounded-xl bg-muted/30 border border-border/50 space-y-1">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Vos réponses</span>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {Object.entries(answers).filter(([, v]) => v.trim()).map(([key, val]) => (
                    <Badge key={key} variant="outline" className="text-[10px] bg-muted/50 text-foreground border-border">
                      {val.length > 25 ? val.substring(0, 25) + "…" : val}
                    </Badge>
                  ))}
                  {uploadedFiles.length > 0 && (
                    <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20">
                      {uploadedFiles.length} fichier{uploadedFiles.length > 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Navigation — same style as ConsultationWizard */}
          <div className="flex items-center justify-between mt-6">
            {currentQ?.skipLabel && !currentQ?.required && (
              <Button variant="ghost" size="sm" onClick={handleSkip} className="text-primary hover:text-primary">
                {currentQ.skipLabel} →
              </Button>
            )}
            <div className="flex-1" />
            {(currentQ?.type === "text" || currentQ?.type === "upload") && (
              <Button
                onClick={handleNext}
                disabled={currentQ.required && !answers[currentQ.id]?.trim() && currentQ.type !== "upload"}
                className={cn(
                  "cta-gradient rounded-xl gap-2 px-6",
                  step === totalSteps - 1 ? "h-14 text-base font-semibold rounded-2xl" : ""
                )}
              >
                {step === totalSteps - 1 ? (
                  <>
                    <Search className="h-4 w-4" />
                    Classifier {uploadedFiles.length > 0 ? `(${uploadedFiles.length} doc${uploadedFiles.length > 1 ? "s" : ""})` : ""}
                  </>
                ) : (
                  <>
                    Continuer <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════
  // LOADING — with stages
  // ════════════════════════════════════════════════
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 pb-20 md:pb-0">
        <div className="text-center animate-in fade-in duration-300 max-w-xs">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
          <p className="text-sm font-semibold text-foreground">{loadingStage || "Classification en cours..."}</p>
          <p className="text-xs text-muted-foreground mt-1">Analyse RGI, notes de section, base tarifaire</p>
          {uploadedFiles.length > 0 && (
            <p className="text-xs text-primary mt-2">
              Analyse de {uploadedFiles.length} document{uploadedFiles.length > 1 ? "s" : ""} en cours...
            </p>
          )}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════
  // RESULTS (same as before)
  // ════════════════════════════════════════════════
  return (
    <div className="flex-1 overflow-auto px-4 py-4 pb-24 md:pb-6">
      <div className="max-w-lg mx-auto animate-in fade-in duration-300">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className={cn(
              "text-[10px] font-bold uppercase tracking-wider",
              result!.confidence === "high" ? "text-success" :
              result!.confidence === "medium" ? "text-warning" : "text-destructive"
            )}>
              {result!.confidence === "high" ? "Confiance élevée" :
               result!.confidence === "medium" ? `Cas ambigu — ${result!.alternatives.length} codes` :
               `Confiance faible — ${result!.alternatives.length} codes`}
            </span>
            <h3 className="text-base font-bold text-foreground mt-0.5">Résultat</h3>
          </div>
          <Button variant="outline" size="sm" onClick={reset} className="text-xs rounded-lg">
            Nouveau
          </Button>
        </div>

        {/* Product recap */}
        <div className="bg-muted/40 rounded-xl px-3 py-2.5 mb-3 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Produit :</span> {result!.query}
        </div>

        {/* Extracted info from documents */}
        {result!.ai_extracted_info && (
          <div className="bg-primary/5 rounded-xl px-3 py-2.5 mb-3 border border-primary/10">
            <div className="flex items-center gap-1.5 mb-1">
              <Sparkles className="h-3 w-3 text-primary" />
              <span className="text-[10px] font-bold text-primary uppercase tracking-wider">Extrait des documents</span>
            </div>
            <p className="text-xs text-foreground/80 leading-relaxed">{result!.ai_extracted_info}</p>
          </div>
        )}

        {/* Alternatives */}
        <div className="space-y-2">
          {result!.alternatives.map((alt, i) => {
            const isExp = expanded === alt.hs_code;
            const isSel = selected === alt.hs_code;
            const scoreColor = alt.score >= 60 ? "text-success" : alt.score >= 25 ? "text-warning" : "text-muted-foreground";
            const barColor = alt.score >= 60 ? "bg-success" : alt.score >= 25 ? "bg-warning" : "bg-muted-foreground/30";

            return (
              <div
                key={alt.hs_code}
                className={cn(
                  "bg-card rounded-xl border overflow-hidden transition-all duration-200",
                  isSel ? "border-primary ring-2 ring-primary/10" : "border-border"
                )}
              >
                <button
                  onClick={() => setExpanded(isExp ? null : alt.hs_code)}
                  className="w-full flex items-center gap-3 p-3.5 text-left"
                >
                  <div className="w-11 text-center shrink-0">
                    <div className={cn("text-xl font-black leading-none", scoreColor)}>{alt.score}</div>
                    <div className="text-[9px] text-muted-foreground">%</div>
                  </div>
                  <div className="w-1 h-9 rounded-full bg-muted shrink-0 flex flex-col justify-end overflow-hidden">
                    <div className={cn("w-full rounded-full", barColor)} style={{ height: `${alt.score}%` }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-sm font-bold text-foreground">{alt.hs_code}</span>
                      {i === 0 && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-success/10 text-success border-success/20">
                          Recommandé
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0">DDI:{alt.duty_rate}%</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{alt.description}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!isSel ? (
                      <Button
                        size="sm" variant="outline"
                        className="text-[10px] h-7 px-2.5 rounded-md border-primary text-primary hover:bg-primary/10"
                        onClick={(e) => { e.stopPropagation(); setSelected(alt.hs_code); }}
                      >
                        Retenir
                      </Button>
                    ) : (
                      <Badge className="text-[10px] px-2.5 py-1 bg-primary/10 text-primary border-primary/20">Retenu</Badge>
                    )}
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isExp && "rotate-180")} />
                  </div>
                </button>

                {isExp && (
                  <div className="border-t border-border px-3.5 pb-3.5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="mt-3">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Argumentaire</div>
                      <p className={cn(
                        "text-xs leading-relaxed text-foreground/80 p-3 bg-muted/30 rounded-lg border-l-[3px]",
                        alt.score >= 60 ? "border-l-success" : alt.score >= 25 ? "border-l-warning" : "border-l-muted-foreground/30"
                      )}>
                        {alt.reasoning}
                      </p>
                    </div>
                    {alt.sources?.length > 0 && (
                      <div className="mt-3">
                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                          Sources ({alt.sources.length})
                        </div>
                        <div className="space-y-1.5">
                          {alt.sources.map((src, j) => {
                            const badge = SOURCE_BADGE[src.type] || SOURCE_BADGE.rgi;
                            const Icon = badge.icon;
                            return (
                              <div key={j} className="flex items-start gap-2 p-2 rounded-lg bg-muted/20 border border-border/50">
                                <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 shrink-0 mt-0.5 gap-1", badge.className)}>
                                  <Icon className="h-2.5 w-2.5" />
                                  {badge.label}
                                </Badge>
                                <div className="min-w-0">
                                  <span className="text-[11px] font-semibold text-foreground">{src.ref}</span>
                                  <p className="text-[10px] text-muted-foreground leading-snug">{src.text}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Validate button */}
        <div className="mt-4">
          <Button
            onClick={handleValidate}
            disabled={!selected || saving}
            className="w-full cta-gradient rounded-2xl h-14 text-base font-semibold gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {saving ? "Sauvegarde..." : `Confirmer ${selected || ""}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
