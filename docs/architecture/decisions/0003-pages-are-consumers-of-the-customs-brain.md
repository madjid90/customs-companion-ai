# ADR 0003 — Les pages sont des consommateurs du cerveau douanier

Statut : accepté

## Contexte

Douane AI peut être utilisé depuis plusieurs canaux : application web, chat,
agents métier, WhatsApp, ERP/TMS, SDK, MCP et webhooks. Si la logique métier est
placée dans les pages, chaque canal risque de produire une réponse différente et
la réglementation serait dupliquée dans l'interface.

Le besoin validé est inverse : construire un cerveau douanier fiable et unique,
puis brancher les canaux dessus.

## Décision

Le produit central est le cerveau douanier : corpus probant, données canoniques,
graphe réglementaire, moteur temporel, règles métier et API `/v1`.

Les pages web sont des consommateurs finaux. Elles collectent le besoin
utilisateur, appellent l'API métier, affichent les preuves et permettent la revue.
Elles ne contiennent pas de règle SH, taux, autorisation, relation juridique,
priorité pays ou logique de dédouanement en dur.

L'ordre de construction devient :

1. ingestion et qualité data ;
2. extraction SH, tarifaire et juridique ;
3. faits canoniques et graphe de contexte ;
4. moteur de décision et API `/v1` ;
5. agents métier branchés sur l'API ;
6. pages web finales et autres canaux.

## Conséquences

- Les écrans web existants peuvent rester disponibles pour consultation,
  administration et revue qualité.
- Une refonte visuelle ou parcours client final n'est pas prioritaire tant que
  l'API du cerveau n'est pas stable.
- Tout nouveau canal doit recevoir les mêmes statuts, preuves, citations et
  incertitudes que les autres canaux.
- Les tests de canal vérifient l'équivalence des réponses, pas seulement le rendu.
- Le frontend ne lit pas directement les tables canoniques et ne réimplémente pas
  les règles douanières.

## Alternatives rejetées

- Construire d'abord les pages puis déplacer la logique plus tard : rejeté, car
  cela crée une dette métier et des divergences entre canaux.
- Faire un agent autonome par canal : rejeté, car chaque agent aurait sa propre
  compréhension de la réglementation.
- Coder le Maroc directement dans l'interface : rejeté, car les packs pays doivent
  rester configurables et versionnés dans le cerveau.
