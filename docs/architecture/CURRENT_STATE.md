# État réel du système

Dernière mesure : 23 septembre 2026. Projet Supabase :
`raygpbajipeyzxfxpbku`. Branche : `codex/regulatory-ingestion-foundation`.

## Corpus et provenance

- 2 987 PDF observés dans Google Drive et dans le corpus local.
- 2 316 contenus uniques identifiés par SHA-256.
- 671 occurrences physiques redondantes.
- 2 987 occurrences inscrites dans `source_assets`.
- 0 occurrence non rattachée à `source_documents`.
- 2 316 documents, tous au statut `quality_review`.
- 14 118 pages enregistrées.
- 0 exécution d'ingestion actuellement en échec.

## Qualité d'extraction

- 11 795 pages possèdent un texte natif d'au moins 80 caractères.
- 2 323 pages, soit 16,5 %, sont courtes ou vides et nécessitent un traitement.
- Les 14 118 pages sont encore enregistrées comme `native_pdf`.
- Confiance moyenne déclarée : 58,5/100.
- L'OCR navigateur existe, mais aucune campagne OCR serveur complète et
  reproductible n'a encore été appliquée au corpus.
- Les caractères NUL produits par certaines tables de polices PDF sont filtrés.

## Classification et contexte

- 2 316 profils documentaires automatiques.
- 468 profils restent `unclassified`.
- Confiance moyenne des profils : 70,9/100.
- 0 profil automatique juridiquement vérifié.
- 1 287 circulaires ou accords possèdent un contexte automatique.
- 907 références, 799 dates textuelles et 728 objets ont été proposés.
- 809 relations documentaires proposées, dont 493 reliées à une cible.
- 0 relation publiée comme validée.

## Données SH

- 8 312 candidats SH, tous au statut `proposed`.
- Confiance moyenne des candidats : 71,2/100.
- 229 315 mentions exactes de codes à dix chiffres.
- 22 373 codes distincts mentionnés sur 2 515 pages.
- Les tableaux, désignations, unités et taux ne sont pas encore reconstruits avec
  une précision démontrée.

## Métadonnées canoniques manquantes

Les colonnes `official_reference`, `publication_date`, `effective_from` et
`source_url` ne sont pas encore alimentées pour le corpus importé. Des candidats
existent dans `metadata`, mais ils ne constituent pas des faits canoniques.

## Conclusion opérationnelle

La provenance, le stockage immuable et la déduplication sont solides. La base est
consultable et utile pour retrouver des preuves. Elle n'est pas encore autorisée
à produire seule une décision juridique, un classement SH définitif ou un calcul
de droits. Les principaux risques sont l'OCR incomplet, les tableaux tarifaires,
la hiérarchie juridique, la temporalité et l'absence de mesures sur une vérité
terrain.

