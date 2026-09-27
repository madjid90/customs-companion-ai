# Plan d'implémentation

Les états autorisés sont `todo`, `in_progress`, `blocked` et `done`. Un chantier
est `done` uniquement lorsque son critère de fin est mesuré.

Chaque chantier réalise une ou plusieurs exigences `REQ-01` à `REQ-10` définies
dans `PRODUCT_REQUIREMENTS.md`. Une livraison doit citer ces identifiants et
inscrire sa preuve mesurée dans `CURRENT_STATE.md`.

| Ordre | Chantier | État | Critère de fin |
| ---: | --- | --- | --- |
| 1 | Provenance, SHA-256 et occurrences | done | 2 987/2 987 rattachées, 0 échec |
| 2 | Orchestrateur durable et tâches reprenables | in_progress | reprise après crash et idempotence démontrées |
| 3 | Diagnostic PDF par page | in_progress | v2 déployé ; exécuter et mesurer les classes sur 100 % des pages |
| 4 | OCR serveur multilingue | in_progress | 2 323 pages traitées et seuils OCR mesurés |
| 5 | Blocs, géométrie et tableaux | in_progress | modèle probant tableau–ligne–cellule déployé ; produire la géométrie sur le corpus et la benchmarker |
| 6 | Extracteur tarifaire SH v2 | in_progress | pipeline, worker et validation déterministe déployés ; exécuter les 783 tâches puis mesurer code–désignation–taux |
| 7 | Extracteur juridique hiérarchique | in_progress | promotion draft et revue hiérarchique exécutées ; 1 768/1 779 provisions validées, 11 anomalies restantes à traiter par le parseur |
| 8 | Métadonnées et sources canoniques | todo | références, dates, autorités et URL publiées |
| 9 | Graphe réglementaire | in_progress | 10 relations juridiques proposées depuis le Code des douanes ; construire ensuite les liens SH–mesures et les dates d'effet |
| 10 | Compilateur temporel | todo | règle applicable calculée pour une date donnée |
| 11 | Jeu de référence et CI qualité | todo | rapport automatique et seuils bloquants |
| 12 | Surveillance et nouvelles versions | todo | découverte, diff, ingestion et impact automatiques |
| 13 | API du cerveau douanier | todo | contrats métier sourcés et stables |
| 14 | Agents métier sur l'API | todo | agents SH, juridique et opérations sans donnée inventée |
| 15 | Noyau commun et pack Maroc | done | registre générique et pack Maroc appliqués en production ; 1 pack, 12 autorités, 17 sources, 16 P0 et 17 connecteurs vérifiés |
| 16 | API plug-and-play et OpenAPI | todo | contrat `/v1` stable et SDK générables |
| 17 | Adaptateur WhatsApp obligatoire V1 | todo | demande, suivi dossier, preuves et reprise web utilisables sur WhatsApp |
| 18 | MCP et outils d'agents | todo | agents spécialisés limités aux outils autorisés |
| 19 | Webhooks et intégrations ERP | todo | événements signés, repris et auditables |
| 20 | Refonte complète pages web/admin/utilisateur | todo | toutes les pages finales branchées uniquement sur l'API `/v1` du cerveau |

## Règle d'ordre produit

Les pages web ne sont pas le produit central. Elles sont des consommateurs finaux
du cerveau, comme WhatsApp, ERP/TMS, MCP, SDK et agents. WhatsApp et la refonte
complète web/admin/utilisateur sont obligatoires pour la V1 Maroc, mais ils sont
construits après stabilisation du cerveau et de l'API `/v1`. Jusqu'à cette étape,
le développement frontend se limite aux écrans nécessaires pour surveiller
l'ingestion, contrôler la qualité, auditer les preuves et valider les candidats.
Les parcours utilisateur finaux sont construits après les chantiers 13 à 17.

## Périmètre V1 Maroc figé après audit

La V1 Maroc est pilotée par `CODEBASE_AUDIT_AND_V1_BACKLOG.md`. Ce document est
la référence pour les chantiers restants : noyau générique, pack Maroc, ingestion
multi-source, sources P0, graphe contexte, API `/v1`, WhatsApp obligatoire et
refonte complète web/admin/utilisateur. Les nouveaux développements doivent
indiquer quel chantier V1 ils font avancer et ne doivent plus étendre le legacy
comme source de vérité.

