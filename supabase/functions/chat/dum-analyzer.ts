// ============================================================================
// ANALYSEUR DE DUM (DÉCLARATION UNIQUE DE MARCHANDISES)
// ============================================================================

import { cleanHSCode, formatHSCode } from "./hs-utils.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface DUMData {
  isDUM: boolean;
  dumNumber: string | null;
  bureauCode: string | null;
  registrationDate: string | null;
  
  // Parties
  exporter: {
    name: string;
    country: string;
    countryCode: string;
  } | null;
  importer: {
    name: string;
    ice: string;
    address: string;
  } | null;
  declarant: {
    id: string;
    agreementNumber: string;
  } | null;
  
  // Marchandises
  goods: Array<{
    description: string;
    hsCode: string;
    hsCode6: string;
    quantity: number;
    unit: string;
    declaredValue: number;
    currency: string;
    weight: number;
    countryOfOrigin: string;
    countryOfOriginCode: string;
  }>;
  
  // Valeurs totales
  totals: {
    grossWeight: number;
    netWeight: number;
    declaredValue: number;
    currency: string;
    exchangeRate: number;
    freight: number;
    insurance: number;
    totalValueMAD: number;
  };
  
  // Transport
  transport: {
    mode: string;
    modeCode: string;
    vesselName: string;
    transportDocNumber: string;
    arrivalDate: string;
  } | null;
  
  // Données financières
  financial: {
    paymentMethod: string;
    bankReference: string;
  } | null;
}

export interface DUMVerificationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  calculatedTaxes: {
    dutyRate: number | null;
    dutyAmount: number;
    vatRate: number;
    vatAmount: number;
    otherTaxes: number;
    totalTaxes: number;
    taxableBase: number;
  };
  controlsRequired: Array<{
    type: string;
    authority: string;
    reason: string;
  }>;
  hsCodeVerification: {
    declaredCode: string;
    suggestedCodes: string[];
    matchConfidence: number;
    discrepancies: string[];
  };
}

export interface DUMAnalysisResult {
  extracted: DUMData;
  verification: DUMVerificationResult;
  summary: string;
}

// ============================================================================
// PROMPT D'EXTRACTION DUM
// ============================================================================

export function getDUMExtractionPrompt(): string {
  return `Tu es un expert en douane marocaine spécialisé dans l'analyse des DUM (Déclarations Uniques de Marchandises).

ANALYSE CE DOCUMENT DUM ET EXTRAIS TOUTES LES INFORMATIONS en JSON avec ce format EXACT:

{
  "isDUM": true,
  "dumNumber": "numéro de la DUM (DOS N ou numéro après 'bureau')",
  "bureauCode": "code bureau douanier (ex: 300)",
  "registrationDate": "date d'enregistrement (format ISO: YYYY-MM-DD)",
  
  "exporter": {
    "name": "nom de l'exportateur/expéditeur",
    "country": "pays en français",
    "countryCode": "code ISO 2 lettres"
  },
  
  "importer": {
    "name": "nom de l'importateur/destinataire",
    "ice": "numéro ICE complet",
    "address": "adresse complète"
  },
  
  "declarant": {
    "id": "identifiant déclarant (ex: BE420634)",
    "agreementNumber": "numéro d'agrément"
  },
  
  "goods": [
    {
      "description": "désignation commerciale complète",
      "hsCode": "code SH complet (10 chiffres)",
      "hsCode6": "code SH à 6 chiffres",
      "quantity": 0,
      "unit": "unité (KG, U, etc.)",
      "declaredValue": 0,
      "currency": "devise (MAD, USD, EUR)",
      "weight": 0,
      "countryOfOrigin": "pays d'origine en français",
      "countryOfOriginCode": "code ISO 2 lettres"
    }
  ],
  
  "totals": {
    "grossWeight": 0,
    "netWeight": 0,
    "declaredValue": 0,
    "currency": "MAD",
    "exchangeRate": 0,
    "freight": 0,
    "insurance": 0,
    "totalValueMAD": 0
  },
  
  "transport": {
    "mode": "mode de transport (Navire, Camion, Avion)",
    "modeCode": "code mode (01=Maritime, 02=Ferroviaire, 03=Routier, 04=Aérien)",
    "vesselName": "nom du navire/véhicule",
    "transportDocNumber": "numéro du titre de transport",
    "arrivalDate": "date d'arrivée (format ISO)"
  },
  
  "financial": {
    "paymentMethod": "mode de paiement (Comptant, Crédit, etc.)",
    "bankReference": "référence bancaire si disponible"
  }
}

RÈGLES IMPÉRATIVES:
1. EXTRAIS CHAQUE CHAMP avec la valeur exacte du document
2. Pour les codes SH: conserve le format exact du document (ex: 8301400000)
3. Pour les montants: utilise des nombres (pas de chaînes)
4. Si une information n'est pas trouvée, utilise null
5. Le champ "goods" doit contenir TOUTES les lignes de marchandises
6. Calcule totalValueMAD = declaredValue * exchangeRate si possible`;
}

