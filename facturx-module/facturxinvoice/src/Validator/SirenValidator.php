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

namespace FacturXInvoice\Validator;

/**
 * Validation de format des identifiants SIREN (9 chiffres) et SIRET (14 chiffres),
 * clé de Luhn comprise.
 */
class SirenValidator
{
    /**
     * Nettoie un identifiant saisi (espaces, points, tirets).
     */
    public static function normalize(string $value): string
    {
        return (string) preg_replace('/[\s.\-]/', '', $value);
    }

    public static function isValidSiren(string $siren): bool
    {
        $siren = self::normalize($siren);

        return 1 === preg_match('/^\d{9}$/', $siren) && self::passesLuhn($siren);
    }

    public static function isValidSiret(string $siret): bool
    {
        $siret = self::normalize($siret);

        if (1 !== preg_match('/^\d{14}$/', $siret)) {
            return false;
        }

        // Cas particulier : les établissements de La Poste (SIREN 356000000)
        // utilisent une somme simple multiple de 5 au lieu de Luhn.
        if (0 === strpos($siret, '356000000')) {
            return 0 === array_sum(array_map('intval', str_split($siret))) % 5;
        }

        return self::passesLuhn($siret);
    }

    /**
     * Algorithme de Luhn (utilisé par SIREN et SIRET).
     */
    private static function passesLuhn(string $digits): bool
    {
        $sum = 0;
        $length = strlen($digits);

        for ($i = 0; $i < $length; ++$i) {
            // En partant de la droite, on double un chiffre sur deux (positions paires)
            $digit = (int) $digits[$length - 1 - $i];
            if (1 === $i % 2) {
                $digit *= 2;
                if ($digit > 9) {
                    $digit -= 9;
                }
            }
            $sum += $digit;
        }

        return 0 === $sum % 10;
    }
}
