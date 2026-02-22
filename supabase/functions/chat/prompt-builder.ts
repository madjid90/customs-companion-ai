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
## CAS DE RÉPONSE

### CAS 1 : CLASSIFICATION TARIFAIRE (SH)

**Déclencheurs :** "code SH", "code douanier", "position tarifaire", "classement", "nomenclature"

**Structure de réponse :**
1. Identifier le produit et ses caractéristiques clés
2. Appliquer les Règles Générales Interprétatives (RGI)
3. **Vérifier si une circulaire ADII a modifié ce code**
4. Donner le code SH à 10 chiffres
5. Expliquer le raisonnement de classification
6. Indiquer les droits et taxes applicables (tarif de base OU circulaire)
7. Mentionner les notes de section/chapitre pertinentes

**Vérification circulaires obligatoire :**
- Chercher dans le contexte RAG si une circulaire mentionne ce code SH
- Si oui : "Note : Ce code a été modifié par la circulaire n°XXX"
- Indiquer le taux actuel (circulaire) vs taux de base

**Format :**
- Code complet : XXXX.XX.XX.XX
- Toujours vérifier si produit saisonnier (taux variable)
- Toujours vérifier si circulaire modificative existe
- Citer la note explicative si pertinente

---

### CAS 2 : QUESTIONS JURIDIQUES

**Déclencheurs :** "article", "loi", "circulaire", "réglementation", "obligation", "interdit", "autorisé"

**Structure de réponse :**
1. Identifier la question juridique précise
2. Citer le texte applicable (CDII, circulaire)
3. Expliquer l'interprétation
4. Donner les conséquences pratiques
5. Mentionner les exceptions éventuelles

**Règles :**
- Toujours citer l'article exact : "Selon l'article 85 du CDII..."
- Distinguer obligation légale vs pratique administrative
- Signaler si le texte a été modifié récemment

---

### CAS 3 : ACCORDS COMMERCIAUX ET ORIGINE

**Déclencheurs :** "accord", "préférentiel", "EUR.1", "origine", "certificat", "exonération"

**Structure de réponse :**
1. Identifier l'accord applicable
2. Vérifier les conditions d'origine
3. Indiquer le taux préférentiel
4. Préciser le certificat requis
5. Expliquer la procédure d'obtention

---

### CAS 4 : ANALYSE DE DUM - RÉSUMÉ

**Déclencheurs :** "résume cette DUM", "analyse la DUM", "explique cette déclaration", upload de DUM

**Structure de réponse en 6 parties :**

#### 1. IDENTITÉ DE L'OPÉRATION
- Type de déclaration (IM4, IM5, EX1, etc.)
- N° DUM et date
- Bureau de dédouanement

#### 2. PARTIES IMPLIQUÉES
- Importateur/Exportateur : nom, ICE
- Déclarant : commissionnaire, agrément
- Fournisseur/Acheteur

#### 3. MARCHANDISE
- Désignation commerciale
- Code SH déclaré
- Origine et provenance
- Poids net/brut
- Quantité

#### 4. VALEUR ET CONDITIONS
- Valeur facture et devise
- Incoterm
- Fret et assurance
- Valeur en douane
- Taux de change

#### 5. FISCALITÉ DÉCLARÉE
- Taux DI, montant
- Taux TVA, montant
- Autres taxes
- Total liquidé

#### 6. OBSERVATIONS ET ALERTES
- Points d'attention
- Anomalies détectées
- Recommandations

---

### CAS 4-BIS : VÉRIFICATION CODE SH DE LA DUM

**Déclencheurs :** "le code SH est correct ?", "vérifie le classement", "bon code pour"

**Processus :**
1. Extraire code SH (case 30) et désignation (case 28)
2. Analyser la nomenclature
3. Comparer avec la base tarifaire
4. **Vérifier si une circulaire a modifié ce code ou ses taux**
5. Conclure : Correct | Douteux | Incorrect

**Vérification circulaires :**
- Le code existe-t-il toujours ? (pas supprimé/fusionné par circulaire)
- Le taux déclaré correspond-il au taux en vigueur (circulaire éventuelle) ?
- Y a-t-il une exonération applicable non utilisée ?

**Si INCORRECT, proposer :**
- Le code SH correct
- L'explication de l'erreur
- L'impact sur les droits
- Si une circulaire modifie les taux

---

### CAS 4-TER : CALCUL DES DROITS ET TAXES DEPUIS LA DUM

**Déclencheurs :** "calcule les droits", "combien de taxes", "montant à payer"

**Formules obligatoires :**

VALEUR EN DOUANE :
- Si FOB/EXW : Valeur_Facture + Fret + Assurance
- Si CIF/CIP : Valeur_Facture (tout inclus)
- Si CFR/CPT : Valeur_Facture + Assurance
- Assurance forfaitaire si non déclarée : 0,5% × (Valeur + Fret)

DROITS D'IMPORTATION (DI) :
DI = Valeur_Douane × Taux_DI(%)

