// ============================================================================
// CONSTRUCTION DU CONTEXTE RAG
// ============================================================================

import { cleanHSCode, formatHSCode, getParentCodes, getHSLevel, escapeSearchTerm } from "./hs-utils.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface TariffWithInheritance {
  found: boolean;
  code: string;
  code_clean: string;
  description: string;
  chapter: number;
  level: string;
  duty_rate: number | null;
  duty_rate_min?: number;
  duty_rate_max?: number;
  vat_rate: number;
  rate_source: "direct" | "inherited" | "range" | "not_found";
  children_count: number;
  is_prohibited: boolean;
  is_restricted: boolean;
  has_children_prohibited: boolean;
  has_children_restricted: boolean;
  legal_notes: string[];
  controls: Array<{
    type: string;
    authority: string;
    inherited: boolean;
  }>;
}

export interface RAGContext {
  tariffs_with_inheritance: TariffWithInheritance[];
  hs_codes: any[];
  tariffs: any[];
  controlled_products: any[];
  knowledge_documents: any[];
  pdf_summaries: any[];
  legal_references: any[];
  regulatory_procedures: any[];
}

// ============================================================================
// RECHERCHE AVEC HÉRITAGE HIÉRARCHIQUE
// ============================================================================

/**
 * Recherche un code SH avec héritage complet (ascendant et descendant)
 */
export async function searchHSCodeWithInheritance(
  supabase: any,
  code: string,
  countryCode: string = "MA"
): Promise<TariffWithInheritance> {
  const cleanCode = cleanHSCode(code);
  
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
    // 1. Chercher le code exact dans hs_codes
    const { data: hsCode } = await supabase
      .from("hs_codes")
      .select("*")
      .or(`code.eq.${formatHSCode(cleanCode)},code_clean.eq.${cleanCode}`)
      .eq("is_active", true)
      .maybeSingle();

    if (hsCode) {
      result.description = hsCode.description_fr || "";
      result.legal_notes = hsCode.legal_notes ? [hsCode.legal_notes] : [];
    }

    // 2. Chercher le tarif exact
    const { data: exactTariff } = await supabase
      .from("country_tariffs")
      .select("*")
      .eq("country_code", countryCode)
      .eq("is_active", true)
      .or(`national_code.eq.${cleanCode},hs_code_6.eq.${cleanCode.slice(0, 6)}`)
      .maybeSingle();

    if (exactTariff) {
      result.found = true;
      result.duty_rate = exactTariff.duty_rate;
      result.vat_rate = exactTariff.vat_rate || 20;
      result.is_prohibited = exactTariff.is_prohibited || false;
      result.is_restricted = exactTariff.is_restricted || false;
      result.rate_source = "direct";
      result.description = exactTariff.description_local || result.description;
      
      // Chercher les contrôles même pour tarif direct
      const { data: controls } = await supabase
        .from("controlled_products")
        .select("*")
        .eq("country_code", countryCode)
        .eq("is_active", true)
        .or(`hs_code.eq.${cleanCode},hs_code.like.${cleanCode.slice(0, 4)}%`);

      if (controls) {
        result.controls = controls.map((c: any) => ({
          type: c.control_type,
          authority: c.control_authority || "N/A",
          inherited: cleanHSCode(c.hs_code) !== cleanCode,
        }));
      }
      
      return result;
    }

    // 3. Chercher les enfants (codes plus spécifiques) - HÉRITAGE DESCENDANT
    const { data: children } = await supabase
      .from("country_tariffs")
      .select("*")
      .eq("country_code", countryCode)
      .eq("is_active", true)
      .like("national_code", `${cleanCode}%`)
      .neq("national_code", cleanCode);

    if (children && children.length > 0) {
      result.found = true;
      result.children_count = children.length;

      const rates = children
        .map((c: any) => c.duty_rate)
        .filter((r: any): r is number => r !== null && r !== undefined);

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

      result.has_children_prohibited = children.some((c: any) => c.is_prohibited);
      result.has_children_restricted = children.some((c: any) => c.is_restricted);

      if (!result.description && children[0]?.description_local) {
        result.description = children[0].description_local;
      }
    }

    // 4. Chercher les notes légales des parents - HÉRITAGE ASCENDANT
    const parentCodes = getParentCodes(cleanCode);
    if (parentCodes.length > 0) {
      const { data: parentNotes } = await supabase
        .from("hs_codes")
        .select("code, legal_notes")
        .in("code_clean", parentCodes)
        .eq("is_active", true)
        .not("legal_notes", "is", null);

      if (parentNotes) {
        const notes = parentNotes
          .filter((p: any) => p.legal_notes)
          .map((p: any) => `[${p.code}] ${p.legal_notes}`);
        result.legal_notes = [...notes, ...result.legal_notes];
      }
    }

    // 5. Chercher les contrôles hérités
    const { data: controls } = await supabase
      .from("controlled_products")
      .select("*")
      .eq("country_code", countryCode)
      .eq("is_active", true)
      .or(`hs_code.eq.${cleanCode},hs_code.like.${cleanCode.slice(0, 4)}%`);

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
}

