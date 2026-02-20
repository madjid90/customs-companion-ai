import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { 
  CheckCircle2, XCircle, AlertTriangle, FileText, Calculator, 
  Shield, TrendingUp, ChevronDown, ChevronUp, RotateCcw, 
  MessageSquare, Download, ClipboardCheck, FileCheck, Route,
  Package, Factory, Info, BookOpen
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ReportPDFExport } from "@/components/consultation/ReportPDFExport";

interface Props {
  data: any;
  type: string;
  onNewConsultation?: () => void;
  onAskQuestion?: () => void;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("fr-MA", { maximumFractionDigits: 0 }).format(n);
}

export function ConsultationReport({ data, type, onNewConsultation, onAskQuestion }: Props) {
  if (!data) return null;
  const { reference, date, confidence, report } = data;
  if (!report) return <p className="text-muted-foreground">Aucun rapport généré.</p>;

  // Build sections based on type
  const sections = type === "import" ? buildImportSections(report, data)
    : type === "mre" ? buildMRESections(report, data)
    : type === "conformity" ? buildConformitySections(report, data)
    : buildInvestorSections(report, data);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-card border border-border shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-foreground">Rapport {reference}</h2>
            <Badge variant="outline" className="text-xs">{date}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {type === "import" ? "Importation Standard" : type === "mre" ? "Régime MRE" : type === "conformity" ? "Analyse Conformité" : "Étude Investissement"}
          </p>
        </div>
        <Badge variant={confidence === "high" ? "default" : confidence === "medium" ? "secondary" : "destructive"}>
          Confiance: {confidence === "high" ? "Élevée" : confidence === "medium" ? "Moyenne" : "Faible"}
        </Badge>
      </div>

      {/* Sections */}
      {sections.map((section: any) => {
        const [isCollapsed, setIsCollapsed] = useState(section.defaultCollapsed || false);
        const Icon = section.icon;
        
        return (
          <div key={section.id} className={cn("bg-card rounded-xl border transition-all duration-200", 
            section.status === "warning" ? "border-amber-200" : section.status === "success" ? "border-emerald-200" : "border-border"
          )}>
            <button 
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="w-full flex items-center justify-between p-4 text-left"
            >
              <div className="flex items-center gap-3">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", 
                  section.status === "warning" ? "bg-amber-100 text-amber-600" : 
                  section.status === "success" ? "bg-emerald-100 text-emerald-600" : 
                  "bg-primary/10 text-primary"
                )}>
                  <Icon className="h-4 w-4" />
                </div>
                <h3 className="font-semibold text-sm">{section.title}</h3>
              </div>
              {isCollapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
            </button>
            {!isCollapsed && (
              <div className="px-4 pb-4 pt-0">
                <Separator className="mb-4" />
                {section.content}
              </div>
            )}
          </div>
        );
      })}

      {/* Disclaimer */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <div className="flex gap-3">
          <Shield className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-semibold mb-1">Avertissement</p>
            <p>
              Ce rapport est fourni à titre informatif et ne constitue pas un renseignement tarifaire
              contraignant (RTC). Pour une certification officielle, adressez-vous à l'ADII
              (www.douane.gov.ma). Données à jour au {date}.
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        {onNewConsultation && (
          <Button onClick={onNewConsultation} variant="outline" className="flex-1">
            <RotateCcw className="h-4 w-4 mr-2" />
            Nouvelle consultation
          </Button>
        )}
        {onAskQuestion && (
          <Button onClick={onAskQuestion} variant="outline" className="flex-1">
            <MessageSquare className="h-4 w-4 mr-2" />
            Poser une question
          </Button>
        )}
        <ReportPDFExport
          reference={reference}
          date={date}
          type={type as any}
          reportData={data}
        />
      </div>
    </div>
  );
}

/* ============ HELPER COMPONENTS ============ */

