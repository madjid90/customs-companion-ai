// ============================================================================
// src/lib/hsCodeInheritance.ts
// Logique métier d'héritage hiérarchique des codes SH (chapitre → ligne tarifaire)
// ============================================================================

import { supabase } from "@/integrations/supabase/client";

// Types
export interface TariffWithInheritance {
  found: boolean;
  code: string;
  code_clean: string;
  description: string;
  chapter: number;
  level: string;
  
  // Taux
  duty_rate: number | null;
  duty_rate_min?: number;
  duty_rate_max?: number;
  vat_rate: number;
  
  // Source
  rate_source: "direct" | "inherited" | "range" | "not_found";
  children_count: number;
  
  // Statuts
  is_prohibited: boolean;
  is_restricted: boolean;
  has_children_prohibited: boolean;
  has_children_restricted: boolean;
  
  // Notes et contrôles
  legal_notes: string[];
  controls: Array<{
    type: string;
    authority: string;
    inherited: boolean;
  }>;
}

export interface DutyCalculation {
  code: string;
  description: string;
  cif_value: number;
  
  duty_rate: number;
  vat_rate: number;
  
  duty_amount: number;
  taxable_base: number;
  vat_amount: number;
  total_duties: number;
  total_cost: number;
  
  rate_source: string;
  is_range: boolean;
  warnings: string[];
}

// ============================================================================
// UTILITAIRES
// ============================================================================

export const cleanHSCode = (code: string): string => {
  return code.replace(/[\.\s\-]/g, "").trim();
};

export const formatHSCode = (code: string): string => {
  const clean = cleanHSCode(code);
  if (clean.length <= 2) return clean;
  if (clean.length <= 4) return clean.slice(0, 2) + "." + clean.slice(2);
  if (clean.length <= 6) return clean.slice(0, 4) + "." + clean.slice(4);
  if (clean.length <= 8) return clean.slice(0, 4) + "." + clean.slice(4, 6) + "." + clean.slice(6);
  return clean.slice(0, 4) + "." + clean.slice(4, 6) + "." + clean.slice(6, 8) + "." + clean.slice(8);
};

export const getParentCodes = (code: string): string[] => {
  const clean = cleanHSCode(code);
  const parents: string[] = [];
  if (clean.length > 2) parents.push(clean.slice(0, 2));
  if (clean.length > 4) parents.push(clean.slice(0, 4));
  if (clean.length > 6) parents.push(clean.slice(0, 6));
  if (clean.length > 8) parents.push(clean.slice(0, 8));
  return parents;
};

export const getHSLevel = (code: string): string => {
  const len = cleanHSCode(code).length;
  if (len <= 2) return "chapter";
  if (len <= 4) return "heading";
  if (len <= 6) return "subheading";
  return "tariff_line";
};

// ============================================================================
// RECHERCHE AVEC HÉRITAGE
// ============================================================================