/**
 * Formate le tarif avec héritage pour le contexte RAG
 */
export function formatTariffForRAG(tariff: TariffWithInheritance): string {
  let text = `## Code ${tariff.code}\n`;
  text += `**Description:** ${tariff.description}\n`;
  text += `**Niveau:** ${tariff.level} | **Chapitre:** ${tariff.chapter}\n\n`;

  if (tariff.rate_source === "range" && tariff.duty_rate_min !== undefined && tariff.duty_rate_max !== undefined) {
    text += `**DDI:** ${tariff.duty_rate_min}% à ${tariff.duty_rate_max}% (selon sous-position)\n`;
    text += `Ce code a ${tariff.children_count} sous-positions avec des taux différents. Précisez le code complet.\n`;
  } else if (tariff.duty_rate !== null) {
    text += `**DDI:** ${tariff.duty_rate}%`;
    if (tariff.rate_source === "inherited") {
      text += ` (hérité de ${tariff.children_count} sous-position(s))`;
    }
    text += `\n`;
  } else {
    text += `**DDI:** Non trouvé\n`;
  }
  text += `**TVA:** ${tariff.vat_rate}%\n\n`;

  if (tariff.is_prohibited) text += `**INTERDIT à l'importation**\n`;
  if (tariff.is_restricted) text += `**RESTREINT** - licence potentiellement requise\n`;
  if (tariff.has_children_prohibited) text += `Certaines sous-positions sont INTERDITES\n`;
  if (tariff.has_children_restricted) text += `Certaines sous-positions sont RESTREINTES\n`;

  if (tariff.controls.length > 0) {
    text += `\n**Contrôles requis:**\n`;
    tariff.controls.forEach((c) => {
      text += `- ${c.type} par ${c.authority}${c.inherited ? " [hérité du parent]" : ""}\n`;
    });
  }

  if (tariff.legal_notes.length > 0) {
    text += `\n**Notes légales:**\n`;
    tariff.legal_notes.forEach((n) => text += `> ${n}\n`);
  }

  return text;
}

/**
 * Crée le contexte RAG vide initial
 */
export function createEmptyContext(): RAGContext {
  return {
    tariffs_with_inheritance: [],
    hs_codes: [],
    tariffs: [],
    controlled_products: [],
    knowledge_documents: [],
    pdf_summaries: [],
    legal_references: [],
    regulatory_procedures: [],
  };
}

/**
 * Construit les sources disponibles pour les citations
 */
export function buildAvailableSources(
  context: RAGContext,
  supabaseUrl: string
): string[] {
  const availableSources: string[] = [];
  
  // Add PDF sources
  if (context.pdf_summaries.length > 0) {
    context.pdf_summaries.forEach((pdf: any) => {
      if (pdf.title && pdf.download_url) {
        availableSources.push(`DOCUMENT: "${pdf.title}"\nURL_TÉLÉCHARGEMENT: ${pdf.download_url}`);
      }
    });
  }
  
  // Add legal reference sources
  if (context.legal_references.length > 0) {
    context.legal_references.forEach((ref: any) => {
      if (ref.download_url) {
        availableSources.push(`DOCUMENT: "${ref.reference_type} ${ref.reference_number} - ${ref.title || 'Document officiel'}"\nURL_TÉLÉCHARGEMENT: ${ref.download_url}`);
      }
    });
  }
  
  return availableSources;
}