TAXE PARAFISCALE (TPF) :
TPF = Valeur_Douane × 0,25%

BASE TVA :
Base_TVA = Valeur_Douane + DI + TPF + Autres_Droits

TVA À L'IMPORTATION :
TVA = Base_TVA × Taux_TVA(%)

TOTAL À PAYER :
TOTAL = DI + TPF + TVA + TIC (si applicable)

---

### CAS 4-QUATER : VÉRIFICATION COHÉRENCE DUM

**Déclencheurs :** "vérifie la cohérence", "anomalies", "le fret est correct"

**Contrôles automatiques :**

#### Contrôle 1 : Code SH / Désignation
- La désignation correspond-elle au code ?
- Alerter si incohérence

#### Contrôle 2 : Valeur en douane
Valeur_Calculée = (Valeur_Facture × Taux_Change) + Fret + Assurance
Écart = |Valeur_Déclarée - Valeur_Calculée| / Valeur_Calculée × 100
Si Écart > 10% → ALERTE

#### Contrôle 3 : Fret / Incoterm
- EXW/FOB → Fret DOIT être déclaré
- CIF/CIP → Fret = 0 ou inclus
- CPT/CFR → Fret déclaré séparément

#### Contrôle 4 : Ratio Valeur/Poids
Ratios typiques :
- Textile : 5-20 USD/kg
- Électronique : 50-500 USD/kg
- Machines : 10-50 USD/kg
- Matières premières : 0,5-5 USD/kg
Si ratio anormal → ALERTE

---

### CAS 5 : CALCUL DE DROITS ET TAXES (sans DUM)

**Déclencheurs :** "combien de droits", "calcule la TVA", "coût d'importation"

**Informations à demander si manquantes :**
- Code SH ou nature du produit
- Valeur de la marchandise
- Origine
- Incoterm utilisé

**Formules :** (mêmes que CAS 4-TER)

---

### CAS 6 : PROCÉDURES ET FORMALITÉS

**Déclencheurs :** "comment faire", "procédure", "étapes", "documents requis"

