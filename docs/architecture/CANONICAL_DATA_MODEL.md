# Modèle canonique

## Trois niveaux de donnée

1. **Preuve brute** : fichier, page, bloc, tableau et coordonnées.
2. **Candidat extrait** : entité ou relation proposée avec confiance et méthode.
3. **Fait canonique** : donnée publiée, datée, sourcée et versionnée.

Un candidat ne devient jamais canonique uniquement parce qu'un LLM l'a produit.

## Portée juridictionnelle obligatoire

Chaque fait et règle porte `jurisdiction_code`, `territory_scope`, `authority_id`,
`valid_from`, `valid_to`, `recorded_at`, `source_document_id`, `evidence_id` et
`publication_status`. Les règles héritées portent aussi `inherits_from_rule_id`,
`overrides_rule_id` et `priority`.

## Nomenclature et tarifs

```text
NomenclatureEdition
└── HSNode(section|chapter|heading|subheading|national_line)
    ├── localized descriptions
    ├── parent and children
    ├── unit
    ├── TariffMeasure
    ├── RegulatoryMeasure
    └── EvidenceLink
```

`TariffMeasure` contient type de droit ou taxe, valeur, formule, unité, origine,
accord, quota éventuel et intervalle de validité. Un taux sans preuve et sans date
ne peut pas être publié.

## Droit

```text
LegalInstrument
└── LegalVersion
    └── LegalProvision
        ├── book
        ├── title
        ├── chapter
        ├── section
        ├── article
        ├── paragraph
        └── annex
```

Une disposition conserve texte original, texte normalisé, langue, chemin
hiérarchique, dates de validité et pages sources.

## Relations juridiques

Relations minimales : `mentions`, `implements`, `applies`, `modifies`, `repeals`,
`replaces`, `derogates`, `extends`, `interprets` et `corrects`.

Chaque relation contient source, cible, portée exacte, date d'effet, confiance,
statut et preuve. Une relation peut viser une disposition précise, pas seulement
un document complet.

## Contexte réglementaire

`RegulatoryMeasure` relie une disposition à un code ou préfixe SH, une opération,
un régime, un pays, une organisation compétente et une période. Ses types incluent
droit, taxe, autorisation, contrôle, prohibition, document, origine, procédure,
délai, exception et sanction.

## Règles métier

Une règle exécutable possède :

- conditions structurées ;
- conséquences structurées ;
- priorité et exceptions ;
- période de validité ;
- juridiction ;
- dispositions sources ;
- version du compilateur ;
- résultat des tests métier.

Le moteur évalue les règles. Le LLM explique le résultat et les preuves.

## Temporalité

Toutes les entités métier utilisent des intervalles `[valid_from, valid_to)`.
`recorded_at` représente la connaissance du système ; `valid_from` représente le
monde juridique. Ces deux temps ne doivent jamais être confondus.

## Résolution des packs

Le moteur compose le socle international, le pack régional, le pack national,
l'accord applicable puis les règles privées autorisées. Une surcharge doit être
sourcée, datée et limitée à sa juridiction. La règle la plus récente n'est jamais
supposée prioritaire sans base juridique.
