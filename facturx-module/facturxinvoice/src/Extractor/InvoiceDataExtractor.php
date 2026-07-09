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

namespace FacturXInvoice\Extractor;

use FacturXInvoice\Exception\FacturXGenerationException;
use FacturXInvoice\Model\ChargeData;
use FacturXInvoice\Model\FacturXDocumentData;
use FacturXInvoice\Model\LineData;
use FacturXInvoice\Model\PartyData;
use FacturXInvoice\Model\TaxBreakdownData;
use FacturXInvoice\Validator\SirenValidator;

/**
 * Transforme une facture PrestaShop (OrderInvoice) en modèle interne.
 *
 * Seule classe du cœur qui touche aux objets PrestaShop : elle n'est
 * instanciable que dans le contexte d'une boutique.
 *
 * Périmètre Phase 1 : facture de vente, lignes produits, frais de port,
 * ventilation multi-taux. Les avoirs, remises précises et paiements partiels
 * sont complétés en Phase 2.
 */
class InvoiceDataExtractor
{
    /**
     * @param \OrderInvoice $invoice facture native PrestaShop
     * @param \Order        $order   commande associée
     * @param PartyData     $seller  vendeur construit depuis la configuration du module
     *
     * @throws FacturXGenerationException si une donnée obligatoire est introuvable
     */
    public function extractFromOrderInvoice(\OrderInvoice $invoice, \Order $order, PartyData $seller): FacturXDocumentData
    {
        $issueDate = new \DateTimeImmutable($invoice->date_add ?: 'now');
        $number = $invoice->getInvoiceNumberFormatted((int) $order->id_lang, (int) $order->id_shop);

        $data = new FacturXDocumentData($number, $issueDate, $seller, $this->extractBuyer($order));
        $data->typeCode = FacturXDocumentData::TYPE_INVOICE;
        $data->currency = $this->extractCurrencyIso($order);

        $this->extractLines($data, $invoice, $order);
        $this->extractShipping($data, $invoice, $order);
        $this->extractTaxBreakdowns($data, $invoice, $order);
        $this->computeTotals($data, $invoice);

        // BR-CO-25 : un montant à payer positif exige une échéance ou des
        // conditions de paiement. PrestaShop ne stocke pas d'échéance : on
        // fournit des conditions en clair, complétées par le moyen de paiement.
        $data->paymentTermsText = $order->payment
            ? sprintf('Payable à réception de la facture. Paiement : %s.', $order->payment)
            : 'Payable à réception de la facture.';

        return $data;
    }

    /**
     * Acheteur : raison sociale et SIRET viennent de la fiche client
     * (mode B2B PrestaShop) et de l'adresse de facturation native.
     */
    private function extractBuyer(\Order $order): PartyData
    {
        $address = new \Address((int) $order->id_address_invoice);
        $customer = new \Customer((int) $order->id_customer);

        if (!\Validate::isLoadedObject($address)) {
            throw new FacturXGenerationException(
                FacturXGenerationException::CODE_MISSING_DATA,
                sprintf('Adresse de facturation introuvable pour la commande %s.', $order->reference)
            );
        }

        // Priorité à la société de l'adresse, puis à celle du client (B2B),
        // sinon nom de la personne physique (cas B2C).
        $name = trim((string) $address->company);
        if ('' === $name && \Validate::isLoadedObject($customer)) {
            $name = trim((string) $customer->company);
        }
        if ('' === $name) {
            $name = trim($address->firstname . ' ' . $address->lastname);
        }

        $buyer = new PartyData($name);
        $buyer->addressLine1 = (string) $address->address1;
        $buyer->addressLine2 = '' !== (string) $address->address2 ? (string) $address->address2 : null;
        $buyer->postCode = (string) $address->postcode;
        $buyer->city = (string) $address->city;
        $buyer->countryCode = \Country::getIsoById((int) $address->id_country) ?: 'FR';
        $buyer->vatNumber = '' !== (string) $address->vat_number ? (string) $address->vat_number : null;

        // SIRET client : champ natif de la fiche client en mode B2B.
        $siret = \Validate::isLoadedObject($customer) ? SirenValidator::normalize((string) $customer->siret) : '';
        if (SirenValidator::isValidSiret($siret)) {
            $buyer->siret = $siret;
            $buyer->siren = substr($siret, 0, 9);
        } elseif (SirenValidator::isValidSiren($siret)) {
            // Certains marchands saisissent un SIREN dans le champ SIRET.
            $buyer->siren = $siret;
        }

        return $buyer;
    }

    private function extractCurrencyIso(\Order $order): string
    {
        $currency = \Currency::getCurrencyInstance((int) $order->id_currency);

        return \Validate::isLoadedObject($currency) ? (string) $currency->iso_code : 'EUR';
    }

    private function extractLines(FacturXDocumentData $data, \OrderInvoice $invoice, \Order $order): void
    {
        $products = $invoice->getProducts();
        if ([] === $products || !is_array($products)) {
            throw new FacturXGenerationException(
                FacturXGenerationException::CODE_MISSING_DATA,
                sprintf('La facture %s ne contient aucun produit.', $data->number)
            );
        }

        $lineNumber = 0;
        foreach ($products as $row) {
            ++$lineNumber;

            $line = new LineData();
            $line->id = (string) $lineNumber;
            $line->productName = (string) $row['product_name'];
            $line->sellerAssignedId = '' !== (string) ($row['product_reference'] ?? '') ? (string) $row['product_reference'] : null;
            $line->quantity = (float) $row['product_quantity'];
            $line->unitPriceNet = (float) $row['unit_price_tax_excl'];
            $line->lineTotalNet = (float) $row['total_price_tax_excl'];
            $line->vatRate = $this->resolveLineVatRate($row);

            $data->lines[] = $line;
        }
    }

