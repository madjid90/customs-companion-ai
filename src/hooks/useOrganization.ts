import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useOrganization() {
  return useQuery({
    queryKey: ["active-organization"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ensure_my_organization");
      if (error) throw error;
      if (!data?.[0]) throw new Error("Espace entreprise indisponible");
      return data[0];
    },
    staleTime: 5 * 60_000,
  });
}
