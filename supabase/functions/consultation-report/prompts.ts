// ============================================================================
// PROMPTS MODE RAPPORT ADMINISTRATIF
// ============================================================================

export function buildImportReportPrompt(
  productDesc: string,
  hsCode: string | null,
  countryCode: string,
  tariffContext: string,
  controlledContext: string,
  legalContext: string,
  sections: string[]
): string {
  return `## MISSION
Tu es DouaneAI, expert-conseil en douane marocaine. Tu dois générer un RAPPORT DE CONSULTATION IMPORT structuré.

## FORMAT DE SORTIE OBLIGATOIRE
Tu DOIS répondre UNIQUEMENT en JSON valide avec cette structure exacte :
\`\`\`json
{
  "classification": {
    "hs_code": "code SH 10 chiffres",
    "hs_code_6": "code SH 6 chiffres",
    "description": "description officielle du code",
    "chapter": "numéro et titre du chapitre",
    "reasoning": "justification RGI + notes de section/chapitre",
    "confidence": "high|medium|low"
  },
  "conformity": [
    {
      "authority": "nom de l'autorité (ONSSA, ANRT, CoC, DMP, ONICL, IMANOR, Licence)",
      "status": "required|not_required|recommended",
      "reason": "pourquoi c'est requis ou non",
      "legal_basis": "texte de loi si connu",
      "delay": "délai estimé",
      "cost": "coût estimé",
      "when": "avant/pendant/après dédouanement",
      "steps": ["étape 1", "étape 2"]
    }
  ],
  "documents": [
    {
      "name": "nom du document",
      "required": true,
      "note": "précision si nécessaire"
    }
  ],
  "agreements": {
    "applicable": "nom de l'accord applicable ou 'Aucun'",
    "details": "explication",
    "alternatives": [
      {
        "agreement": "nom",
        "condition": "condition d'origine",
        "potential_savings": "description de l'économie"
      }
    ]
  },
  "procedure": [
    "Étape 1: description",
    "Étape 2: description"
  ],
  "risks": [
    "risque ou point d'attention 1",
    "risque ou point d'attention 2"
  ],
  "sources": [
    "Article X du CDII",
    "Circulaire n°XXXX"
  ]
}
\`\`\`

## DONNÉES DU FORMULAIRE
- **Produit**: ${productDesc}
- **Code SH fourni**: ${hsCode || "Non fourni — à déterminer"}
- **Pays d'origine**: ${countryCode}

## CONTEXTE TARIFAIRE (de la base de données)
${tariffContext || "Aucune donnée tarifaire trouvée"}

## PRODUITS CONTRÔLÉS (de la base de données)
${controlledContext || "Aucune donnée de contrôle trouvée"}

## CONTEXTE JURIDIQUE (circulaires et textes)
${legalContext || "Aucun contexte juridique"}

## SECTIONS DEMANDÉES
${sections.join(", ")}

## RÈGLES STRICTES
1. Si le code SH est fourni, vérifie sa cohérence. Sinon, propose le plus précis possible.
2. Pour les conformités, vérifie CHAQUE autorité : ONSSA, ANRT, CoC, DMP, ONICL, IMANOR, licence.
3. Pour les documents, liste les OBLIGATOIRES et les RECOMMANDÉS.
4. Cite les articles du CDII et circulaires quand possible.
5. Réponds UNIQUEMENT en JSON valide, sans texte avant ou après.`;
}

export function buildMREReportPrompt(
  importType: string,
  vehicleInfo: string,
  mreInfo: string,
  legalContext: string
): string {
  return `## MISSION
Tu es DouaneAI, expert en douane marocaine. Génère un RAPPORT MRE (Marocain Résidant à l'Étranger).

## FORMAT JSON OBLIGATOIRE
\`\`\`json
{
  "eligibility": {
    "eligible": true,
    "conditions_met": ["condition 1 remplie", "condition 2 remplie"],
    "conditions_missing": ["condition manquante"],
    "legal_basis": "Art. 164 CDII, Circ. n°..."
  },
  "documents": [
    {"name": "document", "required": true, "note": ""}
  ],
  "procedure": [
    "Étape 1",
    "Étape 2"
  ],
  "warnings": [
    "Point d'attention 1"
  ],
  "sources": ["référence juridique"]
}
\`\`\`

## DONNÉES MRE
- **Type**: ${importType}
- **Véhicule**: ${vehicleInfo}
- **Situation MRE**: ${mreInfo}

## CONTEXTE JURIDIQUE
${legalContext || "Aucun contexte"}

## RÈGLES MRE À APPLIQUER
- Abattement 90% DI sur véhicule (retour définitif, résidence > 2 ans, possession > 6 mois)
- Franchise totale effets personnels (retour définitif, résidence > 2 ans)
- Délai 12 mois après retour pour importer
- Un seul véhicule par retour définitif
- Interdiction de revente 5 ans
- TPF exonéré pour MRE

Réponds UNIQUEMENT en JSON valide.`;
}

