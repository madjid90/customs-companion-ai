# Module PrestaShop Factur-X — espace de travail

Développement du module PrestaShop « Factur-X / Facturation électronique conforme » (voir [BRIEF.md](BRIEF.md)).

## État d'avancement

| Phase | Contenu | Statut |
|---|---|---|
| 0 | Environnement Docker, choix des libs, architecture, contraintes Addons | ✅ Propositions livrées — **en attente de validation PO** |
| 1 | Première facture Factur-X depuis une commande de démo | ⏳ |
| 2 | Mapping complet EN 16931 + cas de test | ⏳ |
| 3 | Back-office (config, liste, régénération, logs) | ⏳ |
| 4 | Robustesse, compatibilité 1.7/8.x, performance | ⏳ |
| 5 | Préparation soumission Addons | ⏳ |

## Contenu

- [BRIEF.md](BRIEF.md) — le brief produit (référence)
- [docs/phase-0-propositions.md](docs/phase-0-propositions.md) — propositions Phase 0 (libs, architecture, décisions D1–D5 à valider)
- [docker/](docker/) — environnement de dev bi-version (PS 8.2 / PHP 8.1 et PS 1.7.8 / PHP 7.4)
- `facturxinvoice/` — le module lui-même (créé en Phase 1, après validation)
