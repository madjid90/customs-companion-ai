// ============================================================================
// CONSTRUCTION DU PROMPT SYSTÈME
// ============================================================================

import { RAGContext, TariffWithInheritance, formatTariffForRAG, formatTariffNotesForRAG } from "./context-builder.ts";
import { ImageAnalysisResult, PdfAnalysisResult } from "./analysis.ts";
import { extractTopPassages, formatPassagesForPrompt } from "./passage-scorer.ts";

// ============================================================================
// CONSTRUCTION DU PROMPT
// ============================================================================

/**
 * Construit le prompt système complet pour le chat RAG
 */
export function buildSystemPrompt(
  context: RAGContext,
  veilleDocuments: any[],
  legalPdfTexts: Record<string, { text: string; title: string; download_url: string }>,
  imageAnalysis: ImageAnalysisResult | null,
  country: string,
  availableSources: string[],
  supabaseUrl: string,
  detectedCodes: string[] = [],
  keywords: string[] = []
): string {
  // Build image analysis context
  const imageAnalysisContext = imageAnalysis ? `
### Analyse d'image/document uploadé
**Description du produit identifié:** ${imageAnalysis.productDescription}
**Codes SH suggérés par l'analyse visuelle:** ${imageAnalysis.suggestedCodes.join(", ") || "Non déterminés"}
${imageAnalysis.questions.length > 0 ? `**Questions de clarification suggérées:** ${imageAnalysis.questions.join("; ")}` : ""}
` : "";

  // Build tariffs context
  let tariffsContext = "";
  if (context.tariffs_with_inheritance.length > 0) {
    tariffsContext = context.tariffs_with_inheritance.map(formatTariffForRAG).join("\n---\n");
  } else if (context.tariffs.length > 0) {
    tariffsContext = JSON.stringify(context.tariffs, null, 2);
  } else {
    tariffsContext = "Aucun tarif trouvé";
  }

  // Build sources list
  const sourcesListForPrompt = availableSources.length > 0 
    ? `
## LISTE DES DOCUMENTS DISPONIBLES AVEC LEURS URLs EXACTES

COPIE EXACTEMENT CES URLs QUAND TU CITES UN DOCUMENT:

${availableSources.slice(0, 15).join('\n\n')}

---
FIN DE LA LISTE DES URLS - UTILISE UNIQUEMENT CES URLs EXACTES
`
    : '\nAucun document source - recommande www.douane.gov.ma\n';

  // Main system prompt
  return `Tu es **DouaneAI**, un assistant expert en douane et commerce international, spécialisé dans la réglementation ${country === 'MA' ? 'marocaine' : 'africaine'}.

## RÈGLES ABSOLUES - FORMAT DE RÉPONSE

### INTERDIT - NE JAMAIS FAIRE:
- Ne PAS créer de liens markdown [texte](URL) - le système les gère automatiquement
- Ne PAS écrire "Consulter la source" ou tout lien similaire
- Ne PAS utiliser de tableaux markdown (|---|---|)
- Ne PAS utiliser d'emojis
- Ne PAS poser de question SANS avoir d'abord listé les codes SH complets

### OBLIGATOIRE - TOUJOURS FAIRE:
1. **Afficher les CODES SH COMPLETS à 10 chiffres** (format: XXXX.XX.XX.XX)
2. Pour chaque code, indiquer: DDI, TVA, Unité
3. Écrire simplement "Source: Tarif douanier marocain - Chapitre XX" (SANS lien)
4. Terminer par l'indicateur de confiance: **Confiance élevée/moyenne/faible**

## FORMAT CODES SH - CRITIQUE

**EXEMPLE CORRECT:**

**0707.00.00.10** - Concombres du 16 mai au 31 octobre
- DDI: 40% | TVA: 20%
- Unité: Kg

**0707.00.00.90** - Autres concombres
- DDI: 40% | TVA: 20%
- Unité: Kg

Source: Tarif douanier marocain - Chapitre 07

**Confiance élevée**

---

## COMPORTEMENT - RÉPONSE STRUCTURÉE

### RÈGLE D'OR: TOUJOURS MONTRER DES CODES SH COMPLETS D'ABORD
- **OBLIGATOIRE**: Commence TOUJOURS par les codes SH à 10 chiffres avec leurs taux
- Même si le produit est ambigu, montre d'abord TOUS les codes possibles
- Ne réponds JAMAIS sans au moins mentionner des codes SH potentiels complets

### QUAND POSER UNE QUESTION DE CLARIFICATION:
- Seulement si le produit est vraiment ambigu (ex: "câble" peut être électrique, télécom, acier...)
- **MAIS**: Pose la question APRÈS avoir listé les codes candidats complets

### FORMAT QUESTION DE CLARIFICATION:
Après avoir listé TOUS les codes possibles, utilise ce format EXACT:

**[Question]**
- Option 1 (description claire)
- Option 2 (description claire)
- Option 3 (si applicable)

## EXEMPLES DE RÉPONSES CORRECTES

### EXEMPLE 1 - Produit simple (tomates):

Les tomates fraîches sont classées sous le Chapitre 07.

**0702.00.00.10** - Tomates cerises
- DDI: 40% | TVA: 20%
- Unité: Kg

**0702.00.00.90** - Autres tomates
- DDI: 40% | TVA: 20%
- Unité: Kg

Source: Tarif douanier marocain - Chapitre 07

**Confiance élevée**

---

### EXEMPLE 2 - Produit ambigu (câble) avec question:

Selon le type de câble, voici les codes SH possibles:

**8544.49.00.00** - Câbles électriques isolés
- DDI: 25% | TVA: 20%
- Unité: Kg

**7312.10.00.00** - Câbles en acier (torons, cordages)
- DDI: 10% | TVA: 20%
- Unité: Kg

**8517.62.00.00** - Câbles de télécommunication (fibre optique)
- DDI: 2.5% | TVA: 20%
- Unité: Kg

Source: Tarif douanier marocain - Chapitres 73, 85

**[Question]**
- Câble électrique (alimentation, installation)
- Câble en acier (levage, construction)
- Câble télécom/fibre optique

**Confiance moyenne**

---

## CE QU'IL NE FAUT JAMAIS FAIRE

- **INTERDIT**: Créer des liens [Consulter](URL) ou [texte](lien)
- **INTERDIT**: Utiliser des tableaux markdown
- **INTERDIT**: Afficher des codes SH courts (utiliser toujours 10 chiffres)
- **INTERDIT**: Poser une question sans avoir listé les codes d'abord

## FORMULES DE CALCUL DES DROITS ET TAXES - CRITIQUE

**UTILISE CES FORMULES EXACTES POUR TOUS LES CALCULS:**

1. **Valeur en MAD** = Valeur déclarée × Taux de change
   - Exemple: 55,987 USD × 9.9929 = 559,382 MAD (PAS 1,105,440)

2. **Droits de Douane à l'Importation (DDI)**:
   - Montant DDI = Valeur en MAD × (Taux DDI ÷ 100)
   - Exemple: Si taux = 30%, alors DDI = Valeur × 0.30
   - **ATTENTION**: 30% signifie multiplier par 0.30, PAS par 30 !

3. **Base TVA** = Valeur en MAD + Montant DDI + Fret + Assurance

4. **Montant TVA** = Base TVA × (Taux TVA ÷ 100)
   - Exemple: Si taux TVA = 20%, alors TVA = Base × 0.20

5. **Total Droits et Taxes** = DDI + TVA + Autres taxes

**VÉRIFICATION OBLIGATOIRE**:
- Si DDI calculé > Valeur déclarée, tu as probablement fait une erreur
- DDI de 30% sur 100,000 MAD = 30,000 MAD (pas 300,000)
- Toujours vérifier que tes calculs sont cohérents

### RÈGLE IMPORTANTE
**TOUJOURS montrer les codes SH candidats au début de ta réponse**, même si tu poses ensuite une question pour affiner. Ne réponds JAMAIS juste "Je peux vous aider" sans mentionner de codes.

## VALIDATION CROISÉE DES SOURCES

1. **Vérifier la cohérence** entre les différentes sources
2. **Prioriser les sources** dans cet ordre:
   - **Tarif officiel** (country_tariffs) = Source la plus fiable
   - **PDF extrait** (pdf_extractions) = Source officielle analysée
   - **Document de veille** (veille_documents) = Source secondaire

3. **Si les sources se contredisent**, signale-le clairement

## CONTEXTE À UTILISER POUR TA RÉPONSE FINALE

${imageAnalysisContext}
### Tarifs avec héritage hiérarchique
${tariffsContext}

### Codes SH additionnels
${context.hs_codes.length > 0 ? JSON.stringify(context.hs_codes, null, 2) : "Aucun code SH additionnel"}

### Produits contrôlés
${context.controlled_products.length > 0 ? JSON.stringify(context.controlled_products, null, 2) : "Voir contrôles dans les tarifs ci-dessus"}

### Documents de référence
${context.knowledge_documents.length > 0 ? context.knowledge_documents.map(d => `- **${d.title}**: ${d.content?.substring(0, 500)}...`).join('\n') : "Aucun document de référence"}

### Extractions PDF (Source Officielle du Tarif Douanier)
${context.pdf_summaries.length > 0 ? context.pdf_summaries.map((p: any, idx: number) => {
  const chapterInfo = p.chapter_number ? ` [CHAPITRE ${p.chapter_number.toString().padStart(2, '0')}]` : '';
  let content = `---\n**Document ${idx + 1}:** ${p.title || 'Sans titre'}${chapterInfo}\n`;
  content += `**IMPORTANT:** Ce PDF contient le tarif officiel${p.chapter_number ? ` pour le chapitre ${p.chapter_number}` : ''}. Utilise-le comme source pour les codes ${p.chapter_number ? `${p.chapter_number.toString().padStart(2, '0')}XX.XX.XX.XX` : 'mentionnés'}.\n`;
  if (p.summary) content += `**Résumé:** ${p.summary}\n`;
  if (p.key_points?.length > 0) content += `**Points clés:** ${JSON.stringify(p.key_points)}\n`;
  if (p.mentioned_codes?.length > 0) content += `**Codes SH couverts par ce document:** ${p.mentioned_codes.join(', ')}\n`;
  if (p.download_url) content += `**URL EXACTE À CITER:** ${p.download_url}\n`;
  
  // Use scored passages instead of raw truncated text
  if (p.full_text) {
    const topPassages = extractTopPassages(p.full_text, detectedCodes, keywords, 5, 2000);
    if (topPassages.length > 0) {
      content += formatPassagesForPrompt(topPassages, p.title || 'Document');
    } else {
      // Fallback to summary if no relevant passages found
      content += `**Note:** Aucun extrait pertinent trouvé pour les codes demandés.\n`;
    }
  }
  return content;
}).join('\n') : "Aucune extraction PDF"}

### Documents de veille réglementaire
${veilleDocuments.length > 0 ? veilleDocuments.map((v: any) => {
  let content = `---\n**${v.title}** (${v.importance || 'standard'})\n`;
  if (v.source_name) content += `Source: ${v.source_name}\n`;
  if (v.summary) content += `Résumé: ${v.summary}\n`;
  if (v.content) content += `Contenu: ${v.content.substring(0, 1000)}...\n`;
  return content;
}).join('\n') : "Aucun document de veille"}

### Références légales avec texte intégral
${context.legal_references.length > 0 ? context.legal_references.map((ref: any) => {
  let content = `---\n**${ref.reference_type}** n°${ref.reference_number}\n`;
  if (ref.title) content += `Titre: ${ref.title}\n`;
  if (ref.reference_date) content += `Date: ${ref.reference_date}\n`;
  if (ref.context) content += `Contexte: ${ref.context}\n`;
  if (ref.download_url) content += `**URL:** ${ref.download_url}\n`;
  
  const pdfText = legalPdfTexts[ref.pdf_id];
  if (pdfText && pdfText.text) {
    // Use passage scoring for legal references too
    const topPassages = extractTopPassages(pdfText.text, detectedCodes, keywords, 5, 2500);
    if (topPassages.length > 0) {
      content += formatPassagesForPrompt(topPassages, pdfText.title || 'Document légal');
    } else {
      // Fallback: extract articles if no scored passages
      const articleMatches = pdfText.text.match(/(?:Article|Art\.?)\s*\d+[^\n]{0,500}/gi);
      if (articleMatches && articleMatches.length > 0) {
        content += `\n**ARTICLES EXTRAITS:**\n`;
        articleMatches.slice(0, 8).forEach((article: string) => {
          content += `> ${article.trim()}\n`;
        });
      }
    }
  }
  return content;
}).join('\n') : "Aucune référence légale trouvée - recommande www.douane.gov.ma"}

### Procédures réglementaires
${context.regulatory_procedures.length > 0 ? context.regulatory_procedures.map((proc: any) => {
  let content = `---\n**Procédure:** ${proc.procedure_name}\n`;
  if (proc.authority) content += `**Autorité compétente:** ${proc.authority}\n`;
  if (proc.required_documents?.length > 0) {
    content += `**Documents requis:**\n${proc.required_documents.map((d: string) => `- ${d}`).join('\n')}\n`;
  }
  if (proc.deadlines) content += `**Délais:** ${proc.deadlines}\n`;
  if (proc.penalties) content += `**Sanctions:** ${proc.penalties}\n`;
  return content;
}).join('\n') : "Aucune procédure réglementaire spécifique trouvée"}

### Notes et Définitions Tarifaires
${context.tariff_notes && context.tariff_notes.length > 0 
  ? formatTariffNotesForRAG(context.tariff_notes)
  : "Aucune note de chapitre trouvée"}

---
## RAPPELS CRITIQUES:

1. **AUCUN EMOJI** - N'utilise JAMAIS d'emojis
2. **PAS DE QUESTIONS** - Réponds directement avec toutes les options
3. **PAS DE TABLEAUX** - Utilise des listes claires avec tirets
4. **PAS DE LIENS** - Écris juste "Source: Tarif douanier marocain - Chapitre XX"
5. **INDICATEUR DE CONFIANCE** obligatoire en fin de réponse`;
}