// ============================================================================
// DÉTECTION DE TYPE DUM
// ============================================================================

/**
 * Détecte si un document est une DUM basé sur le contenu
 */
export function detectDUMDocument(content: string): boolean {
  const dumIndicators = [
    /D\.?U\.?M/i,
    /DECLARATION\s+(UNIQUE|A\s+ENREGISTREMENT)/i,
    /ADMINISTRATION\s+DES\s+DOUANES/i,
    /Importateur\s*\/\s*Destinataire/i,
    /Exportateur\s*\/\s*Expéditeur/i,
    /DOS\s*N/i,
    /LIQUIDATION\s+DES\s+DROITS/i,
    /Poids\s+brut\s+total/i,
    /Code\s+marchandises/i,
    /bureau\s+\d{3}/i,
  ];
  
  let matchCount = 0;
  for (const pattern of dumIndicators) {
    if (pattern.test(content)) {
      matchCount++;
    }
  }
  
  // Si au moins 4 indicateurs correspondent, c'est probablement une DUM
  return matchCount >= 4;
}

// ============================================================================
// CALCUL DES DROITS ET TAXES
// ============================================================================

/**
 * Calcule les droits et taxes pour une marchandise
 */
export async function calculateDuties(
  supabase: any,
  hsCode: string,
  valueMAD: number,
  countryCode: string = "MA"
): Promise<{
  dutyRate: number | null;
  dutyAmount: number;
  vatRate: number;
  vatAmount: number;
  otherTaxes: number;
  totalTaxes: number;
  taxableBase: number;
}> {
  const cleanCode = cleanHSCode(hsCode);
  const hs6 = cleanCode.slice(0, 6);
  
  // Rechercher le tarif
  const { data: tariff } = await supabase
    .from("country_tariffs")
    .select("duty_rate, vat_rate, other_taxes")
    .eq("country_code", countryCode)
    .eq("is_active", true)
    .or(`national_code.eq.${cleanCode},hs_code_6.eq.${hs6}`)
    .maybeSingle();
  
  const dutyRate = tariff?.duty_rate ?? null;
  const vatRate = tariff?.vat_rate ?? 20;
  
  // Calcul des droits
  const dutyAmount = dutyRate !== null ? (valueMAD * dutyRate / 100) : 0;
  
  // Base imposable pour TVA = valeur + droits de douane
  const taxableBase = valueMAD + dutyAmount;
  
  // Calcul TVA
  const vatAmount = taxableBase * vatRate / 100;
  
  // Autres taxes (si applicable)
  let otherTaxes = 0;
  if (tariff?.other_taxes) {
    const taxes = tariff.other_taxes;
    if (typeof taxes === 'object') {
      for (const [, rate] of Object.entries(taxes)) {
        if (typeof rate === 'number') {
          otherTaxes += valueMAD * rate / 100;
        }
      }
    }
  }
  
  return {
    dutyRate,
    dutyAmount: Math.round(dutyAmount * 100) / 100,
    vatRate,
    vatAmount: Math.round(vatAmount * 100) / 100,
    otherTaxes: Math.round(otherTaxes * 100) / 100,
    totalTaxes: Math.round((dutyAmount + vatAmount + otherTaxes) * 100) / 100,
    taxableBase: Math.round(taxableBase * 100) / 100,
  };
}