export function buildConformityReportPrompt(
  productDesc: string,
  hsCode: string | null,
  countryCode: string,
  controlledContext: string,
  legalContext: string
): string {
  return `## MISSION
Tu es DouaneAI. Génère un RAPPORT DE CONFORMITÉ détaillé pour l'import au Maroc.

## FORMAT JSON OBLIGATOIRE
\`\`\`json
{
  "product": {
    "description": "produit identifié",
    "hs_code": "code SH",
    "category": "catégorie"
  },
  "checks": [
    {
      "authority": "ONSSA|ANRT|CoC|DMP|ONICL|IMANOR|ONEE|BMDA|Licence",
      "status": "required|not_required|recommended",
      "reason": "explication",
      "legal_basis": "",
      "delay": "",
      "cost": "",
      "when": "avant/pendant/après dédouanement",
      "steps": [],
      "portal_url": ""
    }
  ],
  "summary": {
    "total_required": 0,
    "total_not_required": 0,
    "total_recommended": 0,
    "estimated_total_delay": "",
    "estimated_total_cost": ""
  },
  "sources": []
}
\`\`\`

## DONNÉES
- **Produit**: ${productDesc}
- **Code SH**: ${hsCode || "À déterminer"}
- **Origine**: ${countryCode}

## DONNÉES CONTROLLED_PRODUCTS (DB)
${controlledContext || "Aucune donnée"}

## CONTEXTE JURIDIQUE
${legalContext || "Aucun contexte"}

## AUTORITÉS À VÉRIFIER SYSTÉMATIQUEMENT
1. **ONSSA** : tout produit agro-alimentaire, animal, végétal, phytosanitaire
2. **ANRT** : tout équipement avec Wi-Fi, Bluetooth, radio, télécom, 4G/5G
3. **CoC** : certificat de conformité à l'origine (liste MCINET)
4. **DMP** : médicaments, produits pharmaceutiques, dispositifs médicaux
5. **ONICL** : céréales, farines, dérivés céréaliers
6. **IMANOR** : normes marocaines NM (électrique, BTP, jouets)
7. **ONEE** : équipements électriques haute tension
8. **Licence d'importation** : produits soumis à licence (MCINET)

Pour chaque autorité, indique si c'est requis, non requis ou recommandé, avec le motif.
Réponds UNIQUEMENT en JSON valide.`;
}

export function buildInvestorReportPrompt(
  sector: string,
  zone: string,
  materialDesc: string,
  materialValue: string,
  preferredRegime: string,
  legalContext: string
): string {
  return `## MISSION
Tu es DouaneAI. Génère un RAPPORT INVESTISSEUR ÉTRANGER pour l'import de matériel au Maroc.

## FORMAT JSON OBLIGATOIRE
\`\`\`json
{
  "recommended_regime": {
    "name": "nom du régime",
    "description": "description",
    "legal_basis": "base légale",
    "conditions": ["condition 1", "condition 2"]
  },
  "comparison": [
    {
      "regime": "Droit commun|Franchise|Zone franche|AT",
      "di": 0,
      "tpf": 0,
      "tva": 0,
      "total": 0
    }
  ],
  "zone_advantages": ["avantage 1", "avantage 2"],
  "documents": [{"name": "", "required": true, "note": ""}],
  "procedure": ["étape 1", "étape 2"],
  "sources": []
}
\`\`\`

## DONNÉES
- **Secteur**: ${sector}
- **Zone d'implantation**: ${zone}
- **Matériel**: ${materialDesc}
- **Valeur**: ${materialValue}
- **Régime préféré**: ${preferredRegime}

## CONTEXTE JURIDIQUE
${legalContext || "Aucun contexte"}

## RÉGIMES À COMPARER
1. **Droit commun** : taux normal
2. **Franchise bien d'investissement** : exonération DI + TVA (Code des Investissements)
3. **Zone franche** : exonération totale + avantages fiscaux (IS, TP)
4. **Admission temporaire** : si transformation + export

Réponds UNIQUEMENT en JSON valide.`;
}