## Prochaine tranche de développement

1. appliquer `supabase/migrations/20260927223000_source_discovery_runs.sql` pour auditer les découvertes source et rattacher `source_assets` au `source_catalog` ;
2. brancher les adapters V1 sur Supabase : créer `source_discovery_runs`, inscrire les assets découverts, calculer SHA-256 et ne créer que des jobs candidats ;
3. finaliser et tester le worker d'extraction reprenable ;
4. enrichir les 14 118 diagnostics avec géométrie et images PDF ;
5. traiter les 2 323 tâches OCR déjà créées ;
6. ~~comparer automatiquement texte natif, PDFium et OCR~~ — moteur et registre
   de décisions déployés ; exécuter la comparaison sur les 2 323 pages ;
7. produire le premier rapport de qualité page par page ;
8. créer un jeton worker `extract_tariff`, lancer `npm run worker:tariff` sur les
   783 pages tarifaires mises en file et produire les lignes/cellules candidates ;
9. mesurer les candidats produits : faux positifs SH, code–désignation, taux,
   unités, pages rejetées et cas `review_required` ;
10. constituer le benchmark tarifaire avant toute publication canonique ;
11. rapport de qualité juridique admin livré : résumé global et liste des runs par document sans exposition du texte candidat ;
12. fallback juridique candidat livré pour les circulaires/accords sans articles : 5 702 candidats ajoutés, 903 runs à revoir, 126 rejetés ;
13. benchmark admin livré : buckets de promotion potentielle, candidats fallback, relations fortes et documents sans signal ;
14. staging de promotion livré : lot auditable de 15 runs prêt à revue, sans insertion canonique ;
15. promotion contrôlée draft livrée : premier run promu en `review`, 1 779 provisions en `needs_review`, zéro publication ;
16. revue auditée des provisions livrée : validation/rejet par RPC admin, événements d'audit, résumé et bloqueurs de publication ;
17. validation/rejet en masse par seuils livré : dry-run obligatoire possible, 837 provisions validées automatiquement sur le premier draft ;
18. diagnostic `needs_review` livré : les 941 restantes ont été ventilées par type, longueur, parent et confiance ;
19. revue hiérarchique livrée : 930 validations supplémentaires après dry-run, état final 1 768 `validated`, 11 `needs_review`, 0 `rejected`, 0 `published` ;
20. corriger le parseur juridique sur les 11 anomalies restantes : fragments isolés, titres internes typés paragraphes et blocs fusionnés ;
21. promotion draft des relations juridiques livrée : 111 candidates fortes dédupliquées en 10 relations `implements` proposées, avec instruments cibles brouillons et preuve liée ;
22. enrichir les relations proposées : résolution officielle des cibles, dates d'effet, versions cibles et validation avant publication ;
23. construire ensuite les liens SH–mesures–provisions à partir des faits SH validés ;
24. implémenter ensuite la publication contrôlée uniquement quand les provisions et relations sont validées ;
25. construire l'adaptateur WhatsApp obligatoire V1 dès que les contrats `/v1` du cerveau sont stables : demande, dossier, preuves, reprise web et audit ;
26. refondre toutes les pages web, admin et utilisateur après stabilisation de l'API : aucune règle métier dans l'interface, aucune lecture directe des tables canoniques ;
27. ne pas démarrer la refonte complète des pages métier avant les faits canoniques, les règles de sécurité et les seuils qualité, sauf écrans admin liés à la qualité data.

Le pack Maroc couvre le SH national, le Code des douanes, le RDII, les
circulaires, notes, accords applicables, droits, taxes, origine, autorisations,
contrôles, organismes, procédures, documents, délais, exceptions et sanctions.

## Définition de fini d'une tranche

- migration appliquée et sécurisée ;
- code, contrat et tests versionnés ;
- traitement idempotent ;
- métriques avant/après ;
- échecs observables et reprenables ;
- état de ce document et de `CURRENT_STATE.md` mis à jour ;
- build et tests applicatifs réussis ;
- code poussé sur la branche de travail ;
- si une page est modifiée, preuve qu'elle consomme l'API métier et ne porte pas
  de règle douanière en dur.
