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

use Atgp\FacturX\Writer;
use FacturXInvoice\Exception\FacturXGenerationException;

/**
 * Implémentation de l'incrustation basée sur atgp/factur-x.
 *
 * Le profil est auto-détecté par la bibliothèque depuis le XML ; la validation
 * XSD est désactivée ici car elle a déjà été faite par le builder CII.
 */
class AtgpPdfEmbedder implements PdfEmbedderInterface
{
    public function embed(string $nativePdfContent, string $xmlContent): string
    {
        try {
            // importExternalLinks=false : évite de dépendre de ressources externes
            // du PDF natif, non pertinentes pour une facture et risquées en PDF/A.
            $writer = new Writer(false);

            return $writer->generate(
                $nativePdfContent,
                $xmlContent,
                null,   // profil auto-détecté depuis le XML
                false   // XSD déjà validé en amont par le builder
            );
        } catch (\Throwable $e) {
            throw new FacturXGenerationException(
                FacturXGenerationException::CODE_PDF_EMBED_FAILED,
                'Échec de l\'incrustation du XML dans le PDF : ' . $e->getMessage(),
                $e
            );
        }
    }
}
