import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ConsultationModeSelector, type ConsultationMode } from "@/components/consultation/ConsultationModeSelector";
import { ImportForm, type ImportFormData } from "@/components/consultation/ImportForm";
import { MREForm, type MREFormData } from "@/components/consultation/MREForm";
import { ConformityForm, type ConformityFormData } from "@/components/consultation/ConformityForm";
import { InvestorForm, type InvestorFormData } from "@/components/consultation/InvestorForm";
import { ConsultationReport } from "@/components/consultation/ConsultationReport";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSearchParams } from "react-router-dom";
import { useEffect } from "react";

const Consultation = () => {
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<ConsultationMode>("import");
  const [isLoading, setIsLoading] = useState(false);
  const [reportData, setReportData] = useState<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    const ref = searchParams.get("ref");
    if (ref) {
      loadConsultation(ref);
    }
  }, [searchParams]);

  const loadConsultation = async (ref: string) => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("consultations")
      .select("*")
      .eq("reference", ref)
      .single();

    if (error) {
      toast({ title: "Erreur", description: "Consultation introuvable", variant: "destructive" });
    } else {
      setReportData(data);
      setMode(data.consultation_type as ConsultationMode);
    }
    setIsLoading(false);
  };

  const submitConsultation = async (type: string, inputs: any) => {
    setIsLoading(true);
    setReportData(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Erreur", description: "Vous devez être connecté.", variant: "destructive" });
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/consultation-report`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ type, inputs }),
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
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportSubmit = (data: ImportFormData) => submitConsultation("import", data);
  const handleMRESubmit = (data: MREFormData) => submitConsultation("mre", data);
  const handleConformitySubmit = (data: ConformityFormData) => submitConsultation("conformity", data);
  const handleInvestorSubmit = (data: InvestorFormData) => submitConsultation("investor", data);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Consultation douanière</h1>
          <p className="text-sm text-muted-foreground mt-1">Générez un rapport complet avec classification, taxes et conformités</p>
        </div>

        {/* Mode selector */}
        {!reportData && <ConsultationModeSelector selected={mode} onSelect={setMode} />}

        {/* Show report or form */}
        {reportData ? (
          <div className="space-y-4">
            <Button variant="outline" onClick={() => setReportData(null)} className="gap-2">
              <ArrowLeft className="h-4 w-4" />Nouvelle consultation
            </Button>
            <ConsultationReport 
              data={reportData} 
              type={mode} 
              onNewConsultation={() => setReportData(null)}
            />
          </div>
        ) : (
          <>
            {mode === "import" && <ImportForm onSubmit={handleImportSubmit} isLoading={isLoading} />}
            {mode === "mre" && <MREForm onSubmit={handleMRESubmit} isLoading={isLoading} />}
            {mode === "conformity" && <ConformityForm onSubmit={handleConformitySubmit} isLoading={isLoading} />}
            {mode === "investor" && <InvestorForm onSubmit={handleInvestorSubmit} isLoading={isLoading} />}
          </>
        )}
      </div>
    </div>
  );
};

export default Consultation;
