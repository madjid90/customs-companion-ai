#!/usr/bin/env bash
#
# Build du module pour distribution (PrestaShop Addons) :
# dépendances vendor/ préfixées FacturXInvoice\Vendor\ via php-scoper
# pour éviter tout conflit de classes avec le cœur ou d'autres modules.
#
# Prérequis : composer, php-scoper (composer global require humbug/php-scoper)
# Usage     : ./build.sh [dossier-de-sortie]   (défaut : ../build/facturxinvoice)

set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${1:-$MODULE_DIR/../build/facturxinvoice}"
PHP_SCOPER="${PHP_SCOPER:-$(command -v php-scoper || echo "$HOME/.config/composer/vendor/bin/php-scoper")}"

echo "== 1/4 Installation des dépendances de production =="
composer install --no-dev --optimize-autoloader --working-dir="$MODULE_DIR"

echo "== 2/4 Préfixage des namespaces (php-scoper) =="
rm -rf "$OUTPUT_DIR"
(cd "$MODULE_DIR" && "$PHP_SCOPER" add-prefix --output-dir="$OUTPUT_DIR" --force --no-interaction)

echo "== 3/4 Copie des fichiers non scopés du module =="
# php-scoper ne traite que src/, tests/ et vendor/ (cf. scoper.inc.php) :
# on complète avec les fichiers PrestaShop du module.
cp "$MODULE_DIR"/facturxinvoice.php "$MODULE_DIR"/config.xml "$MODULE_DIR"/logo.png \
   "$MODULE_DIR"/LICENSE.md "$MODULE_DIR"/index.php "$OUTPUT_DIR"/
cp -r "$MODULE_DIR"/sql "$MODULE_DIR"/translations "$OUTPUT_DIR"/
rm -rf "$OUTPUT_DIR"/tests "$OUTPUT_DIR"/scoper.inc.php

echo "== 4/4 Autoloader optimisé =="
composer dump-autoload --classmap-authoritative --working-dir="$OUTPUT_DIR"

# On réinstalle les dépendances de dev pour le poste de travail
composer install --working-dir="$MODULE_DIR" --quiet

echo
echo "Build scopé prêt : $OUTPUT_DIR"
echo "Zip Addons : (cd $(dirname "$OUTPUT_DIR") && zip -r facturxinvoice.zip facturxinvoice)"
