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
 * Ventilation de TVA par taux (groupe BG-23 de l'EN 16931).
 */
class TaxBreakdownData
{
    /** @var string Catégorie de TVA UNTDID 5305 (BT-118) — S = taux standard */
    public $categoryCode = 'S';

    /** @var float Taux de TVA en pourcentage (BT-119) */
    public $rate;

    /** @var float Base d'imposition HT (BT-116) */
    public $basisAmount;

    /** @var float Montant de TVA (BT-117) */
    public $taxAmount;

    public function __construct(float $rate, float $basisAmount, float $taxAmount, string $categoryCode = 'S')
    {
        $this->rate = $rate;
        $this->basisAmount = $basisAmount;
        $this->taxAmount = $taxAmount;
        $this->categoryCode = $categoryCode;
    }
}