    /**
     * Taux de TVA d'une ligne : le champ tax_rate du détail de commande quand
     * il est renseigné, sinon recalcul depuis les prix TTC/HT.
     */
    private function resolveLineVatRate(array $row): float
    {
        if (isset($row['tax_rate']) && (float) $row['tax_rate'] > 0) {
            return round((float) $row['tax_rate'], 2);
        }

        $excl = (float) ($row['unit_price_tax_excl'] ?? 0);
        $incl = (float) ($row['unit_price_tax_incl'] ?? 0);
        if ($excl > 0 && $incl > $excl) {
            return round(($incl / $excl - 1) * 100, 2);
        }

        return 0.0;
    }

    /**
     * Frais de port : charge au niveau du document (BG-21), avec le taux issu
     * de la ventilation de TVA du transport.
     */
    private function extractShipping(FacturXDocumentData $data, \OrderInvoice $invoice, \Order $order): void
    {
        $shippingExcl = (float) $invoice->total_shipping_tax_excl;
        if ($shippingExcl <= 0) {
            return;
        }

        $rate = 0.0;
        $breakdown = $invoice->getShippingTaxesBreakdown($order);
        if (is_array($breakdown) && [] !== $breakdown) {
            $first = reset($breakdown);
            $rate = round((float) ($first['rate'] ?? 0), 2);
        }

        $data->charges[] = new ChargeData(true, round($shippingExcl, 2), $rate, 'Frais de port');
    }

    /**
     * Ventilation de TVA par taux (BG-23) : produits + transport agrégés.
     */
    private function extractTaxBreakdowns(FacturXDocumentData $data, \OrderInvoice $invoice, \Order $order): void
    {
        /** @var array<string, array{basis: float, amount: float}> $byRate */
        $byRate = [];

        $productBreakdown = $invoice->getProductTaxesBreakdown($order);
        if (is_array($productBreakdown)) {
            foreach ($productBreakdown as $rate => $amounts) {
                $key = number_format((float) $rate, 3, '.', '');
                $byRate[$key]['basis'] = ($byRate[$key]['basis'] ?? 0) + (float) ($amounts['total_price_tax_excl'] ?? 0);
                $byRate[$key]['amount'] = ($byRate[$key]['amount'] ?? 0) + (float) ($amounts['total_amount'] ?? 0);
            }
        }

        $shippingBreakdown = $invoice->getShippingTaxesBreakdown($order);
        if (is_array($shippingBreakdown)) {
            foreach ($shippingBreakdown as $shippingTax) {
                $key = number_format((float) ($shippingTax['rate'] ?? 0), 3, '.', '');
                $byRate[$key]['basis'] = ($byRate[$key]['basis'] ?? 0) + (float) ($shippingTax['total_tax_excl'] ?? 0);
                $byRate[$key]['amount'] = ($byRate[$key]['amount'] ?? 0) + (float) ($shippingTax['total_amount'] ?? 0);
            }
        }

        foreach ($byRate as $rate => $amounts) {
            $data->taxBreakdowns[] = new TaxBreakdownData(
                (float) $rate,
                round($amounts['basis'], 2),
                round($amounts['amount'], 2)
            );
        }

        // Sans ventilation exploitable, on reconstruit depuis les lignes
        // (cas limite de certaines versions/configurations).
        if ([] === $data->taxBreakdowns) {
            $fallback = [];
            foreach ($data->lines as $line) {
                $key = number_format($line->vatRate, 3, '.', '');
                $fallback[$key] = ($fallback[$key] ?? 0) + $line->lineTotalNet;
            }
            foreach ($data->charges as $charge) {
                $key = number_format($charge->vatRate, 3, '.', '');
                $sign = $charge->isCharge ? 1 : -1;
                $fallback[$key] = ($fallback[$key] ?? 0) + $sign * $charge->amount;
            }
            foreach ($fallback as $rate => $basis) {
                $data->taxBreakdowns[] = new TaxBreakdownData(
                    (float) $rate,
                    round($basis, 2),
                    round($basis * (float) $rate / 100, 2)
                );
            }
        }
    }

    /**
     * Totaux du document (BG-22) depuis les montants natifs de la facture.
     */
    private function computeTotals(FacturXDocumentData $data, \OrderInvoice $invoice): void
    {
        $lineTotal = 0.0;
        foreach ($data->lines as $line) {
            $lineTotal += $line->lineTotalNet;
        }

        $chargeTotal = 0.0;
        $allowanceTotal = 0.0;
        foreach ($data->charges as $charge) {
            if ($charge->isCharge) {
                $chargeTotal += $charge->amount;
            } else {
                $allowanceTotal += $charge->amount;
            }
        }

        $taxTotal = 0.0;
        foreach ($data->taxBreakdowns as $breakdown) {
            $taxTotal += $breakdown->taxAmount;
        }

        $data->lineTotal = round($lineTotal, 2);
        $data->chargeTotal = round($chargeTotal, 2);
        $data->allowanceTotal = round($allowanceTotal, 2);
        // BR-CO-13 : base d'imposition = lignes - remises + charges
        $data->taxBasisTotal = round($lineTotal - $allowanceTotal + $chargeTotal, 2);
        $data->taxTotal = round($taxTotal, 2);
        // BR-CO-15 : total TTC = base + TVA
        $data->grandTotal = round($data->taxBasisTotal + $data->taxTotal, 2);
        // Paiements partiels : traités en Phase 2, tout est dû en Phase 1.
        $data->prepaidAmount = 0.0;
        $data->duePayable = $data->grandTotal;
    }
}
