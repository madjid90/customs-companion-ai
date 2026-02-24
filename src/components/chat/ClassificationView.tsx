import { useState } from "react";
import { Search, Loader2, Check, ChevronDown, BookOpen, Scale, FileText, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { getAuthHeaders } from "@/lib/authHeaders";
import { useToast } from "@/hooks/use-toast";

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

export function ClassificationView() {
  const [description, setDescription] = useState("");
  const [hsHint, setHsHint] = useState("");
  const [originCountry, setOriginCountry] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ClassificationResult | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const classify = async () => {
    if (!description.trim() || loading) return;
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
          description: description.trim(),
          hs_code_hint: hsHint.trim() || undefined,
          origin_country: originCountry.trim() || undefined,
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
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("classification_history").insert({
        question: description,
        product_description: description,
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
    setDescription("");
    setHsHint("");
    setOriginCountry("");
    setResult(null);
    setExpanded(null);
    setSelected(null);
  };

  // ── Form view ──
  if (!result && !loading) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 pb-20 md:pb-0">
        <div className="max-w-md w-full animate-in fade-in duration-300">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">🔍</div>
            <h2 className="text-lg font-bold text-foreground">Classification tarifaire</h2>
            <p className="text-sm text-muted-foreground">Décrivez le produit pour obtenir les codes SH possibles</p>
          </div>

          <div className="card-elevated rounded-2xl p-5 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground block">Description du produit</label>
              <Textarea
                rows={3}
                placeholder="Ex: Écran LCD 55 pouces 4K avec tuner TV intégré..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-muted-foreground block">Code SH (optionnel)</label>
                <Input placeholder="8528" value={hsHint} onChange={(e) => setHsHint(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-muted-foreground block">Pays d'origine</label>
                <Input placeholder="Chine, France..." value={originCountry} onChange={(e) => setOriginCountry(e.target.value)} />
              </div>
            </div>

            <Button
              onClick={classify}
              disabled={!description.trim()}
              className="w-full cta-gradient rounded-2xl h-14 text-base font-semibold"
            >
              <Search className="h-4 w-4 mr-2" />
              Classifier
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading view ──
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

  // ── Results view ──
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
                {/* Row */}
                <button
                  onClick={() => setExpanded(isExp ? null : alt.hs_code)}
                  className="w-full flex items-center gap-3 p-3.5 text-left"
                >
                  {/* Score */}
                  <div className="w-11 text-center shrink-0">
                    <div className={cn("text-xl font-black leading-none", scoreColor)}>{alt.score}</div>
                    <div className="text-[9px] text-muted-foreground">%</div>
                  </div>

                  {/* Bar */}
                  <div className="w-1 h-9 rounded-full bg-muted shrink-0 flex flex-col justify-end overflow-hidden">
                    <div className={cn("w-full rounded-full", barColor)} style={{ height: `${alt.score}%` }} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-sm font-bold text-foreground">{alt.hs_code}</span>
                      {i === 0 && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-success/10 text-success border-success/20">
                          Recommandé
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0">
                        DDI:{alt.duty_rate}%
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{alt.description}</p>
                  </div>

                  {/* Actions */}
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
                      <Badge className="text-[10px] px-2.5 py-1 bg-primary/10 text-primary border-primary/20">
                        ✓ Retenu
                      </Badge>
                    )}
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isExp && "rotate-180")} />
                  </div>
                </button>

                {/* Expanded details */}
                {isExp && (
                  <div className="border-t border-border px-3.5 pb-3.5 animate-in fade-in slide-in-from-top-1 duration-200">
                    {/* Reasoning */}
                    <div className="mt-3">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Argumentaire</div>
                      <p className={cn(
                        "text-xs leading-relaxed text-foreground/80 p-3 bg-muted/30 rounded-lg border-l-[3px]",
                        alt.score >= 60 ? "border-l-success" : alt.score >= 25 ? "border-l-warning" : "border-l-muted-foreground/30"
                      )}>
                        {alt.reasoning}
                      </p>
                    </div>

                    {/* Sources */}
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

        {/* Bottom bar: selected code + validate */}
        {selected && (
          <div className="mt-4 p-3 bg-card rounded-xl border border-border flex items-center justify-between">
            <div>
              <div className="text-[10px] text-muted-foreground">Code retenu</div>
              <div className="font-mono text-base font-bold text-foreground">{selected}</div>
            </div>
            <Button
              onClick={handleValidate}
              disabled={saving}
              className="cta-gradient rounded-lg text-sm font-semibold px-4"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Valider ✓
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
