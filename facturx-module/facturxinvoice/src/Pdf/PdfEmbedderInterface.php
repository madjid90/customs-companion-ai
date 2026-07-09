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

namespace FacturXInvoice\Pdf;

use FacturXInvoice\Exception\FacturXGenerationException;

/**
 * Incrustation du XML CII dans un PDF et mise en conformité PDF/A-3.
 *
 * Isole le module de la bibliothèque PDF utilisée (atgp/factur-x en V1).
 */
interface PdfEmbedderInterface
{
    /**
     * Produit le PDF Factur-X (PDF/A-3 + XML embarqué) à partir du PDF natif.
     *
     * @param string $nativePdfContent contenu binaire du PDF facture natif
     * @param string $xmlContent       XML CII déjà validé
     *
     * @return string contenu binaire du PDF Factur-X
     *
     * @throws FacturXGenerationException si l'incrustation échoue
     */
    public function embed(string $nativePdfContent, string $xmlContent): string;
}
