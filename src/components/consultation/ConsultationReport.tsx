import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, AlertTriangle, FileText, Calculator, Shield, TrendingUp } from "lucide-react";

interface Props {
  data: any;
  type: string;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("fr-MA", { maximumFractionDigits: 0 }).format(n);
}

export function ConsultationReport({ data, type }: Props) {
  if (!data) return null;

  const report = data.report;
  if (!report) return <p className="text-muted-foreground">Aucun rapport généré.</p>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-card border border-border">
        <div>
          <h2 className="text-lg font-bold text-foreground">Rapport {data.reference}</h2>
          <p className="text-sm text-muted-foreground">{data.date} • {data.processing_time_ms}ms</p>
        </div>
        <Badge variant={data.confidence === "high" ? "default" : data.confidence === "medium" ? "secondary" : "destructive"}>
          Confiance: {data.confidence}
        </Badge>
      </div>

      {/* Input summary */}
      {report.input_summary && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" />Résumé de la demande</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
              {Object.entries(report.input_summary).map(([k, v]) => (
                <div key={k}>
                  <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}: </span>
                  <span className="font-medium">{String(v)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Classification */}
      {report.classification && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4 text-primary" />Classification SH</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-base font-mono">{report.classification.hs_code}</Badge>
              <Badge>{report.classification.confidence}</Badge>
            </div>
            <p>{report.classification.description}</p>
            {report.classification.reasoning && <p className="text-muted-foreground italic">{report.classification.reasoning}</p>}
          </CardContent>
        </Card>
      )}

      {/* Taxes */}
      {report.taxes && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Calculator className="h-4 w-4 text-primary" />Droits et taxes</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {report.taxes.caf_details?.map((d: string, i: number) => (
              <p key={i} className="text-sm text-muted-foreground">{d}</p>
            ))}
            <div className="border-t border-border pt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left py-1">Taxe</th>
                    <th className="text-right py-1">Taux</th>
                    <th className="text-right py-1">Base</th>
                    <th className="text-right py-1 font-semibold">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {report.taxes.lines?.map((line: any, i: number) => (
                    <tr key={i} className="border-t border-border/50">
                      <td className="py-2">{line.tax}</td>
                      <td className="text-right">{line.rate}%</td>
                      <td className="text-right">{fmt(line.base)} MAD</td>
                      <td className="text-right font-semibold">{fmt(line.amount)} MAD</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-foreground/20 font-bold">
                    <td className="py-2" colSpan={3}>Total droits et taxes</td>
                    <td className="text-right text-primary">{fmt(report.taxes.total)} MAD</td>
                  </tr>
                  <tr className="text-muted-foreground">
                    <td className="py-1" colSpan={3}>Coût total rendu (marchandise + taxes)</td>
                    <td className="text-right font-semibold">{fmt(report.taxes.total_with_goods)} MAD</td>
                  </tr>
                  {report.taxes.savings && report.taxes.savings > 0 && (
                    <tr className="text-secondary">
                      <td className="py-1" colSpan={3}>💰 Économie accord préférentiel</td>
                      <td className="text-right font-semibold">{fmt(report.taxes.savings)} MAD</td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* MRE vehicle taxes */}
      {report.vehicle_taxes && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Calculator className="h-4 w-4 text-secondary" />Taxes véhicule (MRE)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-lg bg-secondary/5 border border-secondary/20">
                <p className="text-xs text-muted-foreground mb-1">Avec abattement MRE</p>
                <p className="text-xl font-bold text-secondary">{fmt(report.vehicle_taxes.with_mre.total)} MAD</p>
              </div>
              <div className="p-3 rounded-lg bg-muted">
                <p className="text-xs text-muted-foreground mb-1">Sans abattement</p>
                <p className="text-xl font-bold text-foreground">{fmt(report.vehicle_taxes.without_mre.total)} MAD</p>
              </div>
            </div>
            <p className="text-sm text-secondary font-semibold">💰 Économie MRE: {fmt(report.vehicle_taxes.savings)} MAD</p>
          </CardContent>
        </Card>
      )}

      {/* Regime comparison (investor) */}
      {report.regime_comparison && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4" />Comparaison des régimes</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Droit commun", data: report.regime_comparison.droit_commun, color: "border-border" },
                { label: "Franchise invest.", data: report.regime_comparison.franchise, color: "border-secondary" },
                { label: "Zone franche", data: report.regime_comparison.zone_franche, color: "border-primary" },
              ].map(r => (
                <div key={r.label} className={`p-3 rounded-lg border-2 ${r.color} text-center`}>
                  <p className="text-xs text-muted-foreground mb-1">{r.label}</p>
                  <p className="text-lg font-bold">{fmt(r.data.total)} MAD</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Eligibility (MRE) */}
      {report.eligibility && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2">
            {report.eligibility.eligible ? <CheckCircle2 className="h-4 w-4 text-secondary" /> : <XCircle className="h-4 w-4 text-destructive" />}
            Éligibilité
          </CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Badge variant={report.eligibility.eligible ? "default" : "destructive"}>
              {report.eligibility.eligible ? "Éligible" : "Non éligible"}
            </Badge>
            {report.eligibility.conditions_met?.map((c: string, i: number) => (
              <p key={i} className="flex items-center gap-2 text-secondary"><CheckCircle2 className="h-3 w-3" />{c}</p>
            ))}
            {report.eligibility.conditions_missing?.map((c: string, i: number) => (
              <p key={i} className="flex items-center gap-2 text-destructive"><XCircle className="h-3 w-3" />{c}</p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Conformity checks */}
      {(report.conformity || report.checks) && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4 text-warning" />Conformités réglementaires</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(report.conformity || report.checks)?.map((c: any, i: number) => (
              <div key={i} className="p-3 rounded-lg border border-border space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">{c.authority}</span>
                  <Badge variant={c.status === "required" ? "destructive" : c.status === "recommended" ? "secondary" : "outline"}>
                    {c.status === "required" ? "Requis" : c.status === "recommended" ? "Recommandé" : "Non requis"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{c.reason}</p>
                {c.delay && <p className="text-xs">⏱ Délai: {c.delay}</p>}
                {c.cost && <p className="text-xs">💰 Coût: {c.cost}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Documents */}
      {report.documents && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" />Documents requis</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {report.documents.map((d: any, i: number) => (
                <li key={i} className="flex items-start gap-2">
                  {d.required ? <CheckCircle2 className="h-4 w-4 text-destructive mt-0.5 shrink-0" /> : <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />}
                  <div>
                    <span className="font-medium">{d.name}</span>
                    {d.note && <span className="text-muted-foreground ml-1">— {d.note}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Procedure */}
      {report.procedure && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Procédure</CardTitle></CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm list-decimal list-inside">
              {report.procedure.map((step: string, i: number) => <li key={i}>{step}</li>)}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* Risks / Warnings */}
      {(report.risks || report.warnings) && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" />Points d'attention</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {(report.risks || report.warnings)?.map((r: string, i: number) => (
                <li key={i} className="flex items-start gap-2"><AlertTriangle className="h-3 w-3 text-warning mt-1 shrink-0" />{r}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Sources */}
      {report.sources && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Sources juridiques</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {report.sources.map((s: string, i: number) => <li key={i}>📜 {s}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
