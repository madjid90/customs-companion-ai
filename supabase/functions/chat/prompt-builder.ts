// ============================================================================
// PROMPT-BUILDER.TS - DOUANEAI EXPERT V2
// Version optimisée avec 10 cas de réponse, hiérarchie juridique,
// expertise DUM complète et gestion des circulaires SH
// ============================================================================

import { RAGContext, TariffWithInheritance, formatTariffForRAG, formatTariffNotesForRAG } from "./context-builder.ts";
import { ImageAnalysisResult, PdfAnalysisResult } from "./analysis.ts";
import { extractTopPassages, formatPassagesForPrompt } from "./passage-scorer.ts";

// ============================================================================
// SECTION 1 : IDENTITÉ ET EXPERTISE
// ============================================================================

const SYSTEM_IDENTITY = `
## IDENTITÉ

Tu es **DouaneAI**, expert-conseil en douane marocaine et commerce international (20 ans ADII, formateur OMD, consultant ALE).

**Approche** : Juriste fiscaliste — précis, sourcé, prudent. Tu distingues certitude juridique vs interprétation et recommandes un commissionnaire agréé pour les cas complexes.

**Langue** : Réponds dans la même langue que la question (français ou arabe).
`;

// ============================================================================
// SECTION 2 : HIÉRARCHIE DES SOURCES JURIDIQUES
// ============================================================================

const LEGAL_HIERARCHY = `
## HIÉRARCHIE JURIDIQUE

1. **Constitution** + **Conventions internationales** (OMC, OMD, accords bilatéraux)
2. **CDII** (Dahir n° 1-77-339) + **Lois de finances**
3. **Décrets** + **Arrêtés** + **Tarif officiel**
4. **Circulaires ADII** + **Notes SH** + **Avis de classement**

**Règle** : Source supérieure prévaut. Circulaire ne peut contredire le CDII. Signale toujours interprétation vs texte explicite.
`;

// ============================================================================
// SECTION 3 : DOMAINES D'EXPERTISE
// ============================================================================

const EXPERTISE_DOMAINS = `
## DOMAINES

Classification SH (RGI 1-6, codes 10 chiffres) | Valeur en douane (6 méthodes OMC) | Origine (préférentielle/non-préférentielle, EUR.1) | Régimes économiques (AT, perfectionnement, entrepôt, transit) | Droits et taxes (DI, TPF 0.25%, TVA 7-20%, TIC) | Procédures (BADR, dédouanement) | Contentieux (6 classes d'infractions CDII art.279-296) | Zones franches (ZFE, ZAI) | Incoterms 2020 | Commerce Afrique (ZLECAf)

### CIRCULAIRES SH (CRITIQUE)
Les codes SH peuvent être modifiés par circulaires ADII. **Circulaire > Tarif de base**. Toujours vérifier si une circulaire récente modifie le code concerné (création, modification de taux, suppression/fusion, exonération temporaire).
`;

// ============================================================================
// SECTION 4 : COMPORTEMENT INTERACTIF
// ============================================================================

const INTERACTIVE_BEHAVIOR = `
## COMPORTEMENT

**Pose une question** si : produit vague, fonction principale nécessaire, origine/destination floue, plusieurs codes possibles.
**Ne pose PAS** si : assez d'infos pour répondre, question juridique indépendante du produit.

Style : Naturel, conversationnel. Une seule question à la fois. Pas de listes excessives.
`;

// ============================================================================
// SECTION 5 : CAS DE RÉPONSE (10 cas)
// ============================================================================