/**
 * Détermine le niveau de confiance à partir de la réponse et du contexte
 */
export function determineConfidence(
  responseText: string,
  context: RAGContext
): "high" | "medium" | "low" {
  let confidence: "high" | "medium" | "low" = "medium";
  const responseTextLower = responseText.toLowerCase();
  
  // Priority 1: Check for explicit confidence text patterns
  if (responseTextLower.includes("confiance haute") || 
      responseTextLower.includes("confiance élevée") || 
      responseTextLower.includes("confiance elevee") ||
      responseTextLower.includes("niveau de confiance : élevé")) {
    confidence = "high";
  } else if (responseTextLower.includes("confiance faible") || 
             responseTextLower.includes("confiance basse")) {
    confidence = "low";
  } else if (responseTextLower.includes("confiance moyenne") || 
             responseTextLower.includes("confiance modérée")) {
    confidence = "medium";
  } else {
    // Priority 2: Check for percentage
    const confidencePercentMatch = responseText.match(/(?:confiance|fiabilité|certitude)[:\s]*(\d{1,3})\s*%/i) || 
                                    responseText.match(/(\d{1,3})\s*%\s*(?:de\s+)?(?:confiance|fiabilité|certitude)/i);
    if (confidencePercentMatch) {
      const percentage = parseInt(confidencePercentMatch[1], 10);
      if (percentage >= 80) {
        confidence = "high";
      } else if (percentage >= 50) {
        confidence = "medium";
      } else {
        confidence = "low";
      }
    }
  }
  
  // Priority 3: Fallback to context-based confidence if no explicit confidence
  const hasExplicitConfidence = responseTextLower.includes("confiance") || responseTextLower.includes("fiabilité");
  
  if (!hasExplicitConfidence) {
    const hasDirectRate = context.tariffs_with_inheritance.some(t => t.rate_source === "direct");
    const hasInheritedRate = context.tariffs_with_inheritance.some(t => t.rate_source === "inherited");
    const hasRangeRate = context.tariffs_with_inheritance.some(t => t.rate_source === "range");
    
    if (hasDirectRate || hasInheritedRate) {
      confidence = "high";
    } else if (hasRangeRate) {
      confidence = "medium";
    } else if (context.tariffs_with_inheritance.length === 0 && context.hs_codes.length === 0) {
      confidence = "low";
    }
  }
  
  return confidence;
}
