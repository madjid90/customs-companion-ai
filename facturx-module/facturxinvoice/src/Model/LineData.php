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
 * Ligne de facture (groupe BG-25 de l'EN 16931), indépendante de PrestaShop.
 *
 * Tous les montants sont hors taxe, arrondis à 2 décimales.
 */
class LineData
{
    /** @var string Identifiant de ligne (BT-126) */
    public $id;

    /** @var string Nom de l'article (BT-153) */
    public $productName;

    /** @var string|null Référence article du vendeur (BT-155) */
    public $sellerAssignedId;

    /** @var float Quantité facturée (BT-129) */
    public $quantity;

    /**
     * @var string Code d'unité UN/ECE Rec 20 (BT-130).
     *             H87 = pièce, C62 = unité (défaut PrestaShop : la pièce).
     */
    public $unitCode = 'H87';

    /** @var float Prix unitaire net HT (BT-146) */
    public $unitPriceNet;

    /** @var float Montant net HT de la ligne (BT-131) */
    public $lineTotalNet;

    /** @var float Taux de TVA de la ligne en pourcentage (BT-152) */
    public $vatRate;

    /**
     * @var string Catégorie de TVA UNTDID 5305 (BT-151).
     *             S = taux standard. Les autres catégories (exonération…) arrivent en Phase 2.
     */
    public $vatCategoryCode = 'S';
}
