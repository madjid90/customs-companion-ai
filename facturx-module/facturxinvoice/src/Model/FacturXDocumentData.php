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

use DateTimeImmutable;

/**
 * Représentation interne complète d'une facture ou d'un avoir, indépendante
 * de PrestaShop et des bibliothèques de génération.
 *
 * C'est le pivot de l'architecture : l'extracteur PrestaShop produit cet objet,
 * le builder CII et (en V2) la transmission PDP le consomment.
 */
class FacturXDocumentData
{
    /** Facture commerciale (UNTDID 1001) */
    public const TYPE_INVOICE = '380';

    /** Avoir (UNTDID 1001) */
    public const TYPE_CREDIT_NOTE = '381';

    /** @var string Code type de document — TYPE_INVOICE ou TYPE_CREDIT_NOTE (BT-3) */
    public $typeCode = self::TYPE_INVOICE;

    /** @var string Numéro de facture (BT-1) */
    public $number;

    /** @var DateTimeImmutable Date d'émission (BT-2) */
    public $issueDate;

    /** @var string Devise ISO 4217 (BT-5) */
    public $currency = 'EUR';

    /** @var PartyData Vendeur (BG-4) */
    public $seller;

    /** @var PartyData Acheteur (BG-7) */
    public $buyer;

    /** @var string|null Référence acheteur (BT-10), utile en B2B */
    public $buyerReference;

    /** @var LineData[] Lignes de facture (BG-25) */
    public $lines = [];

    /** @var ChargeData[] Charges et remises au niveau document (BG-20/BG-21) */
    public $charges = [];

    /** @var TaxBreakdownData[] Ventilation de TVA par taux (BG-23) */
    public $taxBreakdowns = [];

    /** @var float Somme des montants nets de lignes (BT-106) */
    public $lineTotal = 0.0;

    /** @var float Somme des remises document (BT-107) */
    public $allowanceTotal = 0.0;

    /** @var float Somme des charges document (BT-108) */
    public $chargeTotal = 0.0;

    /** @var float Total HT — base d'imposition (BT-109) */
    public $taxBasisTotal = 0.0;

    /** @var float Total TVA (BT-110) */
    public $taxTotal = 0.0;

    /** @var float Total TTC (BT-112) */
    public $grandTotal = 0.0;

    /** @var float Montant déjà payé (BT-113) — paiements partiels */
    public $prepaidAmount = 0.0;

    /** @var float Net à payer (BT-115) */
    public $duePayable = 0.0;

    /** @var string|null Conditions de paiement en clair (BT-20) */
    public $paymentTermsText;

    /** @var DateTimeImmutable|null Date d'échéance (BT-9) */
    public $dueDate;

    public function __construct(string $number, DateTimeImmutable $issueDate, PartyData $seller, PartyData $buyer)
    {
        $this->number = $number;
        $this->issueDate = $issueDate;
        $this->seller = $seller;
        $this->buyer = $buyer;
    }
}
