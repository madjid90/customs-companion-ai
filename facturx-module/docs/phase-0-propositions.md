# Phase 0 — Propositions à valider

> Statut : **EN ATTENTE DE VALIDATION** du product owner.
> Rien de ce document n'est codé tant que les décisions D1 à D5 ne sont pas validées.
> Toutes les données factuelles (versions, licences, compatibilités) ont été vérifiées le 2026-07-09 sur Packagist, GitHub et la documentation officielle PrestaShop.

---

## 1. Décisions à valider (synthèse)

| # | Décision | Proposition recommandée |
|---|----------|------------------------|
| D1 | Combinaison de bibliothèques | `atgp/factur-x` (PDF/A-3) + `horstoeko/zugferd` (XML CII) — option A ci-dessous |
| D2 | Version PHP minimale du module | **PHP 7.4** (impose PHP 7.4 aux marchands PS 1.7.8) |
| D3 | Versions PrestaShop supportées | **1.7.8.x et 8.x** (pas les 1.7.0→1.7.7, PHP trop ancien) |
| D4 | Stratégie de génération | Génération **à la création de la facture** + stockage fichier + table de suivi (pas de génération à la volée) |
| D5 | Nom technique du module | `facturxinvoice` |

Le détail et les alternatives de chaque décision suivent.

---

## 2. Compatibilité PHP / PrestaShop (vérifiée)

Grille officielle (source : documentation PrestaShop, dépôt `PrestaShop/docs`) :

| Version PrestaShop | PHP supporté | PHP recommandé |
|---|---|---|
| 1.7.7 | 7.1 → 7.3 | 7.3 |
| **1.7.8** | **7.1 → 7.4** | 7.4 |
| **8.0 → 8.2** | **7.2.5 → 8.1** | 8.1 |
| 9.x (hors périmètre, à garder en tête) | 8.1+ | — |

**Conséquence structurante (D2/D3)** : aucune bibliothèque Factur-X sérieuse ne supporte PHP < 7.3.
- `atgp/factur-x` exige PHP ≥ 7.4
- `horstoeko/zugferd` exige PHP ≥ 7.3
- `easybill/zugferd-php` v1 exige PHP ≥ 7.4

**Proposition** : le module exige **PHP 7.4 minimum**, ce qui couvre :
- PS 1.7.8.x sous PHP 7.4 (dernière version 1.7, la seule encore réaliste en production) ;
- PS 8.x sous PHP 7.4 → 8.1.

Les boutiques 1.7.0 → 1.7.7 (PHP ≤ 7.3) sont exclues. C'est une restriction de périmètre par rapport au brief (« 1.7.x »), mais l'alternative — réécrire un générateur XML maison compatible PHP 7.1 — est explicitement interdite par le brief. PHP 7.1/7.2/7.3 sont en fin de vie depuis 2021/2022 ; les hébergeurs français les ont massivement retirés. À valider.

---

## 3. Évaluation des bibliothèques (D1)

### 3.1 Fiches des candidates (données vérifiées sur Packagist)

| Bibliothèque | Dernière version | Date | PHP requis | Licence | Rôle | Dépendances notables |
|---|---|---|---|---|---|---|
| `atgp/factur-x` | v3.4.0 | **2026-07-06** | ≥ 7.4 | MIT | Incrustation XML dans PDF + conversion PDF/A-3, extraction, vérification | `setasign/fpdf`, `setasign/fpdi`, `smalot/pdfparser` |
| `easybill/zugferd-php` v1 | v1.13.1 | **2023-07-13 (branche gelée)** | 7.4 / 8.0 | MIT | Construction XML CII (objets → XML) | `jms/serializer` |
| `easybill/zugferd-php` v2+ | v6.0.0 | 2026-03 | **≥ 8.1 (v2) / ≥ 8.3 (v3+)** | MIT | idem | `jms/serializer` |
| `horstoeko/zugferd` | v1.0.123 | **2026-05-23** (140 releases, très actif) | ≥ 7.3 | MIT | Construction XML CII tous profils Factur-X (MINIMUM → EXTENDED, dont EN 16931), **validation XSD intégrée**, lecture, et aussi incrustation PDF | `jms/serializer`, `symfony/validator`, `symfony/yaml`, `setasign/fpdi`, `smalot/pdfparser` |
| `josemmo/einvoicing` | v0.3.1 | actif | ≥ 7.1 | MIT | EN 16931 mais **UBL uniquement** — l'export CII est sur la roadmap, non implémenté | `josemmo/uxml` (léger) |

