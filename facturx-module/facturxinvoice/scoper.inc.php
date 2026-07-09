<?php
/**
 * Copyright since 2026 FacturXInvoice
 *
 * NOTICE OF LICENSE
 *
 * This source file is subject to the Academic Free License version 3.0
 * that is bundled with this package in the file LICENSE.md.
 * It is also available through the world-wide-web at this URL:
 * https://opensource.org/licenses/AFL-3.0
 *
 * @author    FacturXInvoice
 * @copyright Since 2026 FacturXInvoice
 * @license   https://opensource.org/licenses/AFL-3.0 Academic Free License version 3.0
 */

declare(strict_types=1);

use Isolated\Symfony\Component\Finder\Finder;

/*
 * Configuration php-scoper : préfixe tous les namespaces des dépendances
 * embarquées (vendor/) en FacturXInvoice\Vendor\* pour éviter tout conflit
 * de classes avec le cœur PrestaShop ou d'autres modules.
 *
 * Le namespace du module lui-même (FacturXInvoice\) et les classes globales
 * (TCPDF de dev, FPDF...) sont préservés.
 *
 * Usage (voir build.sh) :
 *   php-scoper add-prefix --output-dir=<dossier de build> --force
 */
return [
    'prefix' => 'FacturXInvoice\\Vendor',

    // Le code du module garde son namespace : seules ses références aux
    // classes vendor sont réécrites.
    'exclude-namespaces' => [
        'FacturXInvoice',
        // Composer runtime : doit rester intact pour l'autoload.
        'Composer',
    ],

    // Les classes/fonctions/constantes globales restent globales
    // (FPDF, TCPDF, fonctions PHP...).
    'expose-global-constants' => true,
    'expose-global-classes' => true,
    'expose-global-functions' => true,

    // horstoeko/zugferd construit des noms de classes d'entités par
    // concaténation de chaînes ('horstoeko\zugferd\entities\...') que
    // php-scoper ne réécrit pas : on préfixe ces chaînes explicitement.
    'patchers' => [
        static function (string $filePath, string $prefix, string $contents): string {
            if (false === strpos($filePath, 'horstoeko/zugferd/src/')) {
                return $contents;
            }

            // 1. Les bases de namespace complètes doivent être préfixées.
            $contents = str_replace(
                "'horstoeko\\zugferd\\entities",
                "'" . $prefix . "\\horstoeko\\zugferd\\entities",
                $contents
            );

            // 2. À l'inverse, php-scoper préfixe à tort les chemins d'entités
            //    RELATIFS ('rsm\...', 'ram\...') passés à createClassInstance(),
            //    qui sont concaténés à la base au point 1 : on les rétablit.
            foreach (['rsm', 'ram', 'udt', 'qdt'] as $entityNs) {
                $contents = str_replace(
                    "'" . $prefix . "\\" . $entityNs . "\\",
                    "'" . $entityNs . "\\",
                    $contents
                );
            }

            return $contents;
        },
    ],

    'finders' => [
        // Code du module (références vendor à réécrire)
        Finder::create()->files()->in(__DIR__ . '/src')->name('*.php'),
        Finder::create()->files()->in(__DIR__ . '/tests')->name('*.php')->exclude('output'),
        // Dépendances à préfixer (fichiers non-PHP inclus : XSD, YAML…)
        Finder::create()->files()->in(__DIR__ . '/vendor'),
        // Fichiers racine nécessaires au build
        Finder::create()->files()->depth(0)->in(__DIR__)->name(['composer.json']),
    ],
];
