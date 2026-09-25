# État réel du système

Dernière mesure : 25 septembre 2026. Projet Supabase :
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

## Orchestration durable

- `page-diagnostic-v1` est la première version de pipeline active.
- 14 118 diagnostics textuels sont enregistrés et versionnés.
- 11 795 pages sont orientées vers la couche texte native.
- 2 323 pages sont orientées vers OCR.
- 2 323 tâches OCR idempotentes ont été créées : 24 sont terminées et 2 299
  restent à traiter après les lots de validation de la passerelle.
- La file prend en charge verrouillage concurrent, heartbeat, reprises
  exponentielles, nombre maximal de tentatives et quarantaine.
- Les diagnostics, tâches, sorties de moteurs et blocs sont privés et accessibles
  uniquement au rôle serveur.
- Le diagnostic géométrique des PDF et l'exécution du worker OCR restent à faire.
- Le worker Node PDF/OCR est implémenté avec réclamation des tâches, téléchargement
  Storage, rendu Poppler, Tesseract multilingue, sorties immuables, blocs,
  diagnostics, complétion et reprise des erreurs.
- Un test réel sur `circulaire_48416`, page 2, a extrait 1 338 caractères avec
  une confiance OCR de 67 et un score technique de 85,53/100.
- Le worker doit encore être installé sur un environnement serveur disposant de
  Poppler et du secret `SUPABASE_SERVICE_ROLE_KEY` avant de consommer la file.
- Une passerelle Edge sécurisée est maintenant déployée. Elle utilise des jetons
  courts, stockés uniquement sous forme de SHA-256 et limités au scope
  `ocr_page`; le worker externe n'a plus besoin de recevoir la clé service role.
- `page-fusion-v1` et la table privée `page_fusion_decisions` sont déployés.
  Chaque décision conserve la signature des entrées, les scores des candidats,
  la sortie sélectionnée, les motifs et la version de l'algorithme.
- Le worker compare maintenant texte natif, PDFium et OCR. Il conserve chaque
  sortie et n'écrase pas directement le texte canonique.

## Qualité d'extraction

- 11 795 pages possèdent un texte natif d'au moins 80 caractères.
- 2 323 pages, soit 16,5 %, sont courtes ou vides et nécessitent un traitement.
- Les 14 118 pages sont encore enregistrées comme `native_pdf`.
- Confiance moyenne déclarée : 58,5/100.
- L'OCR navigateur existe, mais aucune campagne OCR serveur complète et
  reproductible n'a encore été appliquée au corpus.
- Les caractères NUL produits par certaines tables de polices PDF sont filtrés.
- Un audit PDFium indépendant des 2 316 SHA-256 uniques a ouvert 100 % des
  documents et compté exactement 14 118 pages : 11 791 pages avec au moins 80
  caractères, 175 pages courtes et 2 152 pages sans caractère extractible.
- `page-diagnostic-v2` est déployé. Il distingue `blank`, `native_text`,
  `scanned`, `hybrid`, `short_text`, `table`, `form`, `vector_complex` et
  `unknown` à partir du texte, des objets PDF, de la géométrie et de l'encre
  rendue. Ses résultats sont privés et versionnés dans
  `page_diagnostic_results`.
- L'image de worker reproductible est définie par `Dockerfile.worker` avec Node
  22, Poppler, PDFium, Tesseract, processus non-root, `tini`, endpoints de santé
  et arrêt propre. Sa construction locale reste à vérifier sur un hôte Docker.
- Un test multi-moteur réel sur `circulaire_48416`, page 2, a constaté 0 caractère
  PDFium et 1 338 caractères OCR. La fusion a sélectionné l'OCR avec un score de
  86,23/100. Ce test valide le mécanisme, pas encore la qualité du corpus complet.
- Le premier lot distant de 4 pages a produit 2 sélections OCR (85,53 et 92,06)
  et 2 rejets parce que les trois moteurs étaient vides. Ces deux rejets ont créé
  automatiquement 2 tâches `analyze_layout`; aucune page n'a été abandonnée.
- Une campagne locale élargie a été arrêtée après 24 pages : elle validait le
  débit mais ne constitue pas l'infrastructure de production exigée. Son jeton a
  été révoqué, les 10 baux interrompus ont été remis en file sans consommer de
  tentative, et la récupération automatique des baux expirés est déployée.

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