export function TaxBreakdownTable({ lines, total, currency = "MAD" }: {
  lines: { tax: string; rate: number; base: number; amount: number }[];
  total: number;
  currency?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Taxe</th>
            <th className="text-right py-2 px-4 font-semibold text-muted-foreground">Taux</th>
            <th className="text-right py-2 px-4 font-semibold text-muted-foreground">Base</th>
            <th className="text-right py-2 pl-4 font-semibold text-muted-foreground">Montant</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className="border-b border-border/50">
              <td className="py-2.5 pr-4 font-medium">{line.tax}</td>
              <td className="py-2.5 px-4 text-right text-muted-foreground">{line.rate}%</td>
              <td className="py-2.5 px-4 text-right text-muted-foreground">{fmt(line.base)}</td>
              <td className="py-2.5 pl-4 text-right font-medium">{fmt(line.amount)} {currency}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-primary/5">
            <td colSpan={3} className="py-3 pr-4 font-bold text-base">TOTAL À PAYER</td>
            <td className="py-3 pl-4 text-right font-bold text-base text-primary">{fmt(total)} {currency}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function DocumentChecklist({ documents }: {
  documents: { name: string; required: boolean; note?: string }[];
}) {
  return (
    <div className="space-y-1.5">
      {documents.map((doc, i) => (
        <div key={i} className="flex items-start gap-2.5 py-1.5">
          <div className={cn(
            "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5",
            doc.required ? "border-primary/40 bg-primary/5" : "border-muted-foreground/30"
          )}>
            {doc.required && <span className="text-[10px] text-primary font-bold">!</span>}
          </div>
          <div>
            <span className="text-sm">{doc.name}</span>
            {doc.required && <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0">Obligatoire</Badge>}
            {doc.note && <p className="text-xs text-muted-foreground mt-0.5">{doc.note}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConformityCard({ authority, status, details }: {
  authority: string;
  status: "required" | "not_required" | "recommended";
  details?: { reason: string; legal_basis?: string; delay?: string; cost?: string; when?: string; steps?: string[] };
}) {
  const statusConfig = {
    required: { icon: AlertTriangle, label: "REQUIS", color: "border-amber-300 bg-amber-50", iconColor: "text-amber-600", labelColor: "text-amber-700 bg-amber-100" },
    not_required: { icon: CheckCircle2, label: "NON REQUIS", color: "border-emerald-200 bg-emerald-50/50", iconColor: "text-emerald-600", labelColor: "text-emerald-700 bg-emerald-100" },
    recommended: { icon: Info, label: "RECOMMANDÉ", color: "border-blue-200 bg-blue-50/50", iconColor: "text-blue-600", labelColor: "text-blue-700 bg-blue-100" },
  };
  const cfg = statusConfig[status];
  const Icon = cfg.icon;

  return (
    <div className={cn("rounded-xl border p-4", cfg.color)}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("h-4 w-4", cfg.iconColor)} />
        <span className="font-semibold text-sm">{authority}</span>
        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 ml-auto", cfg.labelColor)}>{cfg.label}</Badge>
      </div>
      {details && (
        <div className="space-y-1.5 text-sm">
          <p className="text-muted-foreground">{details.reason}</p>
          {details.legal_basis && <p className="text-xs text-muted-foreground">Base légale : {details.legal_basis}</p>}
          {details.delay && <p className="text-xs">⏱️ Délai : {details.delay}</p>}
          {details.cost && <p className="text-xs">💰 Coût : {details.cost}</p>}
          {details.when && <p className="text-xs">📅 À obtenir : {details.when}</p>}
          {details.steps && details.steps.length > 0 && (
            <div className="mt-2 space-y-1">
              {details.steps.map((step, i) => <p key={i} className="text-xs text-muted-foreground flex gap-2"><span className="font-semibold shrink-0">{i + 1}.</span>{step}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function buildImportSections(report: any, data: any) {
  const sections: any[] = [];
  if (report.classification) {
    sections.push({
      id: "classification", title: "Identification du produit", icon: Package, status: "info",
      content: <div className="space-y-2 text-sm"><div className="flex items-center gap-2"><Badge variant="outline" className="font-mono text-base">{report.classification.hs_code}</Badge><span className="text-muted-foreground">{report.classification.description}</span></div><p className="text-muted-foreground italic bg-muted/30 p-2 rounded">{report.classification.reasoning}</p></div>
    });
  }
  if (report.taxes) {
    sections.push({
      id: "taxes", title: "Calcul des droits et taxes", icon: Calculator, status: "info",
      content: <TaxBreakdownTable lines={report.taxes.lines} total={report.taxes.total} />
    });
  }
  if (report.conformity?.length > 0) {
    const req = report.conformity.filter((c: any) => c.status === "required");
    sections.push({
      id: "conformity", title: "Conformités et autorisations", icon: ClipboardCheck, status: req.length > 0 ? "warning" : "success",
      content: <div className="space-y-3">{report.conformity.map((c: any, i: number) => <ConformityCard key={i} authority={c.authority} status={c.status} details={{ reason: c.reason, legal_basis: c.legal_basis, delay: c.delay, cost: c.cost, when: c.when, steps: c.steps }} />)}</div>
    });
  }
  if (report.documents?.length > 0) {
    sections.push({ id: "documents", title: "Documents requis", icon: FileCheck, content: <DocumentChecklist documents={report.documents} /> });
  }
  if (report.procedure?.length > 0) {
    sections.push({
      id: "procedure", title: "Procédure", icon: Route,
      content: <div className="space-y-2">{report.procedure.map((s: string, i: number) => <div key={i} className="flex items-start gap-3 text-sm"><span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span><span>{s}</span></div>)}</div>
    });
  }
  if (report.risks?.length > 0) {
    sections.push({ id: "risks", title: "Points d'attention", icon: AlertTriangle, status: "warning", content: <div className="space-y-2 text-sm">{report.risks.map((r: string, i: number) => <p key={i}>⚠️ {r}</p>)}</div> });
  }
  if (report.sources?.length > 0) {
    sections.push({ id: "sources", title: "Sources et références", icon: BookOpen, content: <div className="text-sm text-muted-foreground space-y-1">{report.sources.map((s: string, i: number) => <p key={i}>• {s}</p>)}</div> });
  }
  return sections;
}

function buildMRESections(report: any, data: any) {
  const sections: any[] = [];
  if (report.eligibility) {
    sections.push({
      id: "eligibility", title: "Éligibilité", icon: ClipboardCheck, status: report.eligibility.eligible ? "success" : "error",
      content: <div className="text-sm space-y-2"><p className={`font-semibold ${report.eligibility.eligible ? "text-emerald-700" : "text-red-700"}`}>{report.eligibility.eligible ? "✅ Éligible aux avantages MRE" : "❌ Non éligible"}</p>{report.eligibility.conditions_met?.map((c: string, i: number) => <p key={i} className="text-emerald-600">✓ {c}</p>)}{report.eligibility.conditions_missing?.map((c: string, i: number) => <p key={i} className="text-red-600">✗ {c}</p>)}{report.eligibility.legal_basis && <p className="text-xs text-muted-foreground mt-2">Base légale : {report.eligibility.legal_basis}</p>}</div>
    });
  }
  if (report.vehicle_taxes) {
    sections.push({
      id: "vehicle_taxes", title: "Calcul des droits (véhicule)", icon: Calculator, status: "info",
      content: <div className="space-y-3">{report.vehicle_taxes.with_mre?.lines && <TaxBreakdownTable lines={report.vehicle_taxes.with_mre.lines} total={report.vehicle_taxes.with_mre.total} />}{report.vehicle_taxes.savings > 0 && <p className="text-sm text-emerald-700 p-2 bg-emerald-50 rounded-lg">💰 Économie MRE : {fmt(report.vehicle_taxes.savings)} MAD</p>}</div>
    });
  }
  if (report.documents?.length > 0) sections.push({ id: "documents", title: "Documents requis", icon: FileCheck, content: <DocumentChecklist documents={report.documents} /> });
  if (report.procedure?.length > 0) sections.push({ id: "procedure", title: "Procédure", icon: Route, content: <div className="space-y-2">{report.procedure.map((s: string, i: number) => <div key={i} className="flex items-start gap-3 text-sm"><span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span><span>{s}</span></div>)}</div> });
  if (report.warnings?.length > 0) sections.push({ id: "warnings", title: "Points d'attention", icon: AlertTriangle, status: "warning", content: <div className="space-y-2 text-sm">{report.warnings.map((w: string, i: number) => <p key={i}>⚠️ {w}</p>)}</div> });
  return sections;
}

function buildConformitySections(report: any, data: any) {
  const sections: any[] = [];
  if (report.product) sections.push({ id: "product", title: "Produit identifié", icon: Package, content: <div className="text-sm space-y-1"><p><span className="font-semibold">Produit :</span> {report.product.description}</p><p><span className="font-semibold">Code SH :</span> {report.product.hs_code || "À déterminer"}</p></div> });
  if (report.checks?.length > 0) {
    const req = report.checks.filter((c: any) => c.status === "required");
    sections.push({ id: "checks", title: "Résultats des vérifications", icon: ClipboardCheck, status: req.length > 0 ? "warning" : "success", content: <div className="space-y-3">{report.checks.map((c: any, i: number) => <ConformityCard key={i} authority={c.authority} status={c.status} details={{ reason: c.reason, legal_basis: c.legal_basis, delay: c.delay, cost: c.cost, when: c.when, steps: c.steps }} />)}</div> });
  }
  if (report.summary) sections.push({ id: "summary", title: "Résumé", icon: FileCheck, content: <div className="text-sm space-y-1 p-3 bg-muted/30 rounded-lg"><p>⚠️ <strong>{report.summary.total_required}</strong> obligatoire(s)</p><p>✅ <strong>{report.summary.total_not_required}</strong> non requise(s)</p><p>ℹ️ <strong>{report.summary.total_recommended}</strong> recommandée(s)</p>{report.summary.estimated_total_delay && <p>⏱️ Délai : <strong>{report.summary.estimated_total_delay}</strong></p>}{report.summary.estimated_total_cost && <p>💰 Coût : <strong>{report.summary.estimated_total_cost}</strong></p>}</div> });
  return sections;
}

function buildInvestorSections(report: any, data: any) {
  const sections: any[] = [];
  const comp = report.regime_comparison;
  if (report.recommended_regime) sections.push({ id: "regime", title: "Régime recommandé", icon: Factory, status: "success", content: <div className="text-sm space-y-2"><p className="font-semibold text-violet-700">{report.recommended_regime.name}</p><p>{report.recommended_regime.description}</p>{report.recommended_regime.legal_basis && <p className="text-xs text-muted-foreground">Base légale : {report.recommended_regime.legal_basis}</p>}</div> });
  if (comp) {
    sections.push({
      id: "comparison", title: "Comparatif des régimes", icon: Calculator, status: "info",
      content: <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b"><th className="text-left py-2"></th><th className="text-right px-3 text-muted-foreground font-semibold">Droit commun</th><th className="text-right px-3 text-violet-600 font-semibold">Franchise</th><th className="text-right px-3 text-emerald-600 font-semibold">Zone franche</th></tr></thead><tbody><tr className="bg-primary/5 font-bold"><td className="py-2.5">TOTAL</td><td className="text-right px-3">{fmt(comp.droit_commun?.total || 0)} MAD</td><td className="text-right px-3 text-violet-700">{fmt(comp.franchise?.total || 0)} MAD</td><td className="text-right px-3 text-emerald-700">{fmt(comp.zone_franche?.total || 0)} MAD</td></tr><tr><td className="py-2 text-emerald-700 font-medium">Économie</td><td className="text-right px-3">—</td><td className="text-right px-3 font-semibold text-violet-700">{fmt((comp.droit_commun?.total || 0) - (comp.franchise?.total || 0))} MAD</td><td className="text-right px-3 font-semibold text-emerald-700">{fmt((comp.droit_commun?.total || 0) - (comp.zone_franche?.total || 0))} MAD</td></tr></tbody></table></div>
    });
  }
  if (report.documents?.length > 0) sections.push({ id: "documents", title: "Documents requis", icon: FileCheck, content: <DocumentChecklist documents={report.documents} /> });
  if (report.procedure?.length > 0) sections.push({ id: "procedure", title: "Procédure", icon: Route, content: <div className="space-y-2">{report.procedure.map((s: string, i: number) => <div key={i} className="flex items-start gap-3 text-sm"><span className="w-6 h-6 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span><span>{s}</span></div>)}</div> });
  return sections;
}
