# Licence

Le module `facturxinvoice` est distribué sous licence **Academic Free License 3.0 (AFL-3.0)**,
licence standard des modules distribués sur PrestaShop Addons.
Texte complet : https://opensource.org/licenses/AFL-3.0

## Bibliothèques tierces embarquées

Le module embarque les bibliothèques open-source suivantes (dossier `vendor/`),
toutes sous licence MIT (compatible avec la distribution commerciale) :

| Bibliothèque | Rôle | Licence |
|---|---|---|
| atgp/factur-x | Incrustation XML dans PDF, conformité PDF/A-3 | MIT |
| horstoeko/zugferd | Construction et validation du XML CII (Factur-X) | MIT |
| setasign/fpdf, setasign/fpdi | Manipulation PDF | MIT |
| smalot/pdfparser | Lecture PDF | LGPL-3.0 |
| jms/serializer (+ jms/metadata) | Sérialisation XML | MIT |
| symfony/validator, symfony/yaml, symfony/finder, symfony/process | Support horstoeko/zugferd | MIT |
| goetas-webservices/xsd2php-runtime | Support horstoeko/zugferd | MIT |

Les textes de licence complets sont disponibles dans les dossiers respectifs sous `vendor/`.
