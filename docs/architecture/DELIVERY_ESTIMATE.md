# Estimation de livraison du pack Maroc

Cette estimation suppose une équipe concentrée comprenant au minimum deux
développeurs backend/data, un profil IA/document, un développeur produit et un
expert douanier disponible pour la vérité terrain. Les agents de code accélèrent
l'implémentation, mais ne remplacent pas l'évaluation juridique et tarifaire.

## Phases

| Phase | Durée indicative | Livrable |
| --- | ---: | --- |
| Ingestion durable, diagnostic et observabilité | 2–3 semaines | traitements reprenables, 100 % des pages diagnostiquées |
| OCR, blocs, géométrie et tableaux | 3–5 semaines | pages faibles retraitées, structure persistée |
| SH Maroc, désignations, unités et taux | 4–6 semaines | nomenclature nationale benchmarkée |
| Code, RDII et hiérarchie juridique | 4–6 semaines | dispositions structurées jusqu'à l'alinéa |
| Circulaires, accords et graphe | 4–6 semaines | relations, autorisations, origine et mesures datées |
| Moteur temporel et règles métier | 3–5 semaines | règle applicable calculée par contexte et date |
| API `/v1` et agents métier | 2–4 semaines | sorties plug-and-play, agents SH/juridique/opérations |
| Pages web finales et canaux WhatsApp/ERP | 2–4 semaines | expérience utilisateur branchée sur l'API, sessions multicanales |
| Sécurité, charge, restauration et pilote | 3–4 semaines | version de production pilotable |

Les phases se chevauchent partiellement et ne s'additionnent pas toutes de façon
séquentielle.

## Calendrier réaliste

- **4 à 6 semaines** : bêta technique avec ingestion durable et premiers
  résultats SH et juridiques structurés.
- **8 à 12 semaines** : pilote Maroc utilisable par une équipe accompagnée, avec
  citations et limites explicites.
- **16 à 24 semaines** : produit Maroc opérationnel en production, couvrant SH,
  juridique, réglementaire, API, sécurité, mises à jour et pages finales branchées
  sur le cerveau.
- **6 à 9 mois** : précision élevée démontrée sur le benchmark complet, avec
  correction des cas rares et validation métier.

Avec une seule personne, même assistée par des agents de code, prévoir au moins
4 à 6 mois pour une version sérieuse et davantage pour démontrer les seuils de
`QUALITY_GATES.md`.

## Sens de « 100 % opérationnel »

Toutes les familles Maroc prévues sont ingérées, versionnées, requêtables et
sourcées ; les traitements sont reprenables ; les erreurs sont visibles ; les
décisions incertaines sont signalées ; les mises à jour conservent l'historique ;
les seuils du benchmark sont atteints ; les pages et canaux consomment l'API du
cerveau sans logique douanière en dur. Cela ne signifie pas zéro erreur possible.

## Dépendances pouvant modifier le délai

- accès aux versions officielles et historiques ;
- licences OMD et droits de réutilisation ;
- disponibilité d'un expert douanier ;
- qualité des scans et tableaux ;
- couverture réelle des accords et organismes ;
- infrastructure des workers OCR ;
- volume du jeu de référence annoté.