const RESPONSE_CASES = `
## CAS DE RÉPONSE — SOIS BREF ET PRÉCIS

### CAS 1 : CLASSIFICATION SH
Donne : code 10 chiffres + DDI% (DE LA BASE) + TVA% + RGI utilisée. Vérifie circulaire. **3-5 phrases max.**

### CAS 2 : JURIDIQUE
Cite l'article exact + conséquence pratique. **1 paragraphe max.**

### CAS 3 : ACCORDS / ORIGINE
Accord applicable + taux préférentiel + certificat requis. **3-4 phrases.**

### CAS 4 : ANALYSE DUM
6 parties COURTES (2-3 lignes chacune) : Identité | Parties | Marchandise | Valeur | Fiscalité | Alertes.

### CAS 4-BIS : VÉRIFICATION CODE SH DUM
Compare code déclaré vs nomenclature. Conclure : Correct | Douteux | Incorrect. Si incorrect → code correct + impact.

### CAS 4-TER : CALCUL DROITS/TAXES
Formules :
- VD = selon incoterm (FOB: +fret+assurance | CIF: tout inclus | CFR: +assurance)
- Assurance forfaitaire si absente : 0,5% × (Valeur + Fret)
- DI = VD × taux_DI%
- TPF = VD × 0,25%
- TIC = si applicable (alcool, tabac, véhicules luxe, boissons sucrées)
- Base_TVA = VD + DI + TPF + TIC
- TVA = Base_TVA × taux_TVA%
- TOTAL = DI + TPF + TIC + TVA
→ Présenter en **tableau** + 1 phrase conclusion. Vérifier circulaire modificative.

### CAS 4-QUATER : COHÉRENCE DUM
Vérifier : code/désignation, valeur calculée vs déclarée (alerte si écart >10%), fret/incoterm cohérent, ratio valeur/poids.

### CAS 5 : CALCUL SANS DUM
Demander si manquant : code SH, valeur, origine, incoterm. Mêmes formules que CAS 4-TER.

### CAS 6 : PROCÉDURES
Étapes numérotées (max 5) + documents requis + délais. **Pas de pavé.**

### CAS 7 : CONTENTIEUX
Classe d'infraction + article CDII + sanction. Recommander avocat si pénal.
Infractions : 1ère (contrebande, Art.279) | 2ème (fausse décl. grave, 2×droits) | 3ème (fausse décl. simple, 1×droits) | 4ème (irrégularités doc) | 5ème (manquements mineurs) | 6ème (formelles)

### CAS 8 : RÉGIMES ÉCONOMIQUES
Définition 1 ligne + conditions + avantages fiscaux + base légale. **Max 1 paragraphe.**

### CAS 9 : VALEUR EN DOUANE
6 méthodes OMC par priorité. Éléments à inclure/exclure. **Répondre à la question précise, pas tout lister.**

### CAS 10 : ZONES FRANCHES
Type + avantages douaniers/fiscaux + conditions. **Max 1 paragraphe.**
`;

// ============================================================================
// SECTION 6 : RÈGLES DE FORMAT
// ============================================================================

const FORMAT_RULES = `
## RÈGLES DE FORMAT — CONCISION OBLIGATOIRE

### LONGUEUR MAXIMALE STRICTE
- Question simple (code SH, taux, oui/non) → **3-5 phrases MAX**
- Question juridique → **1 paragraphe + citation article**
- Calcul de droits → **Tableau + 1 phrase conclusion**
- Analyse DUM → **6 parties, chaque partie = 2-3 lignes MAX**
- **Ne dépasse JAMAIS 250 mots** sauf analyse DUM complète (max 400 mots)

### STYLE DIRECT — PAS DE BAVARDAGE
- Commence DIRECTEMENT par la réponse. Pas de "Bien sûr", "Excellente question", "Je vais vous expliquer"
- Pas de récapitulatif à la fin
- Pas de répétition de la question
- Une seule recommandation, pas trois
- Si tu peux répondre en 2 phrases, fais-le en 2 phrases

### INTERDIT
- Tableaux markdown SAUF pour les calculs de droits
- Liens markdown [texte](url) — JAMAIS
- URLs inventées — JAMAIS
- Listes numérotées de plus de 5 éléments
- Plus de 2 emojis par réponse
- Phrases de transition inutiles
- Balises HTML

### OBLIGATOIRE
- Code SH complet : XXXX.XX.XX.XX (10 chiffres)
- Montants en DH
- Citer sources par nom : "Article X du CDII", "Circulaire n°XXX"
- Signaler si tu n'es pas sûr
- Les sources sont affichées AUTOMATIQUEMENT — ne les inclure PAS dans le texte
`;

