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

namespace FacturXInvoice\Service;

use FacturXInvoice\Builder\CiiBuilderInterface;
use FacturXInvoice\Exception\FacturXGenerationException;
use FacturXInvoice\Model\FacturXDocumentData;
use FacturXInvoice\Pdf\PdfEmbedderInterface;

/**
 * Chaîne de génération Factur-X, indépendante de PrestaShop :
 * modèle interne → XML CII validé → PDF/A-3 avec XML embarqué.
 *
 * Testable sans boutique (voir tests/generate-sample.php).
 */
class FacturXGenerator
{
    /** @var CiiBuilderInterface */
    private $ciiBuilder;

    /** @var PdfEmbedderInterface */
    private $pdfEmbedder;

    public function __construct(CiiBuilderInterface $ciiBuilder, PdfEmbedderInterface $pdfEmbedder)
    {
        $this->ciiBuilder = $ciiBuilder;
        $this->pdfEmbedder = $pdfEmbedder;
    }

    /**
     * Résultat : ['pdf' => contenu binaire PDF Factur-X, 'xml' => XML CII].
     *
     * @param FacturXDocumentData $data      document à générer
     * @param string              $nativePdf contenu binaire du PDF facture natif
     *
     * @return array{pdf: string, xml: string}
     *
     * @throws FacturXGenerationException
     */
    public function generate(FacturXDocumentData $data, string $nativePdf): array
    {
        $xml = $this->ciiBuilder->build($data);
        $pdf = $this->pdfEmbedder->embed($nativePdf, $xml);

        return ['pdf' => $pdf, 'xml' => $xml];
    }
}
