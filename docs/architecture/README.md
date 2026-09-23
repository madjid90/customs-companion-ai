# Architecture du cerveau douanier

Ce dossier est la source de vérité pour le développement de Douane AI.

| Document | Rôle |
| --- | --- |
| `CURRENT_STATE.md` | Mesures réelles, limites et état déployé |
| `TARGET_ARCHITECTURE.md` | Architecture finale et séparation des responsabilités |
| `INGESTION_PIPELINE.md` | Étapes, reprises, extraction et boucle de mise à jour |
| `CANONICAL_DATA_MODEL.md` | Entités canoniques SH, juridiques et réglementaires |
| `QUALITY_GATES.md` | Définition mesurable de la fiabilité et seuils de publication |
| `IMPLEMENTATION_PLAN.md` | Chantiers, ordre d'exécution et critères de fin |
| `decisions/` | Décisions d'architecture difficiles à inverser |

## Objectif

Construire un cerveau douanier versionné et sourcé qui répond à la question :

> Pour ce produit, cette opération, ce pays et cette date, quelles classifications,
> taxes, autorisations, règles et pièces sont applicables, et quelles preuves
> officielles les justifient ?

Les interfaces consomment le cerveau au moyen d'une API métier. Le chat et les
agents ne lisent pas directement les PDF et ne décident pas seuls du droit
applicable.

```mermaid
flowchart LR
  S[Sources officielles et Drive] --> I[Plateforme d'ingestion]
  I --> B[Cerveau douanier canonique]
  B --> A[API métier]
  A --> C[Chat]
  A --> G[Agents]
  A --> D[Documents]
  A --> O[Dossiers]
```

## Règle de priorité documentaire

En cas de contradiction :

1. contraintes et migrations exécutées dans la base ;
2. ce dossier `docs/architecture/` ;
3. tests automatisés ;
4. anciens documents généraux dans `docs/` ;
5. texte d'interface.

