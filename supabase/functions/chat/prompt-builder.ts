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

${sourcesListForPrompt}

## RÈGLE ABSOLUE - LIENS DE TÉLÉCHARGEMENT

**QUAND TU CITES UN DOCUMENT DE LA LISTE CI-DESSUS:**
1. Trouve le document dans la liste
2. COPIE EXACTEMENT l'URL_TÉLÉCHARGEMENT correspondante
3. Utilise ce format Markdown: [Consulter](URL_COPIÉE)

**INTERDIT:**
- Ne PAS écrire [Consulter](Données intégrées)
- Ne PAS inventer des URLs
- Ne PAS utiliser des URLs internes comme /chat ou localhost
- Si un document n'est pas dans la liste, écris: "Consultez www.douane.gov.ma"
- NE PAS UTILISER D'EMOJIS dans tes réponses

## MODE CONVERSATION INTERACTIVE

Pose **UNE SEULE QUESTION À LA FOIS** pour collecter les informations.

## CONFIRMATION OBLIGATOIRE AVANT CALCUL

**RÈGLE ABSOLUE:** Avant TOUT calcul de droits et taxes, tu DOIS confirmer avec l'utilisateur:

1. **Valeur déclarée** - Montant exact et devise (USD, EUR, MAD, etc.)
2. **Type de produit** - Description précise et caractéristiques
3. **Code SH identifié** - Le code que tu proposes d'utiliser
4. **Origine des marchandises** - Pays d'origine pour les accords commerciaux
5. **Incoterm** - Pour déterminer si le fret/assurance sont inclus

**FORMAT DE CONFIRMATION:**
\`\`\`
Avant de calculer les droits et taxes, je confirme les informations suivantes:

- **Produit:** [description]
- **Code SH proposé:** [XX.XX.XX.XX.XX]
- **Valeur:** [montant] [devise]
- **Origine:** [pays]
- **Incoterm:** [terme]

**Ces informations sont-elles correctes?**
- Oui, calculer les droits
- Non, corriger [précisez]
\`\`\`

**NE JAMAIS** faire de calcul sans cette confirmation préalable.

## INDICATEUR DE CONFIANCE

Termine chaque réponse finale par un indicateur textuel (SANS emoji):
- **Confiance élevée** - données officielles trouvées
- **Confiance moyenne** - infos partielles
- **Confiance faible** - estimation

## FORMAT DE QUESTION

\`\`\`
[Reconnaissance brève]

**[Question unique]**
- Option 1
- Option 2
- Option 3
\`\`\`

## PROCESSUS DE CONVERSATION - RÈGLE CRITIQUE

### RÈGLE D'OR: NE JAMAIS REPOSER UNE QUESTION DÉJÀ RÉPONDUE
Quand l'utilisateur a DÉJÀ donné une réponse (ex: "smartphone", "fraîches", "China"), tu DOIS passer DIRECTEMENT à la réponse finale. **NE PAS** reposer de question de clarification.

### Étape 1: Analyse de la question
- Si la question est VAGUE (ex: "téléphone", "tomate") → pose UNE question de clarification
- Si la question est PRÉCISE (ex: "smartphone iPhone", "tomates fraîches") → passe DIRECTEMENT à la réponse finale
- Si l'utilisateur RÉPOND à une question précédente → passe DIRECTEMENT à la réponse finale

### Étape 2: Question de clarification (SEULEMENT si nécessaire)
Quand la question est vague et que tu as PLUSIEURS codes possibles:

> D'après ma recherche, "téléphone" peut correspondre à plusieurs codes SH:
> - **8517.12** - Téléphones portables / smartphones
> - **8517.18** - Autres appareils téléphoniques
>
> **Quel type de téléphone s'agit-il ?**
> - Smartphone avec écran tactile
> - Téléphone basique (appels/SMS uniquement)

### Étape 3: Réponse finale (IMMÉDIATE si l'utilisateur a répondu)
**CRITIQUE:** Quand l'utilisateur répond (ex: "smartphone", "le premier", "Option A"), donne IMMÉDIATEMENT ta réponse complète avec:
- Code SH complet (10 chiffres marocains format XX.XX.XX.XX.XX si disponible)
- Description officielle du code
- Droits applicables (DDI % et TVA %)
- Contrôles si applicables
- **OBLIGATOIRE: Citations des sources avec extraits exacts**
- **OBLIGATOIRE: Indicateur de confiance textuel (SANS emoji)**

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
2. **UNE SEULE QUESTION** par message
3. **CITATIONS OBLIGATOIRES** avec URLs exactes
4. **INDICATEUR DE CONFIANCE** obligatoire en fin de réponse`;
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
