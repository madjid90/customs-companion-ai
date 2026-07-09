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

/*
 * Générateur de facture Factur-X d'exemple, SANS PrestaShop.
 *
 * Exerce toute la chaîne du module (modèle interne → XML CII validé XSD →
 * PDF/A-3 avec XML embarqué) sur le cas de test « facture simple 1 ligne
 * TVA 20 % + frais de port » du brief.
 *
 * Usage : php tests/generate-sample.php
 * Sortie : tests/output/facturx-sample.pdf (+ .xml) à soumettre sur
 *          https://services.fnfe-mpe.org et à vérifier avec veraPDF.
 */

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use FacturXInvoice\Builder\CiiBuilderInterface;
use FacturXInvoice\Builder\HorstoekoCiiBuilder;
use FacturXInvoice\Model\ChargeData;
use FacturXInvoice\Model\FacturXDocumentData;
use FacturXInvoice\Model\LineData;
use FacturXInvoice\Model\PartyData;
use FacturXInvoice\Pdf\AtgpPdfEmbedder;
use FacturXInvoice\Model\TaxBreakdownData;
use FacturXInvoice\Service\FacturXGenerator;

// ---------------------------------------------------------------------------
// 1. Jeu de données : facture simple, 1 ligne TVA 20 %, frais de port
//    Identifiants fictifs mais aux clés de contrôle valides (Luhn / clé TVA).
// ---------------------------------------------------------------------------

$seller = new PartyData('Au Bon Moulin SAS');
$seller->siren = '900000001';
$seller->siret = '90000000100009';
$seller->vatNumber = 'FR68900000001';
$seller->addressLine1 = '12 rue de la Meunerie';
$seller->postCode = '75011';
$seller->city = 'Paris';
$seller->countryCode = 'FR';

$buyer = new PartyData('Acme Retail SARL');
$buyer->siren = '910000009';
$buyer->siret = '91000000900001';
$buyer->addressLine1 = '4 avenue des Clients';
$buyer->postCode = '69001';
$buyer->city = 'Lyon';
$buyer->countryCode = 'FR';

$invoice = new FacturXDocumentData('FA2026-0001', new DateTimeImmutable('2026-07-09'), $seller, $buyer);

$line = new LineData();
$line->id = '1';
$line->productName = 'Moulin à café mécanique';
$line->sellerAssignedId = 'DEMO-MOULIN-01';
$line->quantity = 2.0;
$line->unitPriceNet = 100.00;
$line->lineTotalNet = 200.00;
$line->vatRate = 20.0;
$invoice->lines[] = $line;

$invoice->charges[] = new ChargeData(true, 10.00, 20.0, 'Frais de port');

// Ventilation et totaux : 200,00 (lignes) + 10,00 (port) = 210,00 HT ; TVA 42,00
$invoice->taxBreakdowns[] = new TaxBreakdownData(20.0, 210.00, 42.00);
$invoice->lineTotal = 200.00;
$invoice->chargeTotal = 10.00;
$invoice->taxBasisTotal = 210.00;
$invoice->taxTotal = 42.00;
$invoice->grandTotal = 252.00;
$invoice->duePayable = 252.00;
$invoice->paymentTermsText = 'Payable à réception de la facture. Paiement : virement bancaire.';

// ---------------------------------------------------------------------------
// 2. PDF « natif » de démonstration (TCPDF en mode PDF/A-3, polices embarquées,
//    comme le moteur PDF de PrestaShop mais avec la conformité PDF/A activée)
// ---------------------------------------------------------------------------

$pdf = new TCPDF('P', 'mm', 'A4', true, 'UTF-8', false, 3 /* mode PDF/A-3 */);
$pdf->SetCreator('facturxinvoice sample');
$pdf->SetAuthor($seller->name);
$pdf->SetTitle('Facture ' . $invoice->number);
$pdf->setPrintHeader(false);
$pdf->setPrintFooter(false);
$pdf->AddPage();
$pdf->SetFont('dejavusans', 'B', 16);
$pdf->Cell(0, 10, 'FACTURE ' . $invoice->number, 0, 1);
$pdf->SetFont('dejavusans', '', 10);
$pdf->Cell(0, 6, $seller->name . ' — SIREN ' . $seller->siren . ' — TVA ' . $seller->vatNumber, 0, 1);
$pdf->Cell(0, 6, $seller->addressLine1 . ', ' . $seller->postCode . ' ' . $seller->city, 0, 1);
$pdf->Ln(4);
$pdf->Cell(0, 6, 'Client : ' . $buyer->name . ' — SIRET ' . $buyer->siret, 0, 1);
$pdf->Cell(0, 6, $buyer->addressLine1 . ', ' . $buyer->postCode . ' ' . $buyer->city, 0, 1);
$pdf->Ln(6);
$pdf->Cell(90, 7, 'Désignation', 1);
$pdf->Cell(20, 7, 'Qté', 1);
$pdf->Cell(25, 7, 'PU HT', 1);
$pdf->Cell(25, 7, 'Total HT', 1);
$pdf->Cell(20, 7, 'TVA', 1, 1);
$pdf->Cell(90, 7, $line->productName, 1);
$pdf->Cell(20, 7, '2', 1);
$pdf->Cell(25, 7, '100,00 €', 1);
$pdf->Cell(25, 7, '200,00 €', 1);
$pdf->Cell(20, 7, '20 %', 1, 1);
$pdf->Cell(90, 7, 'Frais de port', 1);
$pdf->Cell(20, 7, '', 1);
$pdf->Cell(25, 7, '', 1);
$pdf->Cell(25, 7, '10,00 €', 1);
$pdf->Cell(20, 7, '20 %', 1, 1);
$pdf->Ln(6);
$pdf->Cell(0, 6, 'Total HT : 210,00 €    TVA (20 %) : 42,00 €    Total TTC : 252,00 €', 0, 1);
$pdf->Cell(0, 6, $invoice->paymentTermsText, 0, 1);
$nativePdf = $pdf->Output('', 'S');

// ---------------------------------------------------------------------------
// 3. Chaîne Factur-X du module : XML CII validé XSD → incrustation PDF/A-3
// ---------------------------------------------------------------------------

$generator = new FacturXGenerator(
    new HorstoekoCiiBuilder(CiiBuilderInterface::PROFILE_EN16931),
    new AtgpPdfEmbedder()
);

$result = $generator->generate($invoice, $nativePdf);

// ---------------------------------------------------------------------------
// 4. Écriture des fichiers de sortie
// ---------------------------------------------------------------------------

$outputDir = __DIR__ . '/output';
if (!is_dir($outputDir)) {
    mkdir($outputDir, 0755, true);
}

file_put_contents($outputDir . '/facturx-sample.pdf', $result['pdf']);
file_put_contents($outputDir . '/facturx-sample.xml', $result['xml']);

echo "OK — génération réussie (XML validé contre les XSD Factur-X EN 16931)\n";
echo 'PDF : ' . $outputDir . '/facturx-sample.pdf (' . strlen($result['pdf']) . " octets)\n";
echo 'XML : ' . $outputDir . '/facturx-sample.xml (' . strlen($result['xml']) . " octets)\n";
echo "\nÀ tester (par le PO, cf. brief) :\n";
echo "  1. https://services.fnfe-mpe.org — validateur FNFE-MPE\n";
echo "  2. veraPDF — conformité PDF/A-3\n";