// ============================================================================
// SECTION 7 : EXEMPLES DE CONVERSATIONS
// ============================================================================

const CONVERSATION_EXAMPLES = `
## EXEMPLES — LONGUEUR MODÈLE (ne dépasse pas ces longueurs)

**Classification :** "Tomates fraîches → **0702.00.00.10** (Ch.07, RGI 1). DI : 40% (hors saison) / 49% (en saison, circulaire saisonnière). TVA : 0%."

**Avec circulaire :** "Panneaux solaires → **8541.40.00.10**. Circulaire n°6243/222 : DI réduit de 25% → 0%. TVA : 20%."

**Calcul :**
| Taxe | Taux | Base | Montant |
|------|------|------|---------|
| DI | 25% | 100 000 | 25 000 |
| TPF | 0,25% | 100 000 | 250 |
| TVA | 20% | 125 250 | 25 050 |
| **TOTAL** | | | **50 300 DH** |

**Juridique :** "L'article 285 du CDII qualifie la fausse déclaration de 2ème classe. Sanction : amende = 2× droits éludés (min. 6 000 DH). Transaction possible avant jugement."

**Clarification :** "Pour classifier ce produit, j'ai besoin de savoir : quel est l'usage principal ?"
`;

// ============================================================================
// SECTION 8 : GESTION DES LIMITES
// ============================================================================

const LIMITATIONS_HANDLING = `
## GESTION DES LIMITES

### Quand tu ne sais pas :
- Dis-le clairement : "Je n'ai pas trouvé d'information fiable sur ce point dans ma base"
- Ne jamais inventer de références juridiques
- Suggérer où chercher : ADII (www.douane.gov.ma), commissionnaire agréé

### Quand la question dépasse ton champ :
- Contentieux pénal avancé → "Je te recommande de consulter un avocat spécialisé"
- Optimisation fiscale agressive → Refuser poliment
- Cas très spécifique → Suggérer un RTC (renseignement tarifaire contraignant)

### Quand les sources se contredisent :
- Signaler la contradiction
- Expliquer quelle source prévaut (hiérarchie)
- Recommander de vérifier auprès de l'ADII

### Quand le texte pourrait être obsolète :
- Signaler la date du document source si connue
- Recommander de vérifier la version en vigueur
- Indiquer "sous réserve de modifications récentes"
`;

// ============================================================================
// SECTION 9 : RAPPELS CRITIQUES
// ============================================================================

const CRITICAL_REMINDERS = `
## RAPPELS CRITIQUES

### ⚠️ TAUX DE DROITS — RÈGLE ABSOLUE N°1
Les taux DDI et TVA dans le contexte ci-dessus viennent de la BASE DE DONNÉES OFFICIELLE.
- Si le contexte dit DDI: X% → tu DOIS écrire X%. JAMAIS un autre chiffre.
- Si "rate_source: direct" → le taux est CERTAIN, utilise-le tel quel.
- Si "rate_source: inherited" → le taux vient des sous-positions, fiable.
- Si "rate_source: range" → plusieurs taux possibles, indique la fourchette et demande le code complet.
- Si "rate_source: not_found" → dis clairement que le taux n'est pas en base et recommande de vérifier sur BADR.
- NE JAMAIS inventer un taux de tes connaissances. UNIQUEMENT les données du contexte.
- Si une circulaire dans le contexte modifie le taux : le taux circulaire REMPLACE le taux de base.

### ⚠️ CONCISION — RÈGLE ABSOLUE N°2
- Question simple = réponse courte (3-5 phrases)
- JAMAIS de pavé de texte
- Va droit au but, pas de préambule
- Maximum 250 mots par réponse (sauf DUM = 400 mots max)

### Avant de répondre, vérifie :
1. Tu utilises le DDI/TVA du CONTEXTE (pas de tes connaissances)
2. Tu as vérifié s'il y a une circulaire modificative
3. Tu as cité tes sources (articles, circulaires)
4. Ta réponse est COURTE et DIRECTE

### Pour les calculs :
- Base_TVA = Valeur_Douane + DI + TPF + TIC (pas juste Valeur_Douane)
- Arrondir au DH supérieur
- Vérifier si circulaire modifie le taux du code SH
- Présenter en tableau

### INTERDIT :
- Inventer des taux de droits
- Inventer des références juridiques ou URLs
- Donner des conseils de fraude
- Écrire plus de 250 mots pour une question simple
`;

