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

namespace FacturXInvoice\Model;

/**
 * Partie de la transaction (vendeur ou acheteur), indépendante de PrestaShop.
 *
 * Correspond aux groupes BG-4 (vendeur) et BG-7 (acheteur) de l'EN 16931.
 */
class PartyData
{
    /** @var string Raison sociale (BT-27 / BT-44) */
    public $name;

    /** @var string|null SIREN — identifiant légal, schéma 0002 (BT-30 / BT-47) */
    public $siren;

    /** @var string|null SIRET — identifiant global, schéma 0009 (BT-29 / BT-46) */
    public $siret;

    /** @var string|null Numéro de TVA intracommunautaire (BT-31 / BT-48) */
    public $vatNumber;

    /** @var string|null Adresse ligne 1 (BT-35 / BT-50) */
    public $addressLine1;

    /** @var string|null Adresse ligne 2 (BT-36 / BT-51) */
    public $addressLine2;

    /** @var string|null Code postal (BT-38 / BT-53) */
    public $postCode;

    /** @var string|null Ville (BT-37 / BT-52) */
    public $city;

    /** @var string Code pays ISO 3166-1 alpha-2 (BT-40 / BT-55) */
    public $countryCode = 'FR';

    public function __construct(string $name)
    {
        $this->name = $name;
    }
}