export const searchHSCodeWithInheritance = async (
  code: string,
  countryCode: string = "MA"
): Promise<TariffWithInheritance> => {
  const cleanCode = cleanHSCode(code);
  
  // Résultat par défaut
  const result: TariffWithInheritance = {
    found: false,
    code: formatHSCode(cleanCode),
    code_clean: cleanCode,
    description: "",
    chapter: parseInt(cleanCode.slice(0, 2)) || 0,
    level: getHSLevel(cleanCode),
    duty_rate: null,
    vat_rate: 20,
    rate_source: "not_found",
    children_count: 0,
    is_prohibited: false,
    is_restricted: false,
    has_children_prohibited: false,
    has_children_restricted: false,
    legal_notes: [],
    controls: [],
  };

  try {
    const parentCodes = getParentCodes(cleanCode);

    // Lancer toutes les requêtes indépendantes en parallèle
    const [
      hsCodeRes,
      exactTariffRes,
      childrenRes,
      parentNotesRes,
      controlsRes,
    ] = await Promise.all([
      supabase
        .from("hs_codes")
        .select("*")
        .or(`code.eq.${formatHSCode(cleanCode)},code_clean.eq.${cleanCode}`)
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("country_tariffs")
        .select("*")
        .eq("country_code", countryCode)
        .eq("is_active", true)
        .or(`national_code.eq.${cleanCode},hs_code_6.eq.${cleanCode.slice(0, 6)}`)
        .maybeSingle(),
      supabase
        .from("country_tariffs")
        .select("*")
        .eq("country_code", countryCode)
        .eq("is_active", true)
        .like("national_code", `${cleanCode}%`)
        .neq("national_code", cleanCode),
      parentCodes.length > 0
        ? supabase
            .from("hs_codes")
            .select("code, legal_notes")
            .in("code_clean", parentCodes)
            .eq("is_active", true)
            .not("legal_notes", "is", null)
        : Promise.resolve({ data: null }),
      supabase
        .from("controlled_products")
        .select("*")
        .eq("country_code", countryCode)
        .eq("is_active", true)
        .or(`hs_code.eq.${cleanCode},hs_code.like.${cleanCode.slice(0, 4)}%`),
    ]);

    const hsCode = hsCodeRes.data;
    const exactTariff = exactTariffRes.data;
    const children = childrenRes.data;
    const parentNotes = parentNotesRes.data;
    const controls = controlsRes.data;

    if (hsCode) {
      result.description = hsCode.description_fr || "";
      result.legal_notes = hsCode.legal_notes ? [hsCode.legal_notes] : [];
    }

    if (exactTariff) {
      result.found = true;
      result.duty_rate = exactTariff.duty_rate;
      result.vat_rate = exactTariff.vat_rate || 20;
      result.is_prohibited = exactTariff.is_prohibited || false;
      result.is_restricted = exactTariff.is_restricted || false;
      result.rate_source = "direct";
      result.description = exactTariff.description_local || result.description;

      // Notes parents (toujours utiles même si tarif exact trouvé)
      if (parentNotes) {
        const notes = parentNotes
          .filter((p: any) => p.legal_notes)
          .map((p: any) => `[${p.code}] ${p.legal_notes}`);
        result.legal_notes = [...notes, ...result.legal_notes];
      }
      if (controls) {
        result.controls = controls.map((c: any) => ({
          type: c.control_type,
          authority: c.control_authority || "N/A",
          inherited: cleanHSCode(c.hs_code) !== cleanCode,
        }));
      }
      return result;
    }

    if (children && children.length > 0) {
      result.found = true;
      result.children_count = children.length;

      const rates = children
        .map((c) => c.duty_rate)
        .filter((r): r is number => r !== null && r !== undefined);

      if (rates.length > 0) {
        const minRate = Math.min(...rates);
        const maxRate = Math.max(...rates);

        result.duty_rate_min = minRate;
        result.duty_rate_max = maxRate;

        if (minRate === maxRate) {
          result.duty_rate = minRate;
          result.rate_source = "inherited";
        } else {
          result.duty_rate = null;
          result.rate_source = "range";
        }
      }

      result.has_children_prohibited = children.some((c) => c.is_prohibited);
      result.has_children_restricted = children.some((c) => c.is_restricted);

      if (!result.description && children[0]?.description_local) {
        result.description = children[0].description_local;
      }
    }

    if (parentNotes) {
      const notes = parentNotes
        .filter((p: any) => p.legal_notes)
        .map((p: any) => `[${p.code}] ${p.legal_notes}`);
      result.legal_notes = [...notes, ...result.legal_notes];
    }

    if (controls) {
      result.controls = controls.map((c: any) => ({
        type: c.control_type,
        authority: c.control_authority || "N/A",
        inherited: cleanHSCode(c.hs_code) !== cleanCode,
      }));
    }

    return result;

  } catch (error) {
    console.error("Erreur searchHSCodeWithInheritance:", error);
    return result;
  }
};

// ============================================================================
// CALCUL DES DROITS AVEC HÉRITAGE
// ============================================================================

export const calculateDutiesWithInheritance = async (
  code: string,
  cifValue: number,
  countryCode: string = "MA"
): Promise<DutyCalculation | null> => {
  const tariff = await searchHSCodeWithInheritance(code, countryCode);

  if (!tariff.found) {
    return null;
  }

  const warnings: string[] = [];
  let dutyRate = tariff.duty_rate;
  let isRange = false;

  // Gérer les fourchettes
  if (tariff.rate_source === "range" && tariff.duty_rate_min !== undefined && tariff.duty_rate_max !== undefined) {
    dutyRate = (tariff.duty_rate_min + tariff.duty_rate_max) / 2;
    isRange = true;
    warnings.push(
      `⚠️ Ce code a des sous-positions avec des taux différents (${tariff.duty_rate_min}% à ${tariff.duty_rate_max}%). ` +
      `Calcul basé sur le taux moyen. Précisez le code complet pour un calcul exact.`
    );
  }

  if (tariff.rate_source === "inherited") {
    warnings.push(`ℹ️ Taux hérité de ${tariff.children_count} sous-position(s).`);
  }

  if (dutyRate === null) {
    dutyRate = 0;
    warnings.push("⚠️ Aucun taux trouvé, calcul avec DDI = 0%.");
  }

  // Avertissements statuts
  if (tariff.is_prohibited) {
    warnings.push("🚫 ATTENTION: Ce produit est INTERDIT à l'importation!");
  }
  if (tariff.is_restricted) {
    warnings.push("⚠️ Ce produit est RESTREINT. Une licence peut être requise.");
  }
  if (tariff.has_children_prohibited) {
    warnings.push("🚫 Certaines sous-positions sont INTERDITES.");
  }
  if (tariff.has_children_restricted) {
    warnings.push("⚠️ Certaines sous-positions sont RESTREINTES.");
  }

  // Avertissements contrôles
  tariff.controls.forEach((c) => {
    warnings.push(`📋 Contrôle ${c.type} requis par ${c.authority}${c.inherited ? " (hérité)" : ""}`);
  });

  // Calculs
  const dutyAmount = cifValue * (dutyRate / 100);
  const taxableBase = cifValue + dutyAmount;
  const vatAmount = taxableBase * (tariff.vat_rate / 100);
  const totalDuties = dutyAmount + vatAmount;
  const totalCost = cifValue + totalDuties;

  return {
    code: tariff.code,
    description: tariff.description,
    cif_value: cifValue,
    duty_rate: dutyRate,
    vat_rate: tariff.vat_rate,
    duty_amount: Math.round(dutyAmount * 100) / 100,
    taxable_base: Math.round(taxableBase * 100) / 100,
    vat_amount: Math.round(vatAmount * 100) / 100,
    total_duties: Math.round(totalDuties * 100) / 100,
    total_cost: Math.round(totalCost * 100) / 100,
    rate_source: tariff.rate_source,
    is_range: isRange,
    warnings,
  };
};

