# État réel du système

Dernière mesure : 27 septembre 2026. Projet Supabase :
`raygpbajipeyzxfxpbku`. Branche principale déployée : `main`.

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
- 2 323 tâches OCR idempotentes ont été créées : 24 sont terminées, 2 289
  sont en file `queued` et 10 sont en `retry_wait`.
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
- La publication atomique des décisions de fusion est déployée. Seules les
  décisions `selected` avec un score d'au moins 80 peuvent remplacer le texte
  courant ; les pages validées humainement et les documents publiés sont
  immuables. Chaque remplacement conserve intégralement l'ancien texte dans
  `page_publication_revisions`.
- Le premier backfill contrôlé a publié 21 améliorations OCR, avec des scores de
  82,63 à 92,06. La décision à 68,47 et les deux rejets sont restés hors du texte
  canonique. Les 21 textes précédents sont conservés pour audit et restauration.
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
- `tariff-extractor-v2` est déployé comme pipeline actif. Son modèle probant
  sépare désormais exécution, tableau, ligne et cellule ; chaque cellule peut
  conserver bloc source, page, coordonnées, valeur brute, valeur normalisée,
  confiance et empreinte SHA-256.
- 783 pages canoniques des 97 documents tarifaires ou nomenclatures possèdent un
  texte exploitable et ont reçu une tâche `extract_tariff` idempotente. Ces
  783 tâches sont en file `queued` et aucune exécution tarifaire n'a encore
  produit de `tariff_extraction_runs` ni de `tariff_row_candidates`. Il reste à
  créer un jeton worker `extract_tariff` et à lancer le worker tarifaire durable.
- Le validateur déterministe v2 normalise les codes de 4, 6, 8 et 10 chiffres,
  conserve les zéros initiaux et rejette notamment les dates, références
  juridiques hors contexte tarifaire, longueurs invalides et chapitre 77 réservé.
- Le worker `scripts/run-tariff-worker.mjs` est implémenté. Il consomme les tâches
  via `ingestion-worker-gateway`, vérifie l'empreinte du texte canonique, extrait
  des lignes et cellules candidates, et transmet uniquement des résultats
  candidats au modèle probant.
- `ingestion-worker-gateway` version 5 est déployée avec scopes séparés
  `ocr_page` et `extract_tariff`. Un jeton tarifaire ne peut pas soumettre une
  tâche OCR, et inversement.
- L'extraction tarifaire actuelle est `line_based_text` : elle conserve la preuve
  textuelle et les empreintes des cellules, mais ne fournit pas encore les
  coordonnées de tableau lorsque la géométrie de page n'existe pas.
- La sortie v2 reste exclusivement candidate. Elle ne peut pas alimenter les
  faits SH ou taux canoniques avant les contrôles de ligne, de hiérarchie, de
  cellule et le benchmark de référence.


## Extraction juridique hiérarchique

- `legal-structure-extractor-v1` est implémenté en mode candidat uniquement. Il
  détecte livres, titres, chapitres, sections, articles, paragraphes et annexes à
  partir du texte canonique des pages.
- Le modèle probant sépare `legal_extraction_runs`,
  `legal_provision_candidates` et `legal_relationship_candidates` des tables
  canoniques `legal_instruments`, `legal_versions`, `legal_provisions` et
  `legal_relationships`.
- Le worker `scripts/run-legal-worker.mjs` consomme les tâches `extract_legal`,
  calcule une signature d'entrée, écrit les candidats de façon idempotente et
  termine les jobs avec métriques.
- Les relations candidates distinguent notamment mention, modification,
  abrogation, remplacement, complément et application, avec texte de preuve,
  référence normalisée, date candidate et empreinte SHA-256.
- La migration est appliquée sur Supabase et 1 047 tâches `extract_legal` ont été
  créées puis consommées par le processeur en ligne planifié
  `public.run_online_legal_extraction_batch`.
- Les 1 047 jobs `extract_legal` sont terminés côté file. La première passe
  orientée articles avait produit 18 runs `completed`, 351 `review_required` et
  678 `rejected`.
- Une réparation candidate-only `postgres_circular_fallback_v1` a été appliquée
  aux circulaires, accords et documents assimilés qui ne suivent pas toujours une
  structure d'articles. Elle extrait des sections et paragraphes bornés par page,
  mais ne publie aucun fait canonique.
- Après cette réparation, l'état juridique candidat est : 18 runs `completed`,
  903 `review_required` et 126 `rejected`. Les rejets restants sont surtout des
  documents avec moins de trois candidats utiles ou sans contenu exploitable.
- La base contient maintenant 9 584 `legal_provision_candidates`, dont 5 702
  candidats fallback sur 614 runs. Les 1 095 articles initiaux restent séparés
  des paragraphes/sections fallback. Tous restent `validation_status=proposed` et
  `publication_status=candidate`.
- La passe a produit 4 964 `legal_relationship_candidates` : 3 872 mentions,
  570 modifications, 455 applications, 26 compléments, 19 remplacements, 18
  abrogations et 4 suspensions. Ces relations restent candidates.
- Aucun candidat juridique n'est publié automatiquement. Il reste à analyser les
  678 rejets, mesurer articles/alinéas/relations sur un jeu de référence et
  construire la promotion contrôlée vers les faits canoniques.
- Un reporting qualité admin est disponible via
  `public.get_legal_extraction_quality_summary()` et
  `public.list_legal_extraction_quality_runs(status, limit)`. Il expose les
  statuts, scores et volumes par document sans publier le texte candidat ni les
  preuves juridiques brutes.
- Un benchmark admin est disponible via `public.get_legal_candidate_benchmark()`
  et `public.list_legal_candidate_benchmark_runs(limit)`. Il classe les runs en
  buckets de travail avant promotion canonique : articles forts, contexte
  circulaire fallback, structure sans relation, faibles candidats et documents
  sans signal exploitable. La mesure actuelle identifie 18 runs candidats à
  l'échantillonnage de promotion, 1 095 articles à confiance 90+, 5 107
  candidats fallback à confiance 70+ et 1 092 relations à confiance 75+.
- Le staging de promotion canonique est déployé via `legal_promotion_batches`,
  `legal_promotion_batch_runs`, `public.create_legal_promotion_sample_batch()` et
  `public.get_legal_promotion_batch(batch_id)`. Un premier lot d'échantillon
  contient 15 runs prêts à revue de promotion : 5 runs fondés sur articles et 10
  runs de contexte circulaire, représentant 992 articles forts, 870 candidats
  fallback et 827 relations.
- La promotion contrôlée vers le brouillon canonique est disponible via
  `public.promote_legal_staging_batch_to_draft(batch_id, max_runs)`. Le premier
  test a promu un seul run en revue : 1 instrument brouillon, 1 version juridique
  `review` et 1 779 provisions initialement `needs_review`.
- La revue auditée des provisions est disponible via
  `public.review_legal_provision(provision_id, status, note, reason)` et
  `public.get_legal_version_review_summary(version_id)`. Un premier test a validé
  1 provision avec trace d'audit.
- La validation en masse par seuils stricts est disponible via
  `public.apply_legal_provision_review_thresholds(version_id, ...)`. Sur la
  version du Code des douanes en revue, 837 validations automatiques ont été
  appliquées après dry-run. Cette première passe a montré que 941 provisions
  restaient `needs_review`, principalement parce que la règle ne tenait pas
  compte de la hiérarchie parent/enfant.
- Un diagnostic admin dédié est disponible via
  `public.get_legal_needs_review_diagnostics(version_id)`. Il ventile les
  provisions restantes par type, longueur, confiance, parent validé et exemples
  de preuve. Le diagnostic a montré que la majorité des 941 restantes étaient des
  paragraphes fiables rattachés à un article déjà validé.
- La revue hiérarchique est disponible via
  `public.apply_hierarchy_aware_legal_review(version_id, ...)`. Après dry-run,
  elle a validé 925 provisions supplémentaires : 745 paragraphes avec parent
  validé, 176 noeuds de structure et 4 articles courts explicitement abrogés.
  Une règle complémentaire a ensuite validé 5 paragraphes courts `abrogé`. L'état
  mesuré du draft juridique est maintenant : 1 768 provisions `validated`, 11
  `needs_review`, 0 `rejected` et 0 version `published`.
- Les 11 provisions encore `needs_review` sont conservées volontairement : elles
  correspondent à de vrais signaux faibles d'extraction, notamment des fragments
  trop courts (`Toutefois,`), des titres internes mal typés (`– Electeurs`,
  `Surveillance :`) et des blocs très longs probablement fusionnés. Elles doivent
  alimenter l'amélioration du parseur juridique, pas être forcées en validation.

## Métadonnées canoniques manquantes

Les colonnes `official_reference`, `publication_date`, `effective_from` et
`source_url` ne sont pas encore alimentées pour le corpus importé. Des candidats
existent dans `metadata`, mais ils ne constituent pas des faits canoniques.

## Position produit, interfaces et déploiement

Le projet est maintenant déployé sur Vercel et connecté à Supabase. Les routes SPA
Vercel, la connexion admin, la demande d'accès, l'approbation utilisateur, les
fonctions `submit-access-request`, `verify-otp` et `approve-access`, ainsi que les
grants de rôle admin ont été corrigés et vérifiés. Cette étape valide le tuyau
GitHub → Vercel → Supabase ; elle ne transforme pas les pages actuelles en produit
final.

Les pages actuelles restent utiles pour consulter, administrer et tester le
corpus, mais elles ne représentent pas le produit final. Le produit à terminer en
priorité est le cerveau douanier : data fiable, faits canoniques, contexte,
relations, règles temporelles et API métier. La refonte des pages métier doit
attendre que les contrats `/v1` soient stabilisés, sauf écrans nécessaires à la
qualité de l'ingestion et à la revue des preuves.

## Conclusion opérationnelle

La provenance, le stockage immuable, la déduplication et le déploiement cloud de
base sont solides. La base est consultable et utile pour retrouver des preuves.
Elle n'est pas encore autorisée à produire seule une décision juridique, un
classement SH définitif ou un calcul de droits. Les principaux risques sont l'OCR
incomplet, les tableaux tarifaires non exécutés, la hiérarchie juridique candidate
non promue, la temporalité et l'absence de mesures sur une vérité terrain. Le
prochain développement reste donc centré sur la data, l'ingestion, les candidats,
la promotion canonique et la sécurité, pas sur la refonte des pages finales ni sur
l'API avant stabilisation des faits.
