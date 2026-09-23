# ADR 0001 — Séparer preuve, candidat et fait canonique

Statut : accepté.

## Contexte

Une extraction automatique peut être techniquement plausible sans être une donnée
juridique applicable. Mélanger le texte OCR, les propositions d'un modèle et les
faits publiés rendrait les réponses impossibles à auditer.

## Décision

Le système conserve trois niveaux distincts : preuve brute immuable, candidat
extrait versionné et fait canonique publié. Les liens entre niveaux sont explicites.
Le chat ne présente un candidat comme une certitude que si le contrat de réponse
l'indique et affiche sa confiance.

## Conséquences

Le modèle contient davantage de tables et d'états, mais permet la réextraction,
la comparaison de moteurs, l'audit et la correction sans altérer les sources.

