# Qualité et objectif 98 %

## Principe

« 98 % fiable » n'est valide que pour une métrique définie, un jeu de référence
figé et une version de pipeline donnée. Un score moyen global ne suffit pas.

## Jeu de référence

Créer un corpus annoté contenant au minimum :

- 500 pages représentatives ;
- français, arabe et bilingue ;
- PDF natifs, scans, rotations et mauvaise résolution ;
- 100 tableaux tarifaires ;
- 1 000 lignes SH complètes ;
- 300 dispositions juridiques ;
- 200 relations de modification, remplacement ou abrogation ;
- 100 règles reliant SH, autorisation, taux, pays et date.

Les annotations portent sur le texte, la géométrie, les cellules, les codes, les
taux, la hiérarchie, les dates, les relations et les preuves.

## Seuils de production

| Mesure | Seuil |
| --- | ---: |
| Pages acquises et comptées | 100 % |
| Pages avec stratégie d'extraction terminée | 100 % |
| Caractères sur pages natives | ≥ 99,5 % |
| Caractères sur scans lisibles | ≥ 98 % |
| Cellules de tableaux correctement reconstruites | ≥ 98 % |
| Codes SH exacts | ≥ 99,5 % |
| Association code–désignation | ≥ 99 % |
| Association code–taux–unité | ≥ 99 % |
| Hiérarchie juridique | ≥ 99 % |
| Références et dates | ≥ 98 % |
| Relations juridiques | précision ≥ 98 %, rappel ≥ 95 % |
| Citations pointant vers la bonne page | 100 % |

## Blocages automatiques

Bloquer la publication en présence de : page absente, code invalide, taux sans
unité attendue, article orphelin, date contradictoire, référence non résolue
requise, tableau décalé, relation d'abrogation sans preuve ou extraction différente
du fichier évalué.

## Contrats de réponse

Une réponse métier doit distinguer `confirmed`, `probable`, `ambiguous` et
`unknown`. Si une donnée obligatoire est inconnue, le moteur retourne une question
ou une impossibilité calculée ; il ne complète jamais par invention.

## Non-régression

Chaque version du pipeline produit un rapport comparé à la version publiée. Une
baisse sur une métrique critique bloque le déploiement. Les échantillons et
résultats sont versionnés avec le code.