// ============================================================================
// VÉRIFICATION DE CONFORMITÉ
// ============================================================================

/**
 * Vérifie la conformité d'une DUM
 */
export async function verifyDUMCompliance(
  supabase: any,
  dumData: DUMData
): Promise<DUMVerificationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const controlsRequired: Array<{ type: string; authority: string; reason: string }> = [];
  const suggestedCodes: string[] = [];
  const discrepancies: string[] = [];
  
  // Vérifications de base
  if (!dumData.dumNumber) {
    errors.push("Numéro de DUM non trouvé");
  }
  
  if (dumData.goods.length === 0) {
    errors.push("Aucune marchandise déclarée");
  }
  
  // Vérifier chaque article
  let totalCalculatedTaxes = {
    dutyRate: null as number | null,
    dutyAmount: 0,
    vatRate: 20,
    vatAmount: 0,
    otherTaxes: 0,
    totalTaxes: 0,
    taxableBase: 0,
  };
  
  for (const good of dumData.goods) {
    const cleanCode = cleanHSCode(good.hsCode);
    const hs6 = cleanCode.slice(0, 6);
    
    // 1. Vérifier si le code SH existe
    const { data: hsCodeExists } = await supabase
      .from("hs_codes")
      .select("code, description_fr")
      .eq("is_active", true)
      .or(`code_clean.eq.${cleanCode},code_clean.eq.${hs6}`)
      .maybeSingle();
    
    if (!hsCodeExists) {
      warnings.push(`Code SH ${good.hsCode} non trouvé dans la nomenclature`);
    }
    
    // 2. Vérifier les contrôles requis
    const { data: controls } = await supabase
      .from("controlled_products")
      .select("control_type, control_authority, notes")
      .eq("is_active", true)
      .or(`hs_code.eq.${cleanCode},hs_code.like.${hs6}%,hs_code.like.${cleanCode.slice(0, 4)}%`);
    
    if (controls && controls.length > 0) {
      for (const ctrl of controls) {
        const existing = controlsRequired.find(
          c => c.type === ctrl.control_type && c.authority === ctrl.control_authority
        );
        if (!existing) {
          controlsRequired.push({
            type: ctrl.control_type,
            authority: ctrl.control_authority || "Non spécifié",
            reason: ctrl.notes || `Requis pour le code ${good.hsCode}`,
          });
        }
      }
    }
    
    // 3. Vérifier si produit interdit ou restreint
    const { data: tariff } = await supabase
      .from("country_tariffs")
      .select("is_prohibited, is_restricted, restriction_notes")
      .eq("country_code", "MA")
      .eq("is_active", true)
      .or(`national_code.eq.${cleanCode},hs_code_6.eq.${hs6}`)
      .maybeSingle();
    
    if (tariff?.is_prohibited) {
      errors.push(`PRODUIT INTERDIT: ${good.description} (${good.hsCode})`);
    }
    if (tariff?.is_restricted) {
      warnings.push(`Produit restreint: ${good.description} - ${tariff.restriction_notes || "Licence requise"}`);
    }
    
    // 4. Calculer les droits pour cet article
    const valueMAD = good.declaredValue * (dumData.totals.exchangeRate || 1);
    const duties = await calculateDuties(supabase, good.hsCode, valueMAD);
    
    totalCalculatedTaxes.dutyAmount += duties.dutyAmount;
    totalCalculatedTaxes.vatAmount += duties.vatAmount;
    totalCalculatedTaxes.otherTaxes += duties.otherTaxes;
    totalCalculatedTaxes.totalTaxes += duties.totalTaxes;
    totalCalculatedTaxes.taxableBase += duties.taxableBase;
    
    if (duties.dutyRate !== null) {
      totalCalculatedTaxes.dutyRate = duties.dutyRate;
    }
    totalCalculatedTaxes.vatRate = duties.vatRate;
  }
  
  // 5. Recherche de codes SH suggérés basée sur la description
  if (dumData.goods.length > 0) {
    const mainGood = dumData.goods[0];
    const { data: similarCodes } = await supabase
      .from("hs_codes")
      .select("code, description_fr")
      .eq("is_active", true)
      .ilike("description_fr", `%${mainGood.description.split(" ")[0]}%`)
      .limit(5);
    
    if (similarCodes) {
      suggestedCodes.push(...similarCodes.map((c: any) => c.code));
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    calculatedTaxes: totalCalculatedTaxes,
    controlsRequired,
    hsCodeVerification: {
      declaredCode: dumData.goods[0]?.hsCode || "",
      suggestedCodes,
      matchConfidence: suggestedCodes.length > 0 ? 0.8 : 0.5,
      discrepancies,
    },
  };
}

