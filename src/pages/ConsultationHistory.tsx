import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search, Package, Home, ClipboardCheck, Factory,
  ChevronRight, Loader2, FileText, Clock
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ConsultationRow {
  id: string;
  reference: string;
  consultation_type: string;
  inputs: any;
  confidence: string;
  status: string;
  processing_time_ms: number;
  created_at: string;
}

const TYPE_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  import: { icon: Package, label: "Import", color: "text-blue-600 bg-blue-50" },
  mre: { icon: Home, label: "MRE", color: "text-emerald-600 bg-emerald-50" },
  conformity: { icon: ClipboardCheck, label: "Conformité", color: "text-amber-600 bg-amber-50" },
  investor: { icon: Factory, label: "Investissement", color: "text-violet-600 bg-violet-50" },
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-red-100 text-red-700",
};

export default function ConsultationHistory() {
  const navigate = useNavigate();
  const [consultations, setConsultations] = useState<ConsultationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  useEffect(() => {
    fetchConsultations();
  }, []);

  const fetchConsultations = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("consultations")
      .select("id, reference, consultation_type, inputs, confidence, status, processing_time_ms, created_at")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(100);

    if (!error && data) {
      setConsultations(data as ConsultationRow[]);
    }
    setLoading(false);
  };

  const filtered = consultations.filter(c => {
    const matchType = typeFilter === "all" || c.consultation_type === typeFilter;
    const matchSearch = !search ||
      c.reference.toLowerCase().includes(search.toLowerCase()) ||
      ((c.inputs as any)?.product_description || "").toLowerCase().includes(search.toLowerCase()) ||
      ((c.inputs as any)?.vehicle_brand || "").toLowerCase().includes(search.toLowerCase()) ||
      ((c.inputs as any)?.material_description || "").toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  const getProductLabel = (c: ConsultationRow): string => {
    const inputs = c.inputs as any || {};
    return inputs.product_description || inputs.vehicle_brand || inputs.material_description || inputs.sector || "—";
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 3600000) return `Il y a ${Math.floor(diff / 60000)} min`;
    if (diff < 86400000) return `Il y a ${Math.floor(diff / 3600000)}h`;
    return d.toLocaleDateString("fr-MA", { day: "2-digit", month: "short", year: "numeric" });
  };

  return (
    <ScrollArea className="h-full">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4 pb-20">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">Historique des consultations</h1>
          <Button size="sm" onClick={() => navigate("/app/consultation")}>
            <FileText className="h-4 w-4 mr-1.5" /> Nouvelle
          </Button>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher par référence ou produit..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              <SelectItem value="import">Import</SelectItem>
              <SelectItem value="mre">MRE</SelectItem>
              <SelectItem value="conformity">Conformité</SelectItem>
              <SelectItem value="investor">Investissement</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Clock className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>Aucune consultation trouvée</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(c => {
              const cfg = TYPE_CONFIG[c.consultation_type] || TYPE_CONFIG.import;
              const Icon = cfg.icon;
              return (
                <button
                  key={c.id}
                  onClick={() => navigate(`/app/consultation?ref=${c.reference}`)}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-card border border-border hover:border-primary/30 hover:shadow-sm transition-all text-left"
                >
                  <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", cfg.color)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate">{getProductLabel(c)}</span>
                      <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 shrink-0", CONFIDENCE_COLORS[c.confidence] || "")}>
                        {c.confidence}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">{c.reference}</span>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs text-muted-foreground">{formatDate(c.created_at)}</span>
                      {c.processing_time_ms && (
                        <>
                          <span className="text-xs text-muted-foreground">•</span>
                          <span className="text-xs text-muted-foreground">{(c.processing_time_ms / 1000).toFixed(1)}s</span>
                        </>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
