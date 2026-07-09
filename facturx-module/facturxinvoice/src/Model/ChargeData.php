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
 * Charge ou remise au niveau du document (groupes BG-20 / BG-21 de l'EN 16931).
 *
 * Utilisé en V1 pour les frais de port (charge) et les remises globales (allowance).
 */
class ChargeData
{
    /** @var bool true = charge (frais), false = remise */
    public $isCharge;

    /** @var float Montant HT, positif (BT-92 / BT-99) */
    public $amount;

    /** @var float Taux de TVA appliqué (BT-96 / BT-103) */
    public $vatRate;

    /** @var string Catégorie de TVA UNTDID 5305 (BT-95 / BT-102) */
    public $vatCategoryCode = 'S';

    /** @var string|null Motif lisible (BT-97 / BT-104) — ex. « Frais de port » */
    public $reason;

    public function __construct(bool $isCharge, float $amount, float $vatRate, ?string $reason = null)
    {
        $this->isCharge = $isCharge;
        $this->amount = $amount;
        $this->vatRate = $vatRate;
        $this->reason = $reason;
    }
}