// ============================================================================
// FORMATAGE POUR RÉPONSE
// ============================================================================

/**
 * Formate le résultat d'analyse DUM pour la réponse chat
 */
export function formatDUMAnalysisForChat(result: DUMAnalysisResult): string {
  const { extracted, verification } = result;
  let response = `## 📋 Analyse de la DUM ${extracted.dumNumber || "N/A"}\n\n`;
  
  // Résumé
  response += `### 📊 Résumé de la déclaration\n`;
  response += `| Champ | Valeur |\n|-------|--------|\n`;
  response += `| N° DUM | ${extracted.dumNumber || "N/A"} |\n`;
  response += `| Bureau | ${extracted.bureauCode || "N/A"} |\n`;
  response += `| Date | ${extracted.registrationDate || "N/A"} |\n`;
  
  if (extracted.exporter) {
    response += `| Exportateur | ${extracted.exporter.name} (${extracted.exporter.country}) |\n`;
  }
  if (extracted.importer) {
    response += `| Importateur | ${extracted.importer.name} |\n`;
    response += `| ICE | ${extracted.importer.ice} |\n`;
  }
  
  // Marchandises
  response += `\n### 📦 Marchandises déclarées\n`;
  for (const good of extracted.goods) {
    response += `\n**${good.description}**\n`;
    response += `- Code SH: \`${formatHSCode(good.hsCode)}\`\n`;
    response += `- Quantité: ${good.quantity} ${good.unit}\n`;
    response += `- Poids: ${good.weight} kg\n`;
    response += `- Valeur: ${good.declaredValue.toLocaleString()} ${good.currency}\n`;
    response += `- Origine: ${good.countryOfOrigin}\n`;
  }
  
  // Totaux
  response += `\n### 💰 Valeurs totales\n`;
  response += `| Élément | Montant |\n|---------|--------|\n`;
  response += `| Valeur déclarée | ${extracted.totals.declaredValue.toLocaleString()} ${extracted.totals.currency} |\n`;
  response += `| Taux de change | ${extracted.totals.exchangeRate} |\n`;
  response += `| Valeur en MAD | ${extracted.totals.totalValueMAD.toLocaleString()} MAD |\n`;
  response += `| Poids net | ${extracted.totals.netWeight} kg |\n`;
  response += `| Fret | ${extracted.totals.freight.toLocaleString()} MAD |\n`;
  response += `| Assurance | ${extracted.totals.insurance.toLocaleString()} MAD |\n`;
  
  // Calcul des droits et taxes
  response += `\n### 🧮 Calcul des droits et taxes\n`;
  const taxes = verification.calculatedTaxes;
  response += `| Taxe | Taux | Montant |\n|------|------|--------|\n`;
  if (taxes.dutyRate !== null) {
    response += `| DDI (Droits de douane) | ${taxes.dutyRate}% | ${taxes.dutyAmount.toLocaleString()} MAD |\n`;
  } else {
    response += `| DDI | N/A | Non calculable |\n`;
  }
  response += `| TVA | ${taxes.vatRate}% | ${taxes.vatAmount.toLocaleString()} MAD |\n`;
  if (taxes.otherTaxes > 0) {
    response += `| Autres taxes | - | ${taxes.otherTaxes.toLocaleString()} MAD |\n`;
  }
  response += `| **TOTAL DROITS** | - | **${taxes.totalTaxes.toLocaleString()} MAD** |\n`;
  
  // Contrôles requis
  if (verification.controlsRequired.length > 0) {
    response += `\n### ⚠️ Contrôles requis\n`;
    for (const ctrl of verification.controlsRequired) {
      response += `- **${ctrl.type}** par ${ctrl.authority}: ${ctrl.reason}\n`;
    }
  }
  
  // Alertes
  if (verification.errors.length > 0) {
    response += `\n### 🚨 Erreurs détectées\n`;
    for (const err of verification.errors) {
      response += `- ❌ ${err}\n`;
    }
  }
  
  if (verification.warnings.length > 0) {
    response += `\n### ⚡ Avertissements\n`;
    for (const warn of verification.warnings) {
      response += `- ⚠️ ${warn}\n`;
    }
  }
  
  // Statut de conformité
  response += `\n### ✅ Statut de conformité\n`;
  if (verification.isValid) {
    response += `La déclaration semble **conforme** aux exigences douanières.\n`;
  } else {
    response += `⚠️ La déclaration présente des **anomalies** nécessitant une attention particulière.\n`;
  }
  
  return response;
}