**Élimination directe** :
- `josemmo/einvoicing` : ne produit pas de CII aujourd'hui, or Factur-X = CII embarqué dans PDF/A-3. Inutilisable pour la V1 (les formats UBL sont d'ailleurs hors périmètre V1).
- `easybill/zugferd-php` v2+ : PHP ≥ 8.1 incompatible avec PS 1.7.8 (PHP 7.4 max).

### 3.2 Options de combinaison

**Option A (recommandée) : `atgp/factur-x` + `horstoeko/zugferd`**
- `horstoeko/zugferd` construit le XML CII (profil EN 16931, BASIC en option — exactement les profils du brief) avec une API dédiée Factur-X, une validation XSD embarquée (pré-contrôle avant tes tests FNFE-MPE) et une communauté très active (c'est la lib PHP ZUGFeRD/Factur-X la plus utilisée).
- `atgp/factur-x` fait l'incrustation dans le PDF natif PrestaShop et la mise en conformité PDF/A-3 (son cœur de métier, première préférence du brief, mise à jour il y a 3 jours).
- Chaque lib est utilisée sur son point fort ; les deux sont MIT et maintenues en 2026 sur une plage PHP ≥ 7.4.
- Inconvénient : `horstoeko` tire `jms/serializer` + composants Symfony → **scoping des namespaces obligatoire** (voir §3.3). Poids vendor plus élevé.

**Option B (ordre strict du brief) : `atgp/factur-x` + `easybill/zugferd-php` ^1.13**
- Respecte l'ordre de préférence du brief à la lettre.
- Inconvénient majeur : la branche v1 est **gelée depuis juillet 2023** — tout le développement easybill se fait sur des branches PHP 8.1+/8.3+ que nous ne pouvons pas utiliser. Pour un module marketplace à maintenir plusieurs années (évolutions du standard Factur-X 1.0.7+, corrections des schémas), c'est un risque réel.
- Tire aussi `jms/serializer` → scoping obligatoire de toute façon.

**Option C : `horstoeko/zugferd` seul**
- Il sait aussi incruster le XML dans un PDF (classe `ZugferdDocumentPdfBuilder`) : une seule lib pour tout.
- Inconvénient : sa conversion PDF/A-3 est moins éprouvée que celle d'`atgp/factur-x` (dont c'est la spécialité et qui est la première préférence du brief). En cas de souci PDF/A on n'a pas de plan B intégré.

**Recommandation : Option A.** Elle respecte la première préférence du brief (atgp pour le PDF), et remplace easybill (branche morte pour notre plage PHP) par la lib CII la plus vivante de l'écosystème. L'option B reste faisable si tu tiens à l'ordre strict du brief — le code sera isolé derrière une interface `CiiBuilderInterface`, donc changer de moteur XML plus tard restera localisé.

### 3.3 Scoping des dépendances (obligatoire quelle que soit l'option)

`jms/serializer`, `symfony/*`, `setasign/fpdi` sont des dépendances très répandues : un autre module (ou le cœur PS 8, qui embarque Symfony) peut charger une autre version → conflits de classes fatals. Le brief l'anticipe.

