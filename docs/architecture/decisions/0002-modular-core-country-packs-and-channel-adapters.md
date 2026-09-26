# ADR 0002 — Noyau modulaire, packs pays et adaptateurs

Statut : accepté.

## Contexte

Douane AI doit couvrir le Maroc, puis d'autres juridictions, tout en alimentant
pages web, WhatsApp, ERP et agents spécialisés. Dupliquer le cerveau par pays ou
par canal créerait des règles divergentes et des mises à jour incohérentes.

## Décision

Construire un monolithe modulaire avec un noyau indépendant des pays, des packs
versionnés par juridiction, une API métier unique et des adaptateurs de canaux.
Le Maroc est le premier pack complet. Tous les agents utilisent les outils de la
même API et ne stockent pas leur propre réglementation.

## Conséquences

Les contrats de juridiction et d'API sont conçus avant les interfaces. L'ajout
d'un pays nécessite un pack et ses tests, pas une copie de l'application. Une
séparation en microservices reste possible plus tard sans modifier le modèle.

