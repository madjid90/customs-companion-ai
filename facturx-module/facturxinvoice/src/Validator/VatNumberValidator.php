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
 * Validation de format du numéro de TVA intracommunautaire.
 *
 * Contrôle strict pour la France (clé de contrôle vérifiée contre le SIREN),
 * contrôle de forme générique pour les autres pays de l'UE.
 */
class VatNumberValidator
{
    public static function normalize(string $value): string
    {
        return strtoupper((string) preg_replace('/[\s.\-]/', '', $value));
    }

    public static function isValid(string $vatNumber): bool
    {
        $vatNumber = self::normalize($vatNumber);

        if (0 === strpos($vatNumber, 'FR')) {
            return self::isValidFrench($vatNumber);
        }

        // Forme générique UE : 2 lettres pays + 2 à 12 caractères alphanumériques
        return 1 === preg_match('/^[A-Z]{2}[0-9A-Z]{2,12}$/', $vatNumber);
    }

    /**
     * FR + clé (2 caractères) + SIREN (9 chiffres).
     * La clé numérique se vérifie par : clé = (12 + 3 × (SIREN mod 97)) mod 97.
     */
    public static function isValidFrench(string $vatNumber): bool
    {
        $vatNumber = self::normalize($vatNumber);

        if (1 !== preg_match('/^FR([0-9A-Z]{2})(\d{9})$/', $vatNumber, $matches)) {
            return false;
        }

        $key = $matches[1];
        $siren = $matches[2];

        if (!SirenValidator::isValidSiren($siren)) {
            return false;
        }

        // Clé alphanumérique (rare) : on se contente du contrôle de forme.
        if (!ctype_digit($key)) {
            return true;
        }

        return (int) $key === (12 + 3 * ((int) $siren % 97)) % 97;
    }
}
