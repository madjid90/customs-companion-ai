# Douane AI — instructions de développement

Ce dépôt construit un cerveau douanier marocain indépendant des interfaces qui
l'utilisent. La priorité est la qualité de la donnée, sa preuve, sa validité dans
le temps et la reproductibilité de son extraction.

## Lecture obligatoire avant toute modification

Lire dans cet ordre :

1. `docs/architecture/README.md`
2. `docs/architecture/PRODUCT_REQUIREMENTS.md`
3. `docs/architecture/CURRENT_STATE.md`
4. `docs/architecture/TARGET_ARCHITECTURE.md`
5. `docs/architecture/INGESTION_PIPELINE.md`
6. `docs/architecture/CANONICAL_DATA_MODEL.md`
7. `docs/architecture/QUALITY_GATES.md`
8. `docs/architecture/IMPLEMENTATION_PLAN.md`
9. `docs/architecture/COUNTRY_PACKS.md`
10. `docs/architecture/CHANNELS_AND_INTEGRATIONS.md`
11. `docs/architecture/DELIVERY_ESTIMATE.md`

Ces fichiers constituent la source de vérité du projet. Les anciens documents
dans `docs/` restent utiles comme historique, mais ne priment pas sur
`docs/architecture/`.

## Principes non négociables

- Le LLM présente et explique des résultats calculés par le cerveau douanier. Il
  ne crée jamais un taux, une règle, une date ou un code SH absent des données.
- Chaque fait métier doit être relié à une source, une version, une page et une
  preuve extraite.
- Un fichier source est immuable et identifié par SHA-256. Une modification crée
  une nouvelle révision ; elle n'écrase jamais l'historique.
- Une copie physique supplémentaire ne déclenche pas une nouvelle extraction si
  son SHA-256 existe déjà.
- Les données proposées par extraction automatique restent distinctes des
  données canoniques publiées.
- Une absence de récupération ne signifie jamais suppression ou abrogation.
- Toute règle, mesure et relation possède une période de validité explicite.
- Toute extraction doit être idempotente, observable, reprenable et versionnée.
- Ne jamais annoncer 98 % sans mesure sur le jeu de référence décrit dans
  `QUALITY_GATES.md`.
- Les données d'entreprise restent isolées par organisation ; le corpus
  réglementaire partagé ne contient aucune donnée client.
- Le noyau ne contient aucune hypothèse propre au Maroc. Les règles nationales
  appartiennent au pack `MA`, construit en premier.
- Web, WhatsApp, ERP, SDK, MCP et agents consomment les mêmes contrats versionnés.
- Les agents spécialisés partagent le cerveau et ne conservent aucune copie
  autonome de la réglementation.

## Discipline de modification

- Toute migration Supabase est versionnée dans `supabase/migrations`.
- Toute évolution du pipeline incrémente sa version et conserve l'ancien résultat.
- Toute nouvelle entité extraite possède un contrat, des contraintes, une preuve
  et des tests de qualité.
- Toute pull request cite les exigences `REQ-*` de
  `docs/architecture/PRODUCT_REQUIREMENTS.md` qu'elle réalise ou modifie.
- Mettre à jour `CURRENT_STATE.md` après une migration, une réingestion ou une
  mesure importante.
- Mettre à jour `IMPLEMENTATION_PLAN.md` quand un chantier change d'état.
- Ajouter une décision dans `docs/architecture/decisions/` lorsqu'un choix
  structurel devient difficile à inverser.
- Exécuter au minimum `npx tsc --noEmit`, `npm test` et `npm run build` avant push.

## Ordre de priorité

1. intégrité et provenance ;
2. extraction page/bloc/tableau ;
3. nomenclature SH et tarifs ;
4. hiérarchie et versions juridiques ;
5. graphe de contexte ;
6. moteur de règles ;
7. API du cerveau ;
8. chat, agents et génération de documents.
