# Module PrestaShop Factur-X — espace de travail

Développement du module PrestaShop « Factur-X / Facturation électronique conforme » (voir [BRIEF.md](BRIEF.md)).

## État d'avancement

| Phase | Contenu | Statut |
|---|---|---|
| 0 | Environnement Docker, choix des libs, architecture, contraintes Addons | ✅ Validée (D1–D5) |
| 1 | Première facture Factur-X depuis une commande de démo | ✅ Livrée — **en attente des tests de conformité PO (FNFE-MPE, veraPDF)** |
| 2 | Mapping complet EN 16931 + cas de test | ⏳ |
| 3 | Back-office (config, liste, régénération, logs) | ⏳ |
| 4 | Robustesse, compatibilité 1.7/8.x, performance | ⏳ |
| 5 | Préparation soumission Addons | ⏳ |

## Contenu

- [BRIEF.md](BRIEF.md) — le brief produit (référence)
- [docs/phase-0-propositions.md](docs/phase-0-propositions.md) — propositions Phase 0 (libs, architecture, décisions D1–D5 à valider)
- [docker/](docker/) — environnement de dev bi-version (PS 8.2 / PHP 8.1 et PS 1.7.8 / PHP 7.4)
- [facturxinvoice/](facturxinvoice/) — le module PrestaShop lui-même

## Tester la Phase 1 (sans boutique)

```bash
cd facturx-module/facturxinvoice
composer install
php tests/generate-sample.php
# → tests/output/facturx-sample.pdf à soumettre sur https://services.fnfe-mpe.org
#   et à vérifier avec veraPDF (PDF/A-3)
```

## Tester sur boutique (Docker)

```bash
cd facturx-module/docker && docker compose up -d
# Installer le module depuis le back-office (Modules > facturxinvoice),
# renseigner la configuration (SIREN, TVA...), puis créer une commande
# et générer sa facture : le Factur-X est écrit dans var/facturxinvoice/
# et tracé dans la table ps_facturx_document.
```

