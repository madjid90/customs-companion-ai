import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useSearchParams } from "react-router-dom";
import { ConsultationWizard } from "@/components/consultation/ConsultationWizard";
import type { ConsultationMode } from "@/components/consultation/ConsultationModeSelector";

const Consultation = () => {
  const [searchParams] = useSearchParams();
  const [initialReport, setInitialReport] = useState<any>(null);
  const [initialMode, setInitialMode] = useState<ConsultationMode | undefined>();
  const [isLoading, setIsLoading] = useState(false);
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
      setInitialReport(data);
      setInitialMode(data.consultation_type as ConsultationMode);
    }
    setIsLoading(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-0 bg-background flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <ConsultationWizard
      initialMode={initialMode}
      initialReport={initialReport}
      onReset={() => {
        setInitialReport(null);
        setInitialMode(undefined);
      }}
    />
  );
};

export default Consultation;