// ============================================================================
// FONCTION PRINCIPALE : buildSystemPrompt
// Signature compatible avec index.ts
// ============================================================================

export function buildSystemPrompt(
  context: RAGContext,
  legalPdfTexts: Record<string, { text: string; title: string; download_url: string }>,
  imageAnalysis: ImageAnalysisResult | null,
  country: string,
  availableSources: string[],
  supabaseUrl: string,
  detectedCodes: string[] = [],
  keywords: string[] = []
): string {
  // ===== IMAGE ANALYSIS CONTEXT =====
  const imageAnalysisContext = imageAnalysis ? `
### Analyse d'image/document uploadé
**Description du produit identifié:** ${imageAnalysis.productDescription}
**Codes SH suggérés par l'analyse visuelle:** ${imageAnalysis.suggestedCodes.join(", ") || "Non déterminés"}
${imageAnalysis.questions.length > 0 ? `**Questions de clarification suggérées:** ${imageAnalysis.questions.join("; ")}` : ""}
` : "";

  // ===== TARIFFS CONTEXT =====
  let tariffsContext = "";
  if (context.tariffs_with_inheritance.length > 0) {
    tariffsContext = context.tariffs_with_inheritance.map(formatTariffForRAG).join("\n---\n");
  } else if (context.tariffs.length > 0) {
    tariffsContext = JSON.stringify(context.tariffs, null, 2);
  } else {
    tariffsContext = "Aucun tarif trouvé";
  }

  // ===== SOURCES LIST =====
  const sourcesListForPrompt = availableSources.length > 0 
    ? `
## LISTE DES DOCUMENTS DISPONIBLES

${availableSources.slice(0, 15).join('\n\n')}
`
    : '\nAucun document source - recommande www.douane.gov.ma\n';

  // ===== BUILD PROMPT =====
  const promptParts = [
    SYSTEM_IDENTITY,
    LEGAL_HIERARCHY,
    EXPERTISE_DOMAINS,
    INTERACTIVE_BEHAVIOR,
    RESPONSE_CASES,
    FORMAT_RULES,
    CONVERSATION_EXAMPLES,
    LIMITATIONS_HANDLING,
  ];

  // ===== RAG CONTEXT =====
  const ragParts: string[] = [];

  // Image analysis
  if (imageAnalysisContext) {
    ragParts.push(imageAnalysisContext);
  }

  // Tariffs
  ragParts.push(`### Tarifs avec héritage hiérarchique\n${tariffsContext}`);

  // HS Codes - Convert JSON to structured text
  if (context.hs_codes.length > 0) {
    const hsText = context.hs_codes.map((c: any) => 
      `- **${c.code || c.code_clean}** : ${c.description_fr || 'N/A'} (Ch.${c.chapter_number || '?'}, ${c.level || 'N/A'})`
    ).join('\n');
    ragParts.push(`### Codes SH additionnels\n${hsText}`);
  } else {
    ragParts.push(`### Codes SH additionnels\nAucun code SH additionnel`);
  }

  // Controlled products - Convert JSON to structured text with enriched fields
  if (context.controlled_products.length > 0) {
    const cpText = context.controlled_products.map((p: any) => {
      let text = `- **${p.hs_code}** — ${p.control_type} par ${p.control_authority || 'N/A'}`;
      if (p.notes) text += `\n  ${p.notes}`;
      if (p.legal_basis) text += `\n  Base légale: ${p.legal_basis}`;
      if (p.standard_required) text += `\n  Norme requise: ${p.standard_required}`;
      if (p.procedure_steps) {
        try {
          const steps = typeof p.procedure_steps === 'string' ? JSON.parse(p.procedure_steps) : p.procedure_steps;
          if (Array.isArray(steps) && steps.length) text += `\n  Procédure: ${steps.join(' → ')}`;
        } catch {}
      }
      if (p.estimated_delay) text += `\n  Délai estimé: ${p.estimated_delay}`;
      if (p.estimated_cost) text += `\n  Coût estimé: ${p.estimated_cost}`;
      if (p.portal_url) text += `\n  Portail: ${p.portal_url}`;
      return text;
    }).join('\n');
    ragParts.push(`### Produits contrôlés\n${cpText}`);
  } else {
    ragParts.push(`### Produits contrôlés\nVoir contrôles dans les tarifs ci-dessus`);
  }

  // Knowledge documents - circulaires and legal docs are CRITICAL sources
  if (context.knowledge_documents.length > 0) {
    const nencDocs = context.knowledge_documents.filter((d: any) => d.is_nenc === true);
    const legalDocs = context.knowledge_documents.filter((d: any) => !d.is_nenc && (d.source === 'legal_chunks' || d.source === 'legal_chunks_fallback' || d.category === 'legal'));
    const otherDocs = context.knowledge_documents.filter((d: any) => !d.is_nenc && d.source !== 'legal_chunks' && d.source !== 'legal_chunks_fallback' && d.category !== 'legal');

    // === NENC / NESH (Notes Explicatives) — TOP PRIORITY for classification ===
    if (nencDocs.length > 0) {
      console.log(`[prompt-builder] Including ${nencDocs.length} NENC/NESH chunks as TOP-PRIORITY classification source`);
      const nencText = nencDocs.map((d: any) => {
        const meta = d.metadata || {};
        const refLabel = `[LEGAL:${d.source_id}:${d.page_number || 1}]`;
        const hierBits: string[] = [];
        if (meta.chapter) hierBits.push(`Ch.${meta.chapter}`);
        if (meta.heading) hierBits.push(`Pos.${meta.heading}`);
        if (meta.subheading) hierBits.push(`SP.${meta.subheading}`);
        const hier = hierBits.length ? ` (${hierBits.join(' › ')})` : '';
        return `- **${d.title}**${hier} — p.${d.page_number || '?'} ${refLabel}\n  ${(d.content || '').substring(0, 2200)}`;
      }).join('\n\n');
      ragParts.push(`### 📘 NOTES EXPLICATIVES (NENC / NESH) — RÉFÉRENCE OFFICIELLE OMD/UE\n**INSTRUCTION OBLIGATOIRE :** Pour toute classification SH, ces notes sont la source d'interprétation autoritative. Cite chaque passage utilisé avec le marqueur \`[LEGAL:source_id:page]\` exactement comme indiqué ci-dessous (le système les transformera en liens cliquables vers la page exacte du PDF).\n${nencText}`);
    }

    if (legalDocs.length > 0) {
      console.log(`[prompt-builder] Including ${legalDocs.length} legal docs as PRIORITY source, titles: ${legalDocs.map((d: any) => d.title).join(' | ')}`);
      // Hiérarchie juridique : CDII (3000 chars) > Circulaires (2500) > Autres (1500)
      const cdiiDocs = legalDocs.filter((d: any) => d.title?.match(/CDII|Code des Douanes|article\s+\d/i));
      const circulaires = legalDocs.filter((d: any) => d.title?.match(/circulaire|circ\./i));
      const autres = legalDocs.filter((d: any) => !cdiiDocs.includes(d) && !circulaires.includes(d));
      
      let legalText = '';
      if (cdiiDocs.length) {
        legalText += '#### 📜 CDII (force de loi)\n' + cdiiDocs.map((d: any) => `- **${d.title}**: ${d.content?.substring(0, 3000)}`).join('\n');
      }
      if (circulaires.length) {
        legalText += '\n#### 📋 CIRCULAIRES ADII\n' + circulaires.map((d: any) => `- **${d.title}**: ${d.content?.substring(0, 2500)}`).join('\n');
      }
      if (autres.length) {
        legalText += '\n#### 📄 Autres\n' + autres.map((d: any) => `- **${d.title}**: ${d.content?.substring(0, 1500)}`).join('\n');
      }
      ragParts.push(`### ⚖️ CIRCULAIRES ET TEXTES JURIDIQUES (SOURCE PRIORITAIRE — UTILISE CES DONNÉES)\n**INSTRUCTION OBLIGATOIRE : Les circulaires ci-dessous contiennent la réponse. TU DOIS les citer et les utiliser. Ne demande JAMAIS de précisions si l'information est disponible ci-dessous.**\n${legalText}`);
    }
    if (otherDocs.length > 0) {
      const otherText = otherDocs.map((d: any) => `- **${d.title}**: ${d.content?.substring(0, 500)}...`).join('\n');
      ragParts.push(`### Documents de référence\n${otherText}`);
    }
    if (legalDocs.length === 0 && otherDocs.length === 0) {
      ragParts.push(`### Documents de référence\nAucun document de référence`);
    }
  } else {
    ragParts.push(`### Documents de référence\nAucun document de référence`);
  }

  // PDF extractions with passage scoring
  if (context.pdf_summaries.length > 0) {
    const pdfContext = context.pdf_summaries.map((p: any, idx: number) => {
      const chapterInfo = p.chapter_number ? ` [CHAPITRE ${p.chapter_number.toString().padStart(2, '0')}]` : '';
      let content = `---\n**Document ${idx + 1}:** ${p.title || 'Sans titre'}${chapterInfo}\n`;
      content += `**IMPORTANT:** Ce PDF contient le tarif officiel${p.chapter_number ? ` pour le chapitre ${p.chapter_number}` : ''}.\n`;
      if (p.summary) content += `**Résumé:** ${p.summary}\n`;
      if (p.key_points?.length > 0) content += `**Points clés:** ${JSON.stringify(p.key_points)}\n`;
      if (p.mentioned_codes?.length > 0) content += `**Codes SH couverts:** ${p.mentioned_codes.join(', ')}\n`;
      if (p.download_url) content += `**URL:** ${p.download_url}\n`;
      
      if (p.full_text) {
        const topPassages = extractTopPassages(p.full_text, detectedCodes, keywords, 5, 2000);
        if (topPassages.length > 0) {
          content += formatPassagesForPrompt(topPassages, p.title || 'Document');
        } else {
          content += `**Note:** Aucun extrait pertinent trouvé pour les codes demandés.\n`;
        }
      }
      return content;
    }).join('\n');
    ragParts.push(`### Extractions PDF (Source Officielle)\n${pdfContext}`);
  } else {
    ragParts.push(`### Extractions PDF\nAucune extraction PDF`);
  }

  // Legal references with passage scoring
  if (context.legal_references.length > 0) {
    const legalContext = context.legal_references.map((ref: any) => {
      let content = `---\n**${ref.reference_type}** n°${ref.reference_number}\n`;
      if (ref.title) content += `Titre: ${ref.title}\n`;
      if (ref.reference_date) content += `Date: ${ref.reference_date}\n`;
      if (ref.context) content += `Contexte: ${ref.context}\n`;
      if (ref.download_url) content += `**URL:** ${ref.download_url}\n`;
      
      const pdfText = legalPdfTexts[ref.pdf_id];
      if (pdfText && pdfText.text) {
        const topPassages = extractTopPassages(pdfText.text, detectedCodes, keywords, 5, 2500);
        if (topPassages.length > 0) {
          content += formatPassagesForPrompt(topPassages, pdfText.title || 'Document légal');
        } else {
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
    }).join('\n');
    ragParts.push(`### Références légales\n${legalContext}`);
  } else {
    ragParts.push(`### Références légales\nAucune référence légale trouvée - recommande www.douane.gov.ma`);
  }

  // Procedures
  if (context.regulatory_procedures.length > 0) {
    const procContext = context.regulatory_procedures.map((proc: any) => {
      let content = `---\n**Procédure:** ${proc.procedure_name}\n`;
      if (proc.authority) content += `**Autorité compétente:** ${proc.authority}\n`;
      if (proc.required_documents?.length > 0) {
        content += `**Documents requis:**\n${proc.required_documents.map((d: string) => `- ${d}`).join('\n')}\n`;
      }
      if (proc.deadlines) content += `**Délais:** ${proc.deadlines}\n`;
      if (proc.penalties) content += `**Sanctions:** ${proc.penalties}\n`;
      return content;
    }).join('\n');
    ragParts.push(`### Procédures réglementaires\n${procContext}`);
  } else {
    ragParts.push(`### Procédures réglementaires\nAucune procédure spécifique trouvée`);
  }

  // Tariff notes
  ragParts.push(`### Notes et Définitions Tarifaires\n${
    context.tariff_notes && context.tariff_notes.length > 0 
      ? formatTariffNotesForRAG(context.tariff_notes)
      : "Aucune note de chapitre trouvée"
  }`);

  // Trade agreements
  if (context.trade_agreements?.length > 0) {
    const agText = context.trade_agreements.map((a: any) =>
      `- **${(a.code || '').toUpperCase()}**: ${a.name_fr} | Type: ${a.agreement_type || 'N/A'} | Preuve: ${a.proof_required || 'N/A'}${a.countries_covered?.length ? ` | Pays: ${a.countries_covered.join(', ')}` : ''}`
    ).join('\n');
    ragParts.push(`### Accords commerciaux\n${agText}`);
  }

  // TIC rates
  if (context.tic_rates?.length > 0) {
    const ticText = context.tic_rates.map((t: any) => {
      const rate = t.tic_type === 'ad_valorem'
        ? `${(parseFloat(t.tic_rate) * 100).toFixed(0)}% ad valorem`
        : `${t.tic_amount} ${t.tic_unit || 'MAD'}`;
      return `- **${t.hs_code_pattern}**: ${t.description_fr || 'N/A'} → TIC: ${rate}`;
    }).join('\n');
    ragParts.push(`### TIC applicable\n**IMPORTANT:** Base_TVA = VD + DI + TPF + TIC\n${ticText}`);
  }

  // MRE rules
  if (context.mre_rules?.length > 0) {
    const grouped: Record<string, string[]> = {};
    for (const r of context.mre_rules) {
      if (!grouped[r.rule_type]) grouped[r.rule_type] = [];
      grouped[r.rule_type].push(`${r.condition_key}=${r.condition_value}: ${r.description_fr} (${r.legal_reference || 'N/A'})`);
    }
    const rulesText = Object.entries(grouped).map(([t, items]) =>
      `**${t}**:\n${items.map(i => `- ${i}`).join('\n')}`
    ).join('\n');
    ragParts.push(`### Règles MRE\n${rulesText}`);
  }

  // Import documents
  if (context.import_documents?.length > 0) {
    const docsText = context.import_documents.map((d: any) =>
      `- [${d.category}${d.applies_to ? '|' + d.applies_to : ''}] **${d.document_name_fr}**: ${d.description_fr || ''} ${d.when_required ? '(Requis: ' + d.when_required + ')' : ''}`
    ).join('\n');
    ragParts.push(`### Documents d'importation\n${docsText}`);
  }

  // ANRT approved equipment
  if (context.anrt_equipment?.length > 0) {
    if (context.anrt_equipment[0]._info) {
      ragParts.push(`### Équipements ANRT\n${context.anrt_equipment[0]._info}`);
    } else {
      const eqText = context.anrt_equipment.map((e: any) =>
        `- ✅ ${e.designation} | ${e.brand || 'N/A'} ${e.model || ''} | Agrément: ${e.approval_number || 'N/A'} | Expire: ${e.expiry_date || 'N/A'}`
      ).join('\n');
      ragParts.push(`### Équipements ANRT homologués (agréés)\n${eqText}`);
    }
  }

  // ANRT dispensed equipment
  if (context.anrt_dispensed_equipment?.length > 0) {
    const dispText = context.anrt_dispensed_equipment.map((e: any) =>
      `- 🔓 ${e.designation} | ${e.brand || 'N/A'} | Type/Modèle: ${e.type_model || 'N/A'} | Dispense: ${e.dispensation_number || 'N/A'}`
    ).join('\n');
    ragParts.push(`### Équipements ANRT dispensés d'homologation\nCes équipements sont DISPENSÉS d'homologation ANRT — pas besoin d'agrément pour les importer.\n${dispText}`);
  }


  promptParts.push(`
## CONTEXTE DISPONIBLE (Base de connaissances)

Les informations suivantes ont été récupérées de la base de données pour répondre à cette question :

${ragParts.join('\n\n')}
`);

  // Add critical reminders
  promptParts.push(CRITICAL_REMINDERS);

  // Sources list
  promptParts.push(sourcesListForPrompt);

  return promptParts.join('\n\n');
}

// ============================================================================
// FONCTION : determineConfidence (V2 - scoring à points)
// Retourne "high" | "medium" | "low" pour compatibilité avec index.ts
// ============================================================================

export function determineConfidence(
  responseText: string,
  context: RAGContext
): "high" | "medium" | "low" {
  let score = 0;

  // ===== SOURCES JURIDIQUES (40 points max) =====
  
  // Article du CDII cité explicitement
  if (/article\s+\d+\s+(du\s+)?(CDII|Code des Douanes)/i.test(responseText)) {
    score += 15;
  }
  
  // Circulaire ADII citée
  if (/circulaire\s+(n°\s*)?\d+/i.test(responseText)) {
    score += 10;
  }
  
  // Sources RAG juridiques utilisées
  if (context.legal_references?.length > 0) {
    score += Math.min(context.legal_references.length * 3, 15);
  }

  // ===== PRÉCISION DES DONNÉES (30 points max) =====
  
  // Code SH complet (10 chiffres)
  if (/\d{4}\.\d{2}\.\d{2}\.\d{2}/.test(responseText)) {
    score += 10;
  }
  
  // Taux de droit spécifié
  if (/\d+(\.\d+)?\s*%/.test(responseText)) {
    score += 8;
  }
  
  // Montant calculé en DH
  if (/\d+[\s,.]?\d*\s*(DH|MAD|dirhams)/i.test(responseText)) {
    score += 7;
  }
  
  // Tarifs DB avec source directe
  if (context.tariffs_with_inheritance?.length > 0 && 
      context.tariffs_with_inheritance.some(t => t.rate_source === 'direct')) {
    score += 5;
  }

  // ===== QUALITÉ DE LA RÉPONSE (20 points max) =====
  
  // Bonne longueur
  if (responseText.length > 300 && responseText.length < 2500) {
    score += 5;
  }
  
  // Recommandation pratique
  if (/je (te\s+)?(vous\s+)?(recommande|conseille)|tu (dois|peux)|vous (devez|pouvez)/i.test(responseText)) {
    score += 5;
  }
  
  // Nuance exprimée
  if (/toutefois|cependant|attention|à noter|important/i.test(responseText)) {
    score += 5;
  }
  
  // Ton confiant
  if (!/je ne suis pas (sûr|certain)|je pense que peut-être/i.test(responseText)) {
    score += 5;
  }

  // ===== BONUS DUM (10 points) =====
  
  // Tableau de calcul
  if (/\|\s*Taxe\s*\|/.test(responseText) || /TOTAL.*DH/i.test(responseText)) {
    score += 5;
  }
  
  // Détection d'anomalie
  if (/anomalie|écart|incohérence/i.test(responseText)) {
    score += 5;
  }

  // ===== PÉNALITÉS =====
  
  // Aucune source RAG
  if (!context.legal_references?.length && 
      !context.tariffs_with_inheritance?.length && 
      !context.knowledge_documents?.length) {
    score -= 20;
  }
  
  // Réponse trop courte
  if (responseText.length < 150) {
    score -= 10;
  }
  
  // Formulations vagues
  if (/généralement|en principe|normalement|il semble que/i.test(responseText)) {
    score -= 5;
  }
  
  // URL inventée
  if (/\[.*\]\(http/.test(responseText) || /https?:\/\/(?!www\.(douane|adii)\.gov\.ma)/.test(responseText)) {
    score -= 15;
  }

  // ===== CLASSIFICATION FINALE =====
  if (score >= 55) {
    return "high";
  } else if (score >= 30) {
    return "medium";
  } else {
    return "low";
  }
}