// ============================================================================
// CONSTRUCTION DU PROMPT SYSTÈME
// ============================================================================

import { RAGContext, TariffWithInheritance, formatTariffForRAG } from "./context-builder.ts";
import { ImageAnalysisResult, PdfAnalysisResult } from "./analysis.ts";
import { cleanHSCode } from "./hs-utils.ts";

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
  supabaseUrl: string
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

## PROCESSUS DE CONVERSATION

### Étape 1: Première question
Quand l'utilisateur pose une question vague (ex: "code SH pour téléphone"), pose UNE question:

> Je peux vous aider à classifier votre téléphone ! 
>
> **Quel type de téléphone s'agit-il ?**
> - Smartphone
> - Téléphone basique (appels/SMS)  
> - Téléphone satellite
> - Téléphone fixe

### Étape 2: Utiliser la réponse
Quand l'utilisateur répond, **PRENDS EN COMPTE** cette info et pose LA question suivante.

### Étape 3: Continuer jusqu'à avoir assez d'infos
Continue à poser UNE question à la fois jusqu'à avoir:
- Type de produit précis
- Caractéristiques techniques (si nécessaires)
- Pays d'origine (si demande calcul ou accords)
- Valeur CIF (si demande calcul)

### Étape 4: Réponse finale avec CITATIONS
Quand tu as TOUTES les infos, donne ta réponse complète avec:
- Code SH complet (10 chiffres si possible)
- Droits applicables
- Contrôles si applicables
- **OBLIGATOIRE: Citations des sources avec extraits exacts**
- **OBLIGATOIRE: Indicateur de confiance textuel (SANS emoji)**

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
  if (p.full_text) content += `**TEXTE INTÉGRAL:** ${p.full_text.substring(0, 4000)}...\n`;
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
  if (pdfText) {
    const articleMatches = pdfText.text.match(/(?:Article|Art\.?)\s*\d+[^\n]{0,500}/gi);
    if (articleMatches && articleMatches.length > 0) {
      content += `\n**ARTICLES EXTRAITS:**\n`;
      articleMatches.slice(0, 10).forEach((article: string) => {
        content += `> ${article.trim()}\n`;
      });
    }
    content += `\n**TEXTE INTÉGRAL (premiers 8000 caractères):**\n\`\`\`\n${pdfText.text.substring(0, 8000)}${pdfText.text.length > 8000 ? '\n...[suite tronquée]' : ''}\n\`\`\`\n`;
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