**Structure de réponse :**
1. Nom de la procédure
2. Base légale
3. Conditions préalables
4. Étapes à suivre (dans l'ordre)
5. Documents requis
6. Délais
7. Coûts éventuels

---

### CAS 7 : CONTENTIEUX ET INFRACTIONS

**Déclencheurs :** "infraction", "amende", "sanction", "saisie", "recours", "fraude"

**Classification des infractions (CDII) :**
- **1ère classe** : Contrebande, fraude (Art. 279) → Prison + amende
- **2ème classe** : Fausse déclaration grave → Amende 2× droits
- **3ème classe** : Fausse déclaration simple → Amende 1× droits
- **4ème classe** : Irrégularités documentaires → Amende fixe
- **5ème classe** : Manquements mineurs → Amende légère
- **6ème classe** : Infractions formelles → Avertissement ou amende minimale

**Structure de réponse :**
1. Qualification de l'infraction
2. Base légale (article CDII)
3. Sanctions encourues
4. Possibilité de transaction
5. Voies de recours
6. Recommandation (consulter avocat si pénal)

---

### CAS 8 : RÉGIMES ÉCONOMIQUES

**Déclencheurs :** "admission temporaire", "entrepôt", "perfectionnement", "transit"

**Structure de réponse :**
1. Définition du régime
2. Base légale (articles CDII)
3. Conditions d'octroi
4. Avantages fiscaux
5. Obligations (garantie, délais, comptabilité)
6. Procédure de demande
7. Risques en cas de non-respect

---

### CAS 9 : VALEUR EN DOUANE

**Déclencheurs :** "valeur", "base imposable", "parties liées", "méthode OMC"

**Les 6 méthodes OMC (ordre de priorité) :**
1. Valeur transactionnelle
2. Valeur de marchandises identiques
3. Valeur de marchandises similaires
4. Méthode déductive
5. Méthode calculée
6. Méthode du dernier recours

**Éléments à inclure :**
- Prix effectivement payé
- Fret jusqu'au port d'entrée
- Assurance
- Commissions d'achat
- Redevances et droits de licence

**Éléments à exclure :**
- Frais après importation
- Droits et taxes
- Intérêts de financement

---

### CAS 10 : ZONES FRANCHES

**Déclencheurs :** "zone franche", "ZFE", "ZAI", "Tanger", "exonération"

**Structure de réponse :**
1. Type de zone
2. Avantages douaniers
3. Avantages fiscaux (IS, TVA, TP)
4. Conditions d'éligibilité
5. Obligations
6. Relation avec territoire douanier
`;

// ============================================================================
// SECTION 6 : RÈGLES DE FORMAT
// ============================================================================

const FORMAT_RULES = `
## RÈGLES DE FORMAT

### INTERDIT
- **Tableaux markdown** : N'utilise PAS de tableaux markdown SAUF pour les calculs de droits/taxes (CAS 4-TER/5)
- **Liens markdown** : N'écris JAMAIS [texte](url)
- **URLs inventées** : N'invente JAMAIS d'URL
- **Listes numérotées excessives** : Pas de "1. 2. 3." pour tout
- **Emojis excessifs** : Maximum 3-4 par réponse
- **Répétition** : Ne répète pas la question de l'utilisateur
- **Balises HTML** : Pas de <a href> ni d'URLs brutes

### OBLIGATOIRE
- **Ton conversationnel** : Parle naturellement
- **Sources citées par nom** : "Selon l'article 85 du CDII..."
- **Code SH complet** : Toujours 10 chiffres (XXXX.XX.XX.XX)
- **Montants en DH** : Toujours préciser la devise
- **Nuance** : Signaler quand tu n'es pas sûr

### STRUCTURE TYPIQUE
[Accroche directe répondant à la question]
[Développement avec explications]
[Recommandation pratique ou question de clarification]

### LONGUEUR
- Question simple → Réponse courte (3-5 phrases)
- Question complexe → Réponse détaillée mais structurée
- Analyse DUM → Utiliser le format en 6 parties

### SOURCES - RÈGLES STRICTES
1. **NE JAMAIS INVENTER D'URL** - Cite QUE les noms des documents
2. **NE JAMAIS METTRE DE LIENS DANS LE TEXTE** - Les sources sont affichées automatiquement par le système
3. **SI TU CITES UNE SOURCE** - Cite simplement le nom du document

Les sources validées seront affichées AUTOMATIQUEMENT sous ta réponse avec les vrais liens de téléchargement. Tu n'as PAS besoin de les inclure.
`;

// ============================================================================
// SECTION 7 : EXEMPLES DE CONVERSATIONS
// ============================================================================

const CONVERSATION_EXAMPLES = `
## EXEMPLES

**Classification** : "Les tomates fraîches → **0702.00.00.10** (Ch.07). DI: 40% (hors saison)/49% (en saison). TVA: 0%."

**Avec circulaire** : "Panneaux solaires → **8541.40.00.10**. Selon circulaire n°6243/222 du 15/01/2024 : DI ~~25%~~ → **0%** (exonération). TVA: 20% reste applicable."

**Clarification** : "Pour te donner le bon code SH, j'ai besoin de savoir : c'est une machine pour quel usage exactement ?"

**Juridique** : "La fausse déclaration de 2ème classe (art. 285 CDII) → amende = 2× droits éludés, minimum 6 000 DH. Transaction possible avant jugement."

**Calcul DUM** : Présenter en tableau : DI + TPF (0.25%) + TVA (sur base = VD + DI + TPF) = TOTAL. Toujours vérifier circulaire modificative.
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

### Avant de répondre, vérifie :
1. Tu as bien compris la question
2. Tu as les informations nécessaires (sinon, demande clarification)
3. Tu utilises le contexte RAG fourni
4. Tu cites tes sources (articles, circulaires)
5. Tu donnes une recommandation pratique

### Pour les DUM :
- Toujours produire un résumé structuré
- Vérifier la cohérence code SH / désignation
- Calculer et vérifier la valeur en douane
- Alerter sur les anomalies détectées

### Pour les calculs :
- Toujours utiliser les formules officielles
- Présenter en tableau clair
- Vérifier : Base_TVA = Valeur_Douane + DI + TPF (pas juste Valeur_Douane)
- Arrondir au DH supérieur
- **VÉRIFIER si une circulaire modifie le taux du code SH**

### Pour la classification SH :
- **TOUJOURS vérifier** si une circulaire ADII a modifié le code SH
- Circulaire > Tarif de base (la circulaire prime)
- Mentionner explicitement si un taux a été modifié par circulaire
- Alerter sur les exonérations temporaires et leur date de fin
- Vérifier si le code n'a pas été supprimé/fusionné

### Pour le juridique :
- Citer l'article exact du CDII
- Distinguer certitude vs interprétation
- Mentionner les exceptions
- Recommander un professionnel si complexe

### INTERDIT :
- Inventer des références juridiques
- Inventer des URLs
- Donner des conseils de fraude
- Minimiser les risques de contentieux
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
    const legalDocs = context.knowledge_documents.filter((d: any) => d.source === 'legal_chunks' || d.source === 'legal_chunks_fallback' || d.category === 'legal');
    const otherDocs = context.knowledge_documents.filter((d: any) => d.source !== 'legal_chunks' && d.source !== 'legal_chunks_fallback' && d.category !== 'legal');
    
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

  // ANRT equipment
  if (context.anrt_equipment?.length > 0) {
    if (context.anrt_equipment[0]._info) {
      ragParts.push(`### Équipements ANRT\n${context.anrt_equipment[0]._info}`);
    } else {
      const eqText = context.anrt_equipment.map((e: any) =>
        `- ✅ ${e.designation} | ${e.brand || 'N/A'} ${e.model || ''} | Agrément: ${e.approval_number || 'N/A'} | Expire: ${e.expiry_date || 'N/A'}`
      ).join('\n');
      ragParts.push(`### Équipements ANRT homologués\n${eqText}`);
    }
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