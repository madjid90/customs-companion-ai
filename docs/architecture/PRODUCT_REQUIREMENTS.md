# Exigences produit de référence

Statut : validé. Ce document décrit le résultat attendu du développement. Il est
obligatoire avant toute modification du code et prime sur une description plus
ancienne ou plus générale du produit.

Une exigence n'est `done` que lorsque son critère d'acceptation est mesuré et que
la preuve correspondante est inscrite dans `CURRENT_STATE.md`. La présence d'une
table, d'un écran ou d'un prototype ne suffit pas.

## Principe produit — cerveau d'abord, pages ensuite

Douane AI n'est pas défini par ses pages. Le produit est le cerveau douanier :
corpus probant, faits canoniques, graphe de contexte, règles dans le temps et API
métier. Les pages web, le chat, les agents, WhatsApp, ERP/TMS, MCP et SDK sont des
consommateurs de cette API.

Aucune page métier ne doit contenir de règle douanière, de logique SH, de calcul
de taux ou de relation juridique en dur. Une page peut seulement collecter le
besoin utilisateur, appeler l'API du cerveau, afficher les preuves et aider à la
revue. La refonte des pages arrive après les chantiers data, contexte, moteur de
décision et contrat `/v1`, sauf pour les écrans d'administration indispensables à
la qualité de l'ingestion.

## REQ-01 — Ingestion fiable et automatique

Chaque fichier est identifié, dédupliqué, versionné et suivi. Les pages difficiles
passent automatiquement vers l'OCR français, arabe et anglais. L'échec d'un
document ne bloque jamais le traitement du corpus.

Critères d'acceptation : acquisition immuable par SHA-256, occurrences rattachées,
tâches idempotentes et reprenables, tentatives bornées, quarantaine, métriques et
100 % des pages arrivées dans un état terminal explicite.

## REQ-02 — Extraction contrôlée

Le système conserve et compare le texte natif, une seconde extraction PDF et
l'OCR. Il choisit la meilleure sortie par page ou par bloc, sans détruire les
sorties précédentes, avec méthode, version, score et justification du choix.

Critères d'acceptation : sorties immuables de chaque moteur, décision de fusion
auditée, provenance jusqu'aux coordonnées de page, non-régression mesurée et
publication bloquée lorsque la fusion reste contradictoire.

## REQ-03 — Extraction SH et tarifaire précise

Les tableaux tarifaires sont reconstruits en colonnes : code, désignation, unité,
droit, taxe, régime et notes. Le système différencie un code SH d'une date, d'un
numéro de circulaire, d'un article et de tout autre nombre.

Critères d'acceptation : hiérarchie section–chapitre–position–sous-position–ligne
nationale, cellules rattachées à leur tableau et à leur preuve, contrôles de format
et seuils SH/tarif de `QUALITY_GATES.md` atteints sur le jeu de référence.

## REQ-04 — Base juridique structurée

Chaque instrument et chaque version juridique comprend au minimum référence,
date, autorité, nature, période de validité, hiérarchie jusqu'à l'alinéa ou
l'annexe, produits et codes SH concernés, obligations, interdictions,
autorisations, exceptions et relations de modification, complément, remplacement
ou abrogation.

Critères d'acceptation : dispositions adressables, relations sourcées et datées,
versions historiques conservées, contradictions signalées et seuils juridiques de
`QUALITY_GATES.md` atteints.

## REQ-05 — Contexte douanier cohérent

Le cerveau relie codes SH, désignations, droits, taxes, textes, accords, origine,
destination, autorisations, contrôles techniques, organismes, régimes,
procédures, justificatifs, délais, exceptions et sanctions.

Critères d'acceptation : une requête comprenant produit, opération, pays et date
produit un parcours réglementaire calculé ; chaque relation porte sa juridiction,
sa période, son statut et sa preuve.

## REQ-06 — Réponses traçables et sans invention

Chaque résultat expose source, version, page ou zone, date applicable, niveau de
confiance et statut `confirmed`, `probable`, `ambiguous` ou `unknown`. Le LLM
présente les faits du cerveau et ne crée jamais un code, un taux ou une règle.

Critères d'acceptation : 100 % des affirmations métier publiées possèdent une
preuve exploitable ; les données manquantes produisent une question ou `unknown` ;
les tests vérifient les citations et l'absence de valeur inventée.

## REQ-07 — Mises à jour maîtrisées

Une nouvelle circulaire ou une nouvelle version crée une révision sans effacer
l'historique. Le système détecte les changements, réévalue les relations et
signale les impacts sur les codes SH, règles, procédures et dossiers concernés.

Critères d'acceptation : découverte ou import différentiel, version juridique,
publication atomique, analyse d'impact, recalcul ciblé et retour arrière. La
disparition technique d'une source ne vaut jamais abrogation.

## REQ-08 — Cerveau unique et réutilisable

Le noyau reste indépendant des pays. Le Maroc est le premier pack réglementaire ;
les autres juridictions sont ajoutées par des sources, taxonomies, règles,
mappings et tests versionnés, sans dupliquer l'application.

Critères d'acceptation : aucune règle marocaine codée dans le noyau, résolution
explicite des priorités entre couches internationale, régionale, nationale et
accords, et contrat de pack conforme à `COUNTRY_PACKS.md`.

## REQ-09 — Accès plug-and-play

Une API métier versionnée alimente l'application web, les agents SH, juridique et
opérations, WhatsApp, les ERP/TMS, les SDK, MCP, webhooks et futurs partenaires.
L'application web est un consommateur de l'API au même titre que les autres
canaux ; elle ne devient prioritaire qu'après stabilisation des contrats métier.

Critères d'acceptation : contrat OpenAPI `/v1`, authentification et scopes,
idempotence, mêmes résultats canoniques sur chaque canal, aucune lecture directe
des tables canoniques depuis un frontend ou un agent.

## REQ-10 — Fonctions métier finales

À partir de la description d'un produit et de son opération, l'utilisateur reçoit
une proposition SH justifiée, les taux applicables, les textes liés, les
autorisations, contrôles, documents, risques et étapes du dédouanement. Le système
génère des livrables sourcés : checklist, note réglementaire et dossier
documentaire.

Critères d'acceptation : les fonctions `classify_product`, `get_applicable_rates`,
`get_required_authorizations`, `get_required_documents`, `get_applicable_law` et
`build_customs_route` fonctionnent sur le pack Maroc ; les documents générés
conservent les citations, versions et statuts d'incertitude.

## Traçabilité vers les chantiers

| Exigence | Chantiers principaux | État actuel | Preuve attendue |
| --- | --- | --- | --- |
| REQ-01 | 1–4 | in_progress | couverture corpus, reprises et états terminaux |
| REQ-02 | 3–5, 11 | in_progress | comparaison multi-moteur et décision de fusion |
| REQ-03 | 5–6, 11 | todo | benchmark lignes SH et tableaux tarifaires |
| REQ-04 | 7–8, 10–11 | todo | benchmark hiérarchie, dates et relations |
| REQ-05 | 9–10 | in_progress | scénarios produit–opération–pays–date |
| REQ-06 | 11, 13–14 | todo | citations exactes et tests anti-invention |
| REQ-07 | 10, 12 | todo | nouvelle version, impact et retour arrière |
| REQ-08 | 15 | todo | tests du noyau et du pack `MA` |
| REQ-09 | 13, 16–20 | todo | OpenAPI avant pages, tests identiques par canal |
| REQ-10 | 13–14 et génération documentaire | todo | parcours Maroc et livrables sourcés |

## Règle de suivi

Chaque pull request doit citer les identifiants `REQ-*` concernés. Après une
livraison ou une mesure, mettre à jour la matrice ci-dessus,
`IMPLEMENTATION_PLAN.md` et `CURRENT_STATE.md`. Aucun pourcentage d'avancement ne
doit être augmenté sans preuve mesurée.
