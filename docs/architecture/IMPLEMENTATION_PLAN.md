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
| 7 | Extracteur juridique hiérarchique | todo | code et RDII structurés jusqu'à l'alinéa |
| 8 | Métadonnées et sources canoniques | todo | références, dates, autorités et URL publiées |
| 9 | Graphe réglementaire | in_progress | relations disposition–SH–mesure datées |
| 10 | Compilateur temporel | todo | règle applicable calculée pour une date donnée |
| 11 | Jeu de référence et CI qualité | todo | rapport automatique et seuils bloquants |
| 12 | Surveillance et nouvelles versions | todo | découverte, diff, ingestion et impact automatiques |
| 13 | API du cerveau douanier | todo | contrats métier sourcés et stables |
| 14 | Agents métier sur l'API | todo | agents SH, juridique et opérations sans donnée inventée |
| 15 | Noyau commun et pack Maroc | todo | aucune règle MA dans le noyau, résolution MA testée |
| 16 | API plug-and-play et OpenAPI | todo | contrat `/v1` stable et SDK générables |
| 17 | Adaptateur WhatsApp | todo | même dossier utilisable sur web et WhatsApp |
| 18 | MCP et outils d'agents | todo | agents spécialisés limités aux outils autorisés |
| 19 | Webhooks et intégrations ERP | todo | événements signés, repris et auditables |
| 20 | Pages web métier finales | todo | pages branchées uniquement sur l'API `/v1` du cerveau |

## Règle d'ordre produit

Les pages web ne sont pas le produit central. Elles sont des consommateurs finaux
du cerveau, comme WhatsApp, ERP/TMS, MCP, SDK et agents. Jusqu'à la stabilisation
de l'API `/v1`, le développement frontend se limite aux écrans nécessaires pour
surveiller l'ingestion, contrôler la qualité, auditer les preuves et valider les
candidats. Les parcours utilisateur finaux sont construits après les chantiers
13 à 16.

## Prochaine tranche de développement

1. finaliser et tester le worker d'extraction reprenable ;
2. enrichir les 14 118 diagnostics avec géométrie et images PDF ;
3. traiter les 2 323 tâches OCR déjà créées ;
4. ~~comparer automatiquement texte natif, PDFium et OCR~~ — moteur et registre
   de décisions déployés ; exécuter la comparaison sur les 2 323 pages ;
5. produire le premier rapport de qualité page par page ;
6. créer un jeton worker `extract_tariff`, lancer `npm run worker:tariff` sur les
   783 pages tarifaires mises en file et produire les lignes/cellules candidates ;
7. mesurer les candidats produits : faux positifs SH, code–désignation, taux,
   unités, pages rejetées et cas `review_required` ;
8. constituer le benchmark tarifaire avant toute publication canonique ;
9. utiliser le même corpus probant pour l'extracteur juridique ;
10. ne pas démarrer la refonte des pages métier tant que les contrats du cerveau
    ne sont pas stabilisés, sauf écrans admin liés à la qualité data.

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
