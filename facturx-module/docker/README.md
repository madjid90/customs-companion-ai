# Environnement Docker — module Factur-X

Deux boutiques PrestaShop avec données de démo, pour tester le module sur les deux branches supportées.

## Démarrage

```bash
cd facturx-module/docker
docker compose up -d
```

Le premier démarrage installe automatiquement les deux boutiques (compter 2 à 5 minutes).
Suivre l'installation : `docker compose logs -f ps8 ps17`

## Accès

| Boutique | Front-office | Back-office | PHP |
|---|---|---|---|
| PrestaShop 8.2 | http://localhost:8080 | http://localhost:8080/admin-dev | 8.1 |
| PrestaShop 1.7.8 | http://localhost:8017 | http://localhost:8017/admin-dev | 7.4 |

Identifiants back-office (les deux boutiques) : `demo@prestashop.com` / `prestashop_demo`

## Module

Le dossier `../facturxinvoice` (créé en Phase 1) est monté dans `/var/www/html/modules/facturxinvoice`
des deux conteneurs : toute modification du code est visible immédiatement, l'installation du module
se fait depuis le back-office ou en CLI :

```bash
docker compose exec ps8 php bin/console prestashop:module install facturxinvoice
```

(PS 1.7.8 n'a pas la commande console pour les modules : passer par le back-office.)

## Remise à zéro

```bash
docker compose down -v   # supprime aussi les bases et les fichiers PrestaShop
docker compose up -d
```