// ============================================================================
// PARSEUR DE RÉPONSE IA
// ============================================================================

/**
 * Parse la réponse JSON de l'IA pour extraire les données DUM
 */
export function parseDUMFromAIResponse(aiResponse: string): DUMData | null {
  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    if (!parsed.isDUM) return null;
    
    // Normaliser les données
    const dumData: DUMData = {
      isDUM: true,
      dumNumber: parsed.dumNumber || null,
      bureauCode: parsed.bureauCode || null,
      registrationDate: parsed.registrationDate || null,
      exporter: parsed.exporter || null,
      importer: parsed.importer || null,
      declarant: parsed.declarant || null,
      goods: Array.isArray(parsed.goods) ? parsed.goods.map((g: any) => ({
        description: g.description || "",
        hsCode: cleanHSCode(g.hsCode || ""),
        hsCode6: cleanHSCode(g.hsCode || "").slice(0, 6),
        quantity: Number(g.quantity) || 0,
        unit: g.unit || "KG",
        declaredValue: Number(g.declaredValue) || 0,
        currency: g.currency || "MAD",
        weight: Number(g.weight) || 0,
        countryOfOrigin: g.countryOfOrigin || "",
        countryOfOriginCode: g.countryOfOriginCode || "",
      })) : [],
      totals: {
        grossWeight: Number(parsed.totals?.grossWeight) || 0,
        netWeight: Number(parsed.totals?.netWeight) || 0,
        declaredValue: Number(parsed.totals?.declaredValue) || 0,
        currency: parsed.totals?.currency || "MAD",
        exchangeRate: Number(parsed.totals?.exchangeRate) || 1,
        freight: Number(parsed.totals?.freight) || 0,
        insurance: Number(parsed.totals?.insurance) || 0,
        totalValueMAD: Number(parsed.totals?.totalValueMAD) || 0,
      },
      transport: parsed.transport || null,
      financial: parsed.financial || null,
    };
    
    return dumData;
  } catch (e) {
    console.error("Failed to parse DUM data:", e);
    return null;
  }
}
