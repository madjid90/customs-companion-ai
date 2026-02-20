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

## FORMAT JSON OBLIGATOIRE
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
      "authority": "nom de l'autorité",
      "status": "required|not_required|recommended",
      "reason": "pourquoi",
      "legal_basis": "texte de loi",
      "delay": "délai estimé",
      "cost": "coût estimé",
      "when": "avant/pendant/après dédouanement",
      "steps": ["étape 1", "étape 2"]
    }
  ],
  "documents": [{"name": "nom", "required": true, "note": ""}],
  "agreements": {
    "applicable": "nom ou 'Aucun'",
    "details": "explication",
    "alternatives": [{"agreement": "nom", "condition": "condition", "potential_savings": ""}]
  },
  "procedure": ["Étape 1", "Étape 2"],
  "risks": ["risque 1"],
  "sources": ["Article X du CDII"]
}

## Données du formulaire
- Produit: ${productDesc}
- Code SH fourni: ${hsCode || "Non fourni — à déterminer"}
- Pays d'origine: ${countryCode}

## CONTEXTE TARIFAIRE (DB)
${tariffContext || "Aucune donnée tarifaire trouvée"}

## PRODUITS CONTRÔLÉS (DB)
${controlledContext || "Aucune donnée de contrôle trouvée"}

## CONTEXTE JURIDIQUE
${legalContext || "Aucun contexte juridique"}

## SECTIONS DEMANDÉES
${sections.length > 0 ? sections.join(", ") : "Toutes"}

## RÈGLES
1. Si le code SH est fourni, vérifie sa cohérence. Sinon, propose le plus précis possible.
2. Pour les conformités, vérifie CHAQUE autorité : ONSSA, ANRT, CoC, DMP, ONICL, IMANOR, licence.
3. Cite les articles du CDII et circulaires quand possible.
4. Réponds UNIQUEMENT en JSON valide, sans texte avant ou après.`;
}

export function buildMREReportPrompt(
  importType: string,
  vehicleInfo: string,
  mreInfo: string,
  legalContext: string
): string {
  return `## MISSION
Tu es DouaneAI, expert en procédures MRE (Marocains Résidant à l'Étranger). Génère un rapport d'éligibilité structuré.

## FORMAT JSON OBLIGATOIRE
{
  "eligibility": {
    "eligible": true,
    "conditions_met": ["condition remplie"],
    "conditions_missing": ["condition manquante"],
    "legal_basis": "Art. 164 CDII, Circ. n°..."
  },
  "documents": [{"name": "document", "required": true, "note": ""}],
  "procedure": ["Étape 1", "Étape 2"],
  "warnings": ["Point d'attention"],
  "sources": ["référence juridique"]
}

## Données MRE
- Type: ${importType}
- Véhicule: ${vehicleInfo}
- Situation MRE: ${mreInfo}

## CONTEXTE JURIDIQUE
${legalContext || "Aucun contexte"}

## RÈGLES MRE
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
Tu es DouaneAI, expert en conformités réglementaires à l'importation au Maroc.

## FORMAT JSON OBLIGATOIRE
{
  "product": {"description": "produit", "hs_code": "code SH", "category": "catégorie"},
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
  "summary": {"total_required": 0, "total_not_required": 0, "total_recommended": 0, "estimated_total_delay": "", "estimated_total_cost": ""},
  "sources": []
}

## Données
- Produit: ${productDesc}
- Code SH: ${hsCode || "À déterminer"}
- Origine: ${countryCode}

## Données Controlled Products (DB)
${controlledContext || "Aucune donnée"}

## CONTEXTE JURIDIQUE
${legalContext || "Aucun contexte"}

## AUTORITÉS À VÉRIFIER
1. ONSSA : agro-alimentaire, animal, végétal
2. ANRT : Wi-Fi, Bluetooth, radio, télécom
3. CoC : certificat de conformité
4. DMP : médicaments, pharmaceutiques
5. ONICL : céréales, farines
6. IMANOR : normes marocaines NM
7. ONEE : équipements électriques haute tension
8. Licence d'importation : produits soumis à licence

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
Tu es DouaneAI, expert en régimes économiques en douane pour investisseurs au Maroc.

## FORMAT JSON OBLIGATOIRE
{
  "recommended_regime": {
    "name": "nom du régime",
    "description": "description",
    "legal_basis": "base légale",
    "conditions": ["condition 1"]
  },
  "comparison": [
    {"regime": "Droit commun|Franchise|Zone franche|AT", "di": 0, "tpf": 0, "tva": 0, "total": 0}
  ],
  "zone_advantages": ["avantage 1"],
  "documents": [{"name": "", "required": true, "note": ""}],
  "procedure": ["étape 1"],
  "sources": []
}

## Données
- Secteur: ${sector}
- Zone d'implantation: ${zone}
- Matériel: ${materialDesc}
- Valeur: ${materialValue}
- Régime préféré: ${preferredRegime}

## CONTEXTE JURIDIQUE
${legalContext || "Aucun contexte"}

## RÉGIMES À COMPARER
1. Droit commun : taux normal
2. Franchise bien d'investissement : exonération DI + TVA (Code des Investissements)
3. Zone franche : exonération totale + avantages fiscaux
4. Admission temporaire : si transformation + export

Réponds UNIQUEMENT en JSON valide.`;
}
