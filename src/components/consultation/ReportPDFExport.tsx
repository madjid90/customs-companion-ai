import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";

interface ReportPDFExportProps {
  reference: string;
  date: string;
  type: "import" | "mre" | "conformity" | "investor";
  reportData: any;
}

const TYPE_LABELS: Record<string, string> = {
  import: "Consultation Import",
  mre: "Rapport MRE",
  conformity: "Rapport Conformité",
  investor: "Rapport Investisseur",
};

function fmt(n: number): string {
  return new Intl.NumberFormat("fr-MA", { maximumFractionDigits: 0 }).format(n);
}

export function ReportPDFExport({ reference, date, type, reportData }: ReportPDFExportProps) {
  const [loading, setLoading] = useState(false);

  const generatePDF = async () => {
    setLoading(true);
    try {
      const { default: jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 15;
      const usable = pageWidth - margin * 2;
      let y = margin;

      const addPage = () => { doc.addPage(); y = margin; };
      const checkPage = (needed: number) => { if (y + needed > 270) addPage(); };

      // Header
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageWidth, 35, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text("DouaneAI", margin, 15);
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      doc.text(TYPE_LABELS[type] || "Rapport", margin, 23);
      doc.setFontSize(9);
      doc.text(`Réf: ${reference}  |  ${date}`, margin, 30);
      const conf = reportData.confidence || "medium";
      doc.setFontSize(8);
      doc.text(`Confiance: ${conf}`, pageWidth - margin - 30, 30);
      y = 42;
      doc.setTextColor(0, 0, 0);

      const report = reportData.report || {};

      const sectionTitle = (title: string, num: number) => {
        checkPage(15);
        doc.setFillColor(241, 245, 249);
        doc.roundedRect(margin, y, usable, 9, 1.5, 1.5, "F");
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(30, 41, 59);
        doc.text(`${num}. ${title}`, margin + 3, y + 6.5);
        y += 13;
        doc.setTextColor(0, 0, 0);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
      };

      const textBlock = (text: string) => {
        const lines = doc.splitTextToSize(text, usable - 6);
        checkPage(lines.length * 4.5 + 2);
        doc.text(lines, margin + 3, y);
        y += lines.length * 4.5 + 3;
      };

      const kv = (key: string, value: string) => {
        checkPage(6);
        doc.setFont("helvetica", "bold");
        doc.text(`${key}: `, margin + 3, y);
        const keyW = doc.getTextWidth(`${key}: `);
        doc.setFont("helvetica", "normal");
        const valLines = doc.splitTextToSize(value, usable - 6 - keyW);
        doc.text(valLines, margin + 3 + keyW, y);
        y += valLines.length * 4.5 + 1;
      };

      let sectionNum = 1;

      // Classification
      if (report.classification || report.product || report.input_summary) {
        sectionTitle("Identification du produit", sectionNum++);
        const cls = report.classification || report.product || {};
        if (report.input_summary?.product) kv("Produit", report.input_summary.product);
        if (cls.hs_code) kv("Code SH", cls.hs_code);
        if (cls.description) kv("Désignation", cls.description);
        if (cls.chapter) kv("Chapitre", cls.chapter);
        if (report.input_summary?.country) kv("Origine", report.input_summary.country);
        if (cls.reasoning) { y += 2; textBlock(`Justification: ${cls.reasoning}`); }
      }

      // Taxes
      if (report.taxes) {
        sectionTitle("Calcul des droits et taxes", sectionNum++);
        const taxes = report.taxes;
        if (taxes.caf_details?.length) {
          taxes.caf_details.forEach((d: string) => { checkPage(5); doc.text(d, margin + 3, y); y += 4.5; });
          y += 2;
        }
        if (taxes.lines?.length) {
          checkPage(taxes.lines.length * 6 + 15);
          doc.setFillColor(226, 232, 240);
          doc.rect(margin, y, usable, 7, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.text("Taxe", margin + 3, y + 5);
          doc.text("Taux", margin + 80, y + 5);
          doc.text("Base (MAD)", margin + 100, y + 5);
          doc.text("Montant (MAD)", margin + 135, y + 5);
          y += 9;
          doc.setFont("helvetica", "normal");
          taxes.lines.forEach((line: any) => {
            doc.text(String(line.tax).substring(0, 40), margin + 3, y + 4);
            doc.text(`${line.rate}%`, margin + 80, y + 4);
            doc.text(fmt(line.base), margin + 100, y + 4);
            doc.text(fmt(line.amount), margin + 135, y + 4);
            doc.setDrawColor(226, 232, 240);
            doc.line(margin, y + 6, margin + usable, y + 6);
            y += 7;
          });
          doc.setFillColor(219, 234, 254);
          doc.rect(margin, y, usable, 8, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.text("TOTAL À PAYER", margin + 3, y + 6);
          doc.text(`${fmt(taxes.total)} MAD`, margin + 135, y + 6);
          y += 12;
          doc.setFontSize(9);
          doc.setFont("helvetica", "normal");
        }
        if (taxes.savings > 0) {
          textBlock(`Économie accord préférentiel: ${fmt(taxes.savings)} MAD`);
        }
      }

      // Eligibility (MRE)
      if (report.eligibility) {
        sectionTitle("Éligibilité MRE", sectionNum++);
        kv("Statut", report.eligibility.eligible ? "ÉLIGIBLE" : "NON ÉLIGIBLE");
        report.eligibility.conditions_met?.forEach((c: string) => { checkPage(5); doc.text(`✓ ${c}`, margin + 3, y); y += 4.5; });
        report.eligibility.conditions_missing?.forEach((c: string) => { checkPage(5); doc.text(`✗ ${c}`, margin + 3, y); y += 4.5; });
        if (report.eligibility.legal_basis) kv("Base légale", report.eligibility.legal_basis);
      }

      // Vehicle taxes (MRE)
      if (report.vehicle_taxes?.with_mre) {
        sectionTitle("Calcul des droits (véhicule)", sectionNum++);
        const vt = report.vehicle_taxes;
        if (vt.with_mre.lines?.length) {
          vt.with_mre.lines.forEach((line: any) => {
            checkPage(5);
            doc.text(`${line.tax}: ${fmt(line.amount)} MAD (${line.rate}%)`, margin + 3, y);
            y += 4.5;
          });
          kv("Total avec abattement MRE", `${fmt(vt.with_mre.total)} MAD`);
          if (vt.savings > 0) kv("Économie MRE", `${fmt(vt.savings)} MAD`);
        }
      }

      // Conformity
      const conformities = report.conformity || report.checks;
      if (conformities?.length) {
        sectionTitle("Conformités et autorisations", sectionNum++);
        conformities.forEach((c: any) => {
          checkPage(12);
          const status = c.status === "required" ? "⚠ REQUIS" : c.status === "not_required" ? "✓ Non requis" : "ℹ Recommandé";
          doc.setFont("helvetica", "bold");
          doc.text(`${c.authority} — ${status}`, margin + 3, y);
          y += 4.5;
          doc.setFont("helvetica", "normal");
          if (c.reason) { doc.text(doc.splitTextToSize(c.reason, usable - 10), margin + 6, y); y += 4.5; }
          if (c.delay) { doc.text(`Délai: ${c.delay}`, margin + 6, y); y += 4.5; }
          if (c.cost) { doc.text(`Coût: ${c.cost}`, margin + 6, y); y += 4.5; }
          y += 2;
        });
      }

      // Documents
      if (report.documents?.length) {
        sectionTitle("Documents requis", sectionNum++);
        report.documents.forEach((d: any) => {
          checkPage(6);
          const marker = d.required ? "■" : "□";
          const suffix = d.required ? " (obligatoire)" : "";
          doc.text(`${marker} ${d.name}${suffix}`, margin + 3, y);
          y += 4.5;
          if (d.note) { doc.setFontSize(8); doc.text(`   ${d.note}`, margin + 3, y); y += 4; doc.setFontSize(9); }
        });
      }

      // Regime comparison (Investor)
      if (report.regime_comparison) {
        sectionTitle("Comparatif des régimes", sectionNum++);
        const comp = report.regime_comparison;
        checkPage(25);
        doc.setFillColor(226, 232, 240);
        doc.rect(margin, y, usable, 7, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(8);
        doc.text("Régime", margin + 3, y + 5);
        doc.text("Total (MAD)", margin + 120, y + 5);
        y += 9;
        doc.setFont("helvetica", "normal");
        [["Droit commun", comp.droit_commun], ["Franchise", comp.franchise], ["Zone franche", comp.zone_franche]].forEach(([name, data]: any) => {
          if (data) {
            doc.text(String(name), margin + 3, y + 4);
            doc.text(fmt(data.total || 0), margin + 120, y + 4);
            y += 7;
          }
        });
      }

      // Procedure
      if (report.procedure?.length) {
        sectionTitle("Procédure", sectionNum++);
        report.procedure.forEach((step: string, i: number) => {
          checkPage(6);
          const lines = doc.splitTextToSize(`${i + 1}. ${step}`, usable - 6);
          doc.text(lines, margin + 3, y);
          y += lines.length * 4.5 + 1;
        });
      }

      // Risks
      const risks = report.risks || report.warnings;
      if (risks?.length) {
        sectionTitle("Points d'attention", sectionNum++);
        risks.forEach((r: string) => { checkPage(5); textBlock(`⚠ ${r}`); });
      }

      // Sources
      if (report.sources?.length) {
        sectionTitle("Sources juridiques", sectionNum++);
        report.sources.forEach((s: string) => { checkPage(5); doc.text(`• ${s}`, margin + 3, y); y += 4.5; });
      }

      // Footer
      checkPage(20);
      y += 5;
      doc.setDrawColor(200, 200, 200);
      doc.line(margin, y, margin + usable, y);
      y += 5;
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      const disclaimer = "Ce rapport est fourni à titre informatif et ne constitue pas un renseignement tarifaire contraignant (RTC). Pour une certification officielle, adressez-vous à l'ADII (www.douane.gov.ma).";
      const disclaimerLines = doc.splitTextToSize(disclaimer, usable);
      doc.text(disclaimerLines, margin, y);
      y += disclaimerLines.length * 3.5 + 3;
      doc.text(`Généré par DouaneAI — ${date}`, margin, y);

      doc.save(`${reference}.pdf`);
    } catch (err) {
      console.error("PDF generation error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={generatePDF} variant="default" className="flex-1" disabled={loading}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
      {loading ? "Génération..." : "Export PDF"}
    </Button>
  );
}