// ============================================================================
// RECHERCHE PAR TEXTE
// ============================================================================

export const searchByDescription = async (
  searchText: string,
  countryCode: string = "MA",
  limit: number = 10
): Promise<TariffWithInheritance[]> => {
  try {
    // Chercher dans hs_codes et country_tariffs
    const { data: hsCodes } = await supabase
      .from("hs_codes")
      .select("code, code_clean")
      .ilike("description_fr", `%${searchText}%`)
      .eq("is_active", true)
      .limit(limit);

    const { data: tariffs } = await supabase
      .from("country_tariffs")
      .select("national_code, hs_code_6")
      .eq("country_code", countryCode)
      .ilike("description_local", `%${searchText}%`)
      .eq("is_active", true)
      .limit(limit);

    // Combiner les codes uniques
    const codesSet = new Set<string>();
    hsCodes?.forEach((h) => codesSet.add(h.code_clean || cleanHSCode(h.code)));
    tariffs?.forEach((t) => codesSet.add(t.national_code || t.hs_code_6));

    // Rechercher chaque code avec héritage
    const results: TariffWithInheritance[] = [];
    for (const code of Array.from(codesSet).slice(0, limit)) {
      const result = await searchHSCodeWithInheritance(code, countryCode);
      if (result.found) {
        results.push(result);
      }
    }

    return results;
  } catch (error) {
    console.error("Erreur searchByDescription:", error);
    return [];
  }
};

// ============================================================================
// FORMAT POUR RAG
// ============================================================================

export const formatTariffForRAG = (tariff: TariffWithInheritance): string => {
  let text = `## Code ${tariff.code}\n`;
  text += `**Description:** ${tariff.description}\n`;
  text += `**Chapitre:** ${tariff.chapter}\n\n`;

  if (tariff.rate_source === "range") {
    text += `**DDI:** ${tariff.duty_rate_min}% à ${tariff.duty_rate_max}% (selon sous-position)\n`;
  } else if (tariff.duty_rate !== null) {
    text += `**DDI:** ${tariff.duty_rate}%`;
    if (tariff.rate_source === "inherited") {
      text += ` (hérité de ${tariff.children_count} sous-positions)`;
    }
    text += `\n`;
  }
  text += `**TVA:** ${tariff.vat_rate}%\n\n`;

  if (tariff.is_prohibited) text += `🚫 **INTERDIT**\n`;
  if (tariff.is_restricted) text += `⚠️ **RESTREINT**\n`;
  if (tariff.has_children_prohibited) text += `🚫 Certains codes enfants INTERDITS\n`;
  if (tariff.has_children_restricted) text += `⚠️ Certains codes enfants RESTREINTS\n`;

  if (tariff.controls.length > 0) {
    text += `\n**Contrôles:**\n`;
    tariff.controls.forEach((c) => {
      text += `- ${c.type} (${c.authority})${c.inherited ? " [hérité]" : ""}\n`;
    });
  }

  if (tariff.legal_notes.length > 0) {
    text += `\n**Notes légales:**\n`;
    tariff.legal_notes.forEach((n) => text += `> ${n}\n`);
  }

  return text;
};

export default {
  cleanHSCode,
  formatHSCode,
  getParentCodes,
  getHSLevel,
  searchHSCodeWithInheritance,
  calculateDutiesWithInheritance,
  searchByDescription,
  formatTariffForRAG,
};
