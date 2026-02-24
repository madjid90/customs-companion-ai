import { useState, useMemo } from "react";
import { Search, Loader2, Check, ChevronDown, ChevronRight, BookOpen, Scale, FileText, Database, ArrowLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { getAuthHeaders } from "@/lib/authHeaders";
import { useToast } from "@/hooks/use-toast";

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
}

const SOURCE_BADGE: Record<string, { className: string; label: string; icon: any }> = {
  rgi: { className: "bg-primary/15 text-primary", label: "RGI", icon: Scale },
  note: { className: "bg-warning/15 text-warning", label: "Note", icon: BookOpen },
  circulaire: { className: "bg-secondary/15 text-secondary", label: "Circulaire", icon: FileText },
  db: { className: "bg-success/15 text-success", label: "Base données", icon: Database },
};

const CLASSIFY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/classify`;

// ── Smart Questions ──
interface QuestionOption {
  label: string;
  emoji?: string;
  subQuestions?: SmartQuestion[];
}
interface SmartQuestion {
  id: string;
  question: string;
  type: "choice" | "text";
  options?: QuestionOption[];
  placeholder?: string;
  required?: boolean;
}

const QUESTIONS: SmartQuestion[] = [
  {
    id: "category",
    question: "Quelle est la catégorie du produit ?",
    type: "choice",
    required: true,
    options: [
      {
        label: "Électronique & Tech", emoji: "💻",
        subQuestions: [
          { id: "tech_type", question: "Quel type d'appareil ?", type: "choice", options: [
            { label: "Téléphone / Tablette", emoji: "📱" },
            { label: "Ordinateur / Serveur", emoji: "🖥️" },
            { label: "TV / Écran / Moniteur", emoji: "📺" },
            { label: "Composants / Pièces", emoji: "🔧" },
            { label: "Autre électronique", emoji: "⚡" },
          ]},
        ],
      },
      {
        label: "Machines & Équipements", emoji: "⚙️",
        subQuestions: [
          { id: "machine_type", question: "Quel type de machine ?", type: "choice", options: [
            { label: "Machine industrielle", emoji: "🏭" },
            { label: "Machine agricole", emoji: "🚜" },
            { label: "Outillage", emoji: "🔨" },
            { label: "Véhicule / Transport", emoji: "🚗" },
          ]},
        ],
      },
      {
        label: "Textile & Habillement", emoji: "👕",
        subQuestions: [
          { id: "textile_type", question: "Quel type de textile ?", type: "choice", options: [
            { label: "Vêtements", emoji: "👔" },
            { label: "Tissus / Matières premières", emoji: "🧶" },
            { label: "Accessoires (sacs, chaussures)", emoji: "👜" },
            { label: "Linge de maison", emoji: "🛏️" },
          ]},
        ],
      },
      {
        label: "Alimentaire", emoji: "🍎",
        subQuestions: [
          { id: "food_type", question: "Quel type de produit alimentaire ?", type: "choice", options: [
            { label: "Fruits & Légumes", emoji: "🥦" },
            { label: "Viande & Poisson", emoji: "🥩" },
            { label: "Céréales & Farines", emoji: "🌾" },
            { label: "Boissons", emoji: "🥤" },
            { label: "Produits transformés", emoji: "🥫" },
          ]},
        ],
      },
      {
        label: "Chimie & Pharma", emoji: "🧪",
        subQuestions: [
          { id: "chem_type", question: "Quel type de produit ?", type: "choice", options: [
            { label: "Médicament", emoji: "💊" },
            { label: "Cosmétique / Hygiène", emoji: "🧴" },
            { label: "Produit chimique brut", emoji: "⚗️" },
            { label: "Engrais / Pesticide", emoji: "🌿" },
          ]},
        ],
      },
      {
        label: "Matériaux de construction", emoji: "🧱",
        subQuestions: [
          { id: "build_type", question: "Quel type de matériau ?", type: "choice", options: [
            { label: "Métaux (acier, aluminium…)", emoji: "🔩" },
            { label: "Bois", emoji: "🪵" },
            { label: "Plastiques", emoji: "♻️" },
            { label: "Céramique / Verre", emoji: "🪟" },
          ]},
        ],
      },
      { label: "Autre catégorie", emoji: "📦" },
    ],
  },
  {
    id: "description",
    question: "Décrivez précisément le produit",
    type: "text",
    placeholder: "Marque, modèle, matière, dimensions, usage…",
    required: true,
  },
  {
    id: "usage",
    question: "Quelle est l'utilisation prévue ?",
    type: "choice",
    options: [
      { label: "Usage industriel", emoji: "🏭" },
      { label: "Usage commercial (revente)", emoji: "🏪" },
      { label: "Usage personnel", emoji: "🏠" },
      { label: "Usage agricole", emoji: "🌱" },
    ],
  },
  {
    id: "origin",
    question: "Quel est le pays d'origine ?",
    type: "text",
    placeholder: "Ex: Chine, Turquie, France…",
  },
  {
    id: "hs_hint",
    question: "Avez-vous une idée du code SH ?",
    type: "text",
    placeholder: "Ex: 8528 (optionnel, laissez vide sinon)",
  },
];

// ── Component ──
export function ClassificationView() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ClassificationResult | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Build the active question list (with dynamic sub-questions)
  const activeQuestions = useMemo(() => {
    const list: SmartQuestion[] = [];
    for (const q of QUESTIONS) {
      list.push(q);
      // Inject sub-questions after category if an option with subQuestions was selected
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
  const progress = ((step) / totalSteps) * 100;

  // Build full description from answers
  const buildDescription = () => {
    const parts: string[] = [];
    if (answers.category) parts.push(`Catégorie: ${answers.category}`);
    // add any sub-question answers
    for (const q of activeQuestions) {
      if (q.id !== "category" && q.id !== "description" && q.id !== "usage" && q.id !== "origin" && q.id !== "hs_hint" && answers[q.id]) {
        parts.push(`Type: ${answers[q.id]}`);
      }
    }
    if (answers.description) parts.push(answers.description);
    if (answers.usage) parts.push(`Usage: ${answers.usage}`);
    return parts.join(". ");
  };

  const canProceed = () => {
    if (!currentQ) return false;
    if (currentQ.required && !answers[currentQ.id]?.trim()) return false;
    return true;
  };

  const handleNext = () => {
    if (step < totalSteps - 1) {
      setStep(step + 1);
    } else {
      classify();
    }
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleSkip = () => {
    if (!currentQ?.required && step < totalSteps - 1) {
      setStep(step + 1);
    } else if (!currentQ?.required) {
      classify();
    }
  };

  const selectOption = (label: string) => {
    setAnswers(prev => ({ ...prev, [currentQ.id]: label }));
    // Auto-advance on choice selection
    setTimeout(() => {
      if (step < totalSteps - 1) {
        setStep(s => s + 1);
      }
    }, 200);
  };

  const classify = async () => {
    const desc = buildDescription();
    if (!desc.trim() || loading) return;
    setLoading(true);
    setResult(null);
    setExpanded(null);
    setSelected(null);

    try {
      const headers = await getAuthHeaders(true);
      const res = await fetch(CLASSIFY_URL, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          description: desc.trim(),
          hs_code_hint: answers.hs_hint?.trim() || undefined,
          origin_country: answers.origin?.trim() || undefined,
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
    setResult(null);
    setExpanded(null);
    setSelected(null);
  };

  // ════════════════════════════════════════════════
  // FORM: Smart Question Wizard
  // ════════════════════════════════════════════════
  if (!result && !loading) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 pb-20 md:pb-0">
        <div className="max-w-md w-full animate-in fade-in duration-300">
          {/* Header */}
          <div className="text-center mb-5">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/10 mb-3">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <h2 className="text-lg font-bold text-foreground">Classification intelligente</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Répondez aux questions pour identifier le code SH
            </p>
          </div>

          {/* Progress */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Étape {step + 1} / {totalSteps}
              </span>
              {!currentQ?.required && (
                <button onClick={handleSkip} className="text-[10px] font-semibold text-primary hover:underline">
                  Passer →
                </button>
              )}
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
                style={{ width: `${Math.max(progress, 5)}%` }}
              />
            </div>
          </div>

          {/* Question Card */}
          <div className="card-elevated rounded-2xl p-5">
            {/* Question label */}
            <p className="text-sm font-semibold text-foreground mb-4">{currentQ?.question}</p>

            {/* Choice type */}
            {currentQ?.type === "choice" && currentQ.options && (
              <div className="grid grid-cols-2 gap-2">
                {currentQ.options.map((opt) => {
                  const isSelected = answers[currentQ.id] === opt.label;
                  return (
                    <button
                      key={opt.label}
                      onClick={() => selectOption(opt.label)}
                      className={cn(
                        "flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all duration-150",
                        isSelected
                          ? "border-primary bg-primary/5 ring-2 ring-primary/10"
                          : "border-border bg-card hover:border-primary/30 hover:bg-primary/5"
                      )}
                    >
                      {opt.emoji && <span className="text-lg shrink-0">{opt.emoji}</span>}
                      <span className="text-xs font-medium text-foreground leading-tight">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Text type */}
            {currentQ?.type === "text" && (
              <div className="space-y-3">
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

            {/* Navigation */}
            <div className="flex items-center gap-2 mt-5">
              {step > 0 && (
                <Button variant="outline" onClick={handleBack} className="rounded-xl h-12 px-4">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
              {currentQ?.type === "text" && (
                <Button
                  onClick={handleNext}
                  disabled={currentQ.required && !answers[currentQ.id]?.trim()}
                  className={cn(
                    "flex-1 rounded-2xl h-12 text-sm font-semibold",
                    step === totalSteps - 1 ? "cta-gradient h-14" : ""
                  )}
                >
                  {step === totalSteps - 1 ? (
                    <>
                      <Search className="h-4 w-4 mr-2" />
                      Classifier
                    </>
                  ) : (
                    <>
                      Suivant
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </>
                  )}
                </Button>
              )}
            </div>

            {/* Answers recap */}
            {Object.keys(answers).length > 0 && (
              <div className="mt-4 pt-3 border-t border-border/50">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Vos réponses</div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(answers).filter(([, v]) => v.trim()).map(([key, val]) => (
                    <Badge key={key} variant="outline" className="text-[10px] bg-muted/50 text-foreground border-border">
                      {val.length > 25 ? val.substring(0, 25) + "…" : val}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════
  // LOADING
  // ════════════════════════════════════════════════
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 pb-20 md:pb-0">
        <div className="text-center animate-in fade-in duration-300">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
          <p className="text-sm font-semibold text-foreground">Classification en cours...</p>
          <p className="text-xs text-muted-foreground mt-1">Analyse RGI, notes de section, base tarifaire</p>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════
  // RESULTS (unchanged)
  // ════════════════════════════════════════════════
  return (
    <div className="flex-1 overflow-auto px-4 py-4 pb-24 md:pb-6">
      <div className="max-w-lg mx-auto animate-in fade-in duration-300">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-[10px] font-bold text-warning uppercase tracking-wider">
              ⚠ Cas {result!.confidence === "high" ? "clair" : "ambigu"} — {result!.alternatives.length} codes
            </span>
            <h3 className="text-base font-bold text-foreground mt-0.5">Résultat</h3>
          </div>
          <Button variant="outline" size="sm" onClick={reset} className="text-xs rounded-lg">
            ↩ Nouveau
          </Button>
        </div>

        {/* Query recap */}
        <div className="bg-muted/40 rounded-xl px-3 py-2.5 mb-3 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Produit :</span> {result!.query}
        </div>

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
                        size="sm"
                        variant="outline"
                        className="text-[10px] h-7 px-2.5 rounded-md border-primary text-primary hover:bg-primary/10"
                        onClick={(e) => { e.stopPropagation(); setSelected(alt.hs_code); }}
                      >
                        Retenir
                      </Button>
                    ) : (
                      <Badge className="text-[10px] px-2.5 py-1 bg-primary/10 text-primary border-primary/20">✓ Retenu</Badge>
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
                                  <div className="text-xs font-semibold text-foreground">{src.ref}</div>
                                  <div className="text-[10px] text-muted-foreground mt-0.5">{src.text}</div>
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

        {selected && (
          <div className="mt-4 p-3 bg-card rounded-xl border border-border flex items-center justify-between">
            <div>
              <div className="text-[10px] text-muted-foreground">Code retenu</div>
              <div className="font-mono text-base font-bold text-foreground">{selected}</div>
            </div>
            <Button onClick={handleValidate} disabled={saving} className="cta-gradient rounded-lg text-sm font-semibold px-4">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Valider ✓
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