**Proposition** : build des dépendances avec **`humbug/php-scoper`** — tous les namespaces vendor préfixés `FacturXInvoice\Vendor\`. Le build scopé est généré par un script (`composer build`) et versionné dans le zip du module ; le validator Addons reçoit un module autonome sans étape de build. Point d'attention connu : `jms/serializer` utilise des noms de classes dans des métadonnées — le scoping sera testé dès la Phase 1 (premier risque du projet, autant le lever tout de suite).

---

## 4. Architecture proposée

### 4.1 Principes

- **Découplage strict** : le cœur métier ne manipule jamais directement les objets PrestaShop ni les objets des libs. Un `InvoiceDataExtractor` transforme `OrderInvoice`/`OrderSlip` en DTO internes (`FacturXInvoiceData`), un `CiiBuilder` transforme ces DTO en XML, un `PdfEmbedder` produit le PDF/A-3. Permet : tests unitaires sans PrestaShop, changement de lib localisé, et V2 (transmission PDP) branchée sur les mêmes DTO.
- **Jamais bloquant** : toute la génération est enveloppée dans un try/catch global ; en cas d'échec → PDF natif inchangé + ligne d'erreur en base + alerte BO. Aucune exception ne remonte au workflow de commande.
- **Ouverture V2** : le module expose ses propres hooks (`actionFacturXGenerated`, `actionFacturXFailed`) et une interface `TransmitterInterface` vide en V1 — une V2 PDP s'y branchera sans toucher au cœur.

### 4.2 Structure du module (standard Addons)

```
facturxinvoice/
├── facturxinvoice.php              # Classe principale (hooks, install, upgrade)
├── composer.json                   # Dépendances (build scopé)
├── config.xml                      # Métadonnées module
├── logo.png
├── LICENSE.md                      # Licence AFL-3.0 (standard Addons) + licences MIT embarquées
├── controllers/
│   └── admin/                      # AdminFacturXDocumentsController (liste, régénération, download XML)
├── src/                            # Namespace FacturXInvoice\ (PSR-4)
│   ├── Builder/                    #   CiiBuilderInterface + HorstoekoCiiBuilder
│   ├── Pdf/                        #   PdfEmbedderInterface + AtgpPdfEmbedder
│   ├── Extractor/                  #   InvoiceDataExtractor (OrderInvoice/OrderSlip → DTO)
│   ├── Model/                      #   DTO : FacturXInvoiceData, PartyData, LineData, TaxBreakdown…
│   ├── Repository/                 #   FacturXDocumentRepository (table de suivi)
│   ├── Validator/                  #   SirenValidator, VatNumberValidator, pré-flight données
│   ├── Storage/                    #   Stockage des PDF/XML générés (var/ ou équivalent 1.7)
│   └── Exception/                  #   FacturXGenerationException…
├── vendor/                         # Dépendances scopées (préfixe FacturXInvoice\Vendor\)
├── sql/                            # install.php / uninstall.php
├── upgrade/                        # upgrade-x.y.z.php
├── views/
│   └── templates/admin/            # Écrans de configuration + liste
├── translations/                   # fr.php + en (défaut)
├── docs/                           # Doc marchand (Phase 5)
└── tests/                          # PHPUnit : Extractor, Builder, Validators (sans PS)
```
(+ `index.php` de protection dans chaque dossier — exigence validator Addons.)

### 4.3 Base de données

Une table de suivi `ps_facturx_document` :

| Colonne | Rôle |
|---|---|
| `id_facturx_document` | PK |
| `id_order_invoice` / `id_order_slip` | Facture ou avoir source (l'un des deux) |
| `document_type` | `invoice` / `credit_note` |
| `profile` | `EN16931` / `BASIC` |
| `status` | `generated` / `error` |
| `error_code`, `error_message` | Message actionnable (« SIREN client manquant sur l'adresse X »…) |
| `pdf_path`, `xml_checksum` | Fichier généré + intégrité |
| `date_add`, `date_upd` | Audit |

### 4.4 Points d'accroche PrestaShop (hooks candidats)

Stratégie retenue (D4) : **générer au moment où la facture est créée**, stocker le résultat, puis servir/attacher le fichier stocké. Avantages : la liste BO avec statuts et régénération tombe naturellement, le coût (< 2 s) n'est payé qu'une fois, et l'email client part avec le bon fichier.

Hooks candidats (à confirmer sur instance réelle en Phase 1 — c'est le premier livrable) :
- `actionValidateOrder` / `actionObjectOrderInvoiceAddAfter` : déclencheur de génération (facture) ;
- `actionObjectOrderSlipAddAfter` : déclencheur avoirs ;
- `actionEmailSendBefore` ou surcharge de la pièce jointe : mode « remplacer » le PDF envoyé ;
- contrôleur front `PdfInvoice` : servir le Factur-X dans l'espace client (mode remplacer) — mécanisme exact à valider en Phase 1, **sans override du core** si possible ;
- `displayAdminOrderTabLink` / `displayAdminOrderMain` (PS 8) et équivalents 1.7 : bloc Factur-X dans la fiche commande.

Le mode « accompagner » (PDF natif + Factur-X en second fichier) est plus simple et sûr que le mode « remplacer » ; les deux sont au brief, le mode remplacer portera le risque technique en Phase 1.

### 4.5 SIREN/SIRET client

PrestaShop offre nativement `Address::$siret` (`ps_address.siret`, présent en 1.7 et 8.x) et `Address::$vat_number`, ainsi que `company`. Proposition : **exploiter ces champs natifs** (pas de champ custom en V1), + validation de format côté module, + message d'erreur actionnable quand le SIREN manque pour un client B2B. Si un besoin de champ complémentaire apparaît en Phase 2, il sera ajouté par table du module, jamais par override du core.

---

## 5. Contraintes marketplace Addons (checklist de développement)

À appliquer dès la première ligne de code :
- Structure standard, `index.php` anti-listing dans **chaque** dossier, en-tête de licence dans chaque fichier PHP/TPL.
- Aucun override du core (le brief l'interdit sauf nécessité absolue ; l'architecture ci-dessus n'en prévoit aucun).
- SQL uniquement via `Db::getInstance()` + `pSQL()`/casts, préfixe `_DB_PREFIX_`.
- Traductions : FR + EN via `$this->l()` (1.7) / système de traduction moderne (8.x) — pas de chaîne en dur.
- Configuration via la classe `Configuration`, clés préfixées `FACTURXINVOICE_`.
- `upgrade/upgrade-x.y.z.php` dès la première release publiée.
- Compatibilité déclarée `ps_versions_compliancy` : min `1.7.8.0`, max `8.99.99`.
- Pas d'appel réseau sortant (V1 100 % locale — argument marketplace).
- Licences : module sous AFL-3.0 (standard Addons) ; libs embarquées toutes MIT ✔.
- Passage au validator (validator.prestashop.com) à chaque fin de phase, pas seulement en Phase 5.

---

## 6. Environnement Docker

Fichiers livrés dans `docker/` : deux boutiques avec données de démo + le module monté en volume.

| Service | Image (vérifiée sur Docker Hub) | URL locale |
|---|---|---|
| PS 8.x | `prestashop/prestashop:8.2.7-8.1-apache` (PHP 8.1) | http://localhost:8080 |
| PS 1.7 | `prestashop/prestashop:1.7.8.9-7.4-apache` (PHP 7.4) | http://localhost:8017 |
| MySQL ×2 | `mysql:8.0` / `mysql:5.7` | — |

Démarrage : `cd facturx-module/docker && docker compose up -d` (détails, identifiants et vérifications dans `docker/README.md`). Le dossier module `facturxinvoice/` (créé en Phase 1) sera monté dans `/var/www/html/modules/` des deux conteneurs.

---

## 7. Risques identifiés (par ordre de gravité)

1. **PDF natif PrestaShop (TCPDF) → PDF/A-3** : le PDF généré par PS n'est pas nativement PDF/A ; la conversion par `atgp/factur-x` (polices, transparences, images des thèmes) est LE risque conformité. Mitigation : c'est l'objet de la Phase 1, testé immédiatement sur FNFE-MPE + veraPDF par tes soins.
2. **Scoping `jms/serializer`** : testé dès la Phase 1 (voir §3.3).
3. **Mode « remplacer » le PDF sans override** : mécanisme exact à valider en Phase 1 ; repli assumé = mode « accompagner » par défaut.
4. **Écarts d'arrondis PS vs EN 16931** (BR-CO-* du validateur) : traité en Phase 2 avec les cas de test multi-TVA/remises.

---

## 8. Récap Phase 0 (méthode de travail)

**Fait** :
- Vérification des grilles PHP (PrestaShop) et des libs candidates (versions, dates, licences, dépendances) — sources : Packagist, GitHub PrestaShop/docs, Docker Hub.
- Ce document de propositions (D1–D5), l'architecture, la checklist Addons.
- Environnement Docker bi-version prêt à démarrer.

**Testable par toi** :
```bash
cd facturx-module/docker
docker compose up -d
# PS 8   : http://localhost:8080  (BO: /admin-dev — demo@prestashop.com / prestashop_demo)
# PS 1.7 : http://localhost:8017  (BO: /admin-dev — demo@prestashop.com / prestashop_demo)
```

**STOP — j'attends ta validation sur D1 à D5 avant la Phase 1.**
