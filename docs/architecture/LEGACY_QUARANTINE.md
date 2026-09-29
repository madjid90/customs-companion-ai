# Quarantaine legacy

Dernière mise à jour : 27 septembre 2026.

Cette quarantaine existe pour éviter le bricolage pendant la transition vers le cerveau douanier V1. Le legacy peut encore servir l'application actuelle, mais il ne doit plus devenir source de vérité ni recevoir de nouveaux développements métier.

## Règle

Tout nouveau développement métier doit passer par le noyau cible :

1. `source_catalog` / `jurisdiction_packs` pour la provenance pays ;
2. tables candidates et preuves pour l'ingestion ;
3. faits canoniques publiés pour SH, juridique, obligations et contexte ;
4. API `/v1` pour les pages, agents, WhatsApp et intégrations.

Les anciennes tables suivantes sont en quarantaine :

- `country_tariffs` ;
- `legal_chunks` ;
- `controlled_products` ;
- `tariff_notes` ;
- `knowledge_documents` ;
- `pdf_extractions` ;
- `regulatory_sources` lorsqu'elle sert directement l'ancien upload ou les anciens feeds.

## Fichiers encore autorisés temporairement

Ces fichiers peuvent encore référencer le legacy parce qu'ils alimentent ou servent les pages existantes. Ils doivent être remplacés, puis supprimés ou réduits à de simples adaptateurs de migration.

| Fichier | Raison temporaire | Sortie attendue |
| --- | --- | --- |
| `src/pages/admin/AdminUpload.tsx` | ancienne ingestion admin PDF/Claude et imports ANRT Excel/CSV locaux | remplacer par console ingestion V1 basée sur `source_catalog`, `spreadsheet_importer`, jobs et preuves |

| `src/components/admin/ExtractionPreviewDialog.tsx` | prévisualisation ancienne extraction | remplacer par preuves/page decisions V1 |
| `src/pages/admin/AdminBulkImport.tsx` | import massif ancien corpus | remplacer par source assets/jobs V1 |
| `src/pages/admin/AdminCorpus.tsx` | vues corpus encore liées à `regulatory_sources` | remplacer par source catalog et source documents V1 |
| `src/pages/admin/AdminHSCodes.tsx` | administration tarif legacy | remplacer par revue tariff candidates + publication canonique |
| `src/integrations/supabase/types.ts` | types générés reflétant encore la base complète | régénérer après retrait legacy de la base |
| `supabase/functions/_shared/validation.ts` | validation edge partagée legacy | remplacer par contrats `/v1` |
| `supabase/functions/chat/index.ts` | orchestration chat legacy | remplacer par agents métier `/v1` |
| `supabase/functions/chat/hierarchical-ranker.ts` | ranking legacy sur chunks | remplacer par graph retrieval canonique |
| `supabase/functions/chat/prompt-builder.ts` | prompts construits depuis legacy | remplacer par render de réponses sourcées `/v1` |
| `supabase/functions/classify/index.ts` | classification legacy | remplacer par `/v1/classify` sur cerveau canonique |
| `src/pages/admin/AdminDocuments.tsx` | ancienne analyse PDF | remplacer par qualité page/source V1 |
| `src/pages/admin/AdminReferences.tsx` | ancienne extraction références | remplacer par mesures réglementaires canoniques |
| `src/lib/hsCodeInheritance.ts` | ancienne lecture tarif/contrôles | remplacer par graphe SH canonique |
| `src/components/admin/EmbeddingPanel.tsx` | embeddings legacy | remplacer par indexation des faits publiés |
| `src/components/admin/ReingestionPanel.tsx` | réingestion legacy | remplacer par relance de jobs V1 |
| `src/components/admin/MissingChunksPanel.tsx` | chunks legacy | remplacer par diagnostics preuves/pages V1 |
| `src/components/consultation/ConsultationWizard.tsx` | génération rapport legacy | remplacer par API `/v1/route` et `/v1/documents` |
| `supabase/functions/analyze-pdf/index.ts` | ancien parseur PDF/tarif | remplacer par workers V1 document + tariff |
| `supabase/functions/ingest-legal-doc/index.ts` | ancien parseur juridique/chunks | remplacer par workers V1 source/page/legal |
| `supabase/functions/generate-embeddings/index.ts` | embeddings anciennes tables | remplacer par indexation V1 |
| `supabase/functions/populate-references/index.ts` | extraction références legacy | remplacer par extraction obligations/mesures V1 |
| `supabase/functions/consultation-report/index.ts` | rapport direct sur legacy | remplacer par API cerveau `/v1` |
| `supabase/functions/analyze-product-image/index.ts` | recherche legacy pour image | remplacer par classify `/v1` |
| `supabase/functions/analyze-dum/index.ts` | calcul DUM legacy | remplacer par rate/rules `/v1` |
| `supabase/functions/chat/*` | RAG/chat legacy | remplacer par agents métier sur `/v1` |
| `supabase/functions/poll-regulatory-feeds/index.ts` | ancienne surveillance RSS | remplacer par source adapters V1 |
| `supabase/functions/import-local-corpus/index.ts` | import historique du corpus | conserver seulement comme migration/outillage interne si nécessaire |

## Barrière de non-régression

Le test `src/lib/customs-brain/legacy-boundaries.test.ts` échoue si un nouveau fichier référence une table legacy sans être ajouté explicitement à cette quarantaine. Ajouter un fichier à l'allowlist n'est pas une solution normale : cela doit être justifié dans ce document et accompagné d'un chantier de remplacement.

## Ordre de nettoyage

1. Construire les adapters source V1 à partir de `source_catalog`.
2. Remplacer `AdminUpload`, `AdminDocuments` et `AdminReferences` par une console ingestion/qualité V1.
3. Remplacer `consultation-report`, `chat`, `analyze-dum` et `analyze-product-image` par l'API `/v1`.
4. Supprimer ou archiver les fonctions Edge legacy non appelées.
5. Supprimer les anciennes routes/pages quand les parcours V1 sont branchés.
