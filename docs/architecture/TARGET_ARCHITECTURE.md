# Architecture cible

## Couches

```mermaid
flowchart TB
  subgraph Sources
    D[Douane et ADIL]
    BO[Bulletin officiel]
    M[Ministères et organismes]
    A[Accords et organisations]
    GD[Google Drive]
  end
  subgraph Acquisition
    DISC[Découverte]
    REG[Registre des occurrences]
    VER[Versions et empreintes]
    RAW[Stockage immuable]
  end
  subgraph Extraction
    PDF[Diagnostic PDF]
    TXT[Texte natif]
    OCR[OCR multilingue]
    VIS[Vision et tableaux]
    MERGE[Fusion par blocs]
    QA[Contrôles qualité]
  end
  subgraph Brain["Cerveau douanier"]
    EVI[Corpus probant]
    HS[Nomenclature et tarifs]
    LAW[Hiérarchie juridique]
    GRAPH[Graphe réglementaire]
    TIME[Droit applicable dans le temps]
    RULES[Règles métier exécutables]
  end
  subgraph Access
    API[API métier]
    RET[Récupération hybride]
    DEC[Moteur de décision]
  end
  subgraph Products
    CHAT[Chat]
    AGENT[Agents]
    DOC[Documents]
    CASE[Dossiers]
  end
  Sources --> DISC --> REG --> VER --> RAW --> PDF
  PDF --> TXT --> MERGE
  PDF --> OCR --> MERGE
  PDF --> VIS --> MERGE
  MERGE --> QA --> EVI
  EVI --> HS
  EVI --> LAW
  HS --> GRAPH
  LAW --> GRAPH --> TIME --> RULES
  RULES --> API --> DEC
  EVI --> RET --> DEC
  DEC --> CHAT
  DEC --> AGENT
  DEC --> DOC
  DEC --> CASE
```

## Séparation des responsabilités

- **Acquisition** constate qu'une ressource existe et conserve ses versions.
- **Extraction** reconstruit fidèlement le contenu visible sans interpréter le droit.
- **Normalisation** transforme les résultats en entités métier candidates.
- **Cerveau** consolide les versions, relations, périodes et règles applicables.
- **Moteur de décision** combine des faits publiés pour un contexte donné.
- **LLM** reformule, explique, demande les informations manquantes et cite les preuves.

## Services cibles

1. `source-discovery-worker`
2. `document-ingestion-worker`
3. `ocr-and-layout-worker`
4. `tariff-extractor`
5. `legal-structure-extractor`
6. `context-graph-builder`
7. `quality-evaluator`
8. `publication-compiler`
9. `customs-brain-api`

Les workers communiquent par des tâches durables avec idempotence, tentatives,
dead-letter queue et métriques. Vercel sert l'application et les API courtes ; les
traitements PDF longs s'exécutent dans un worker durable séparé. Supabase reste le
registre transactionnel, le stockage probant et la base du graphe métier.

