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

namespace FacturXInvoice\Builder;

use FacturXInvoice\Exception\FacturXGenerationException;
use FacturXInvoice\Model\FacturXDocumentData;
use FacturXInvoice\Model\PartyData;
use horstoeko\zugferd\ZugferdDocumentBuilder;
use horstoeko\zugferd\ZugferdProfiles;
use horstoeko\zugferd\ZugferdXsdValidator;

/**
 * Implémentation du builder CII basée sur horstoeko/zugferd.
 *
 * Schémas d'identification utilisés (ISO 6523) :
 * - 0002 : SIREN (identifiant légal, BT-30/BT-47)
 * - 0009 : SIRET (identifiant global, BT-29/BT-46)
 */
class HorstoekoCiiBuilder implements CiiBuilderInterface
{
    private const SCHEME_SIREN = '0002';
    private const SCHEME_SIRET = '0009';

    /** @var int Profil horstoeko (ZugferdProfiles::PROFILE_*) */
    private $profile;

    public function __construct(string $profile = self::PROFILE_EN16931)
    {
        // Seuls les deux profils du brief sont exposés ; EN 16931 par défaut.
        $this->profile = (self::PROFILE_BASIC === $profile)
            ? ZugferdProfiles::PROFILE_BASIC
            : ZugferdProfiles::PROFILE_EN16931;
    }

    public function build(FacturXDocumentData $data): string
    {
        $this->assertRequiredData($data);

        $builder = ZugferdDocumentBuilder::createNew($this->profile);

        // En-tête du document (BT-1, BT-3, BT-2, BT-5)
        $builder->setDocumentInformation(
            $data->number,
            $data->typeCode,
            $data->issueDate,
            $data->currency
        );

        if (null !== $data->buyerReference && '' !== $data->buyerReference) {
            $builder->setDocumentBuyerReference($data->buyerReference);
        }

        $this->buildSeller($builder, $data->seller);
        $this->buildBuyer($builder, $data->buyer);
        $this->buildLines($builder, $data);
        $this->buildChargesAndAllowances($builder, $data);
        $this->buildTaxBreakdowns($builder, $data);
        $this->buildPaymentTerms($builder, $data);
        $this->buildSummation($builder, $data);

        $this->assertXsdValid($builder, $data);

        return $builder->getContent();
    }

    /**
     * Contrôles bloquants avant construction : mieux vaut un message actionnable
     * qu'une erreur XSD cryptique.
     */
    private function assertRequiredData(FacturXDocumentData $data): void
    {
        if ('' === trim($data->seller->name)) {
            throw new FacturXGenerationException(
                FacturXGenerationException::CODE_SELLER_CONFIG_MISSING,
                'La raison sociale du vendeur est manquante : renseignez la configuration du module.'
            );
        }

        if (empty($data->seller->vatNumber) && empty($data->seller->siren)) {
            throw new FacturXGenerationException(
                FacturXGenerationException::CODE_SELLER_CONFIG_MISSING,
                'Le SIREN ou le numéro de TVA intracommunautaire du vendeur est manquant : renseignez la configuration du module.'
            );
        }

        if ('' === trim($data->buyer->name)) {
            throw new FacturXGenerationException(
                FacturXGenerationException::CODE_MISSING_DATA,
                'Le nom de l\'acheteur est manquant sur la commande.'
            );
        }

        if ([] === $data->lines) {
            throw new FacturXGenerationException(
                FacturXGenerationException::CODE_MISSING_DATA,
                'Le document ne contient aucune ligne.'
            );
        }
    }

    private function buildSeller(ZugferdDocumentBuilder $builder, PartyData $seller): void
    {
        $builder->setDocumentSeller($seller->name);

        if (!empty($seller->siret)) {
            $builder->addDocumentSellerGlobalId($seller->siret, self::SCHEME_SIRET);
        }
        if (!empty($seller->siren)) {
            // Identifiant légal (BT-30) avec schéma SIREN, raison sociale en clair
            $builder->setDocumentSellerLegalOrganisation($seller->siren, self::SCHEME_SIREN, $seller->name);
        }
        if (!empty($seller->vatNumber)) {
            $builder->addDocumentSellerTaxRegistration('VA', $seller->vatNumber);
        }

        $builder->setDocumentSellerAddress(
            $seller->addressLine1,
            $seller->addressLine2,
            null,
            $seller->postCode,
            $seller->city,
            $seller->countryCode
        );
    }

    private function buildBuyer(ZugferdDocumentBuilder $builder, PartyData $buyer): void
    {
        $builder->setDocumentBuyer($buyer->name);

        if (!empty($buyer->siret)) {
            $builder->addDocumentBuyerGlobalId($buyer->siret, self::SCHEME_SIRET);
        }
        if (!empty($buyer->siren)) {
            $builder->setDocumentBuyerLegalOrganisation($buyer->siren, self::SCHEME_SIREN, $buyer->name);
        }

        $builder->setDocumentBuyerAddress(
            $buyer->addressLine1,
            $buyer->addressLine2,
            null,
            $buyer->postCode,
            $buyer->city,
            $buyer->countryCode
        );
    }

    private function buildLines(ZugferdDocumentBuilder $builder, FacturXDocumentData $data): void
    {
        foreach ($data->lines as $line) {
            $builder->addNewPosition($line->id);
            $builder->setDocumentPositionProductDetails(
                $line->productName,
                null,
                $line->sellerAssignedId
            );
            $builder->setDocumentPositionNetPrice(round($line->unitPriceNet, 2));
            $builder->setDocumentPositionQuantity($line->quantity, $line->unitCode);
            $builder->addDocumentPositionTax($line->vatCategoryCode, 'VAT', $line->vatRate);
            $builder->setDocumentPositionLineSummation(round($line->lineTotalNet, 2));
        }
    }

    private function buildChargesAndAllowances(ZugferdDocumentBuilder $builder, FacturXDocumentData $data): void
    {
        foreach ($data->charges as $charge) {
            $builder->addDocumentAllowanceCharge(
                round($charge->amount, 2),
                $charge->isCharge,
                $charge->vatCategoryCode,
                'VAT',
                $charge->vatRate,
                null,
                null,
                null,
                null,
                null,
                null,
                $charge->reason
            );
        }
    }

    private function buildTaxBreakdowns(ZugferdDocumentBuilder $builder, FacturXDocumentData $data): void
    {
        foreach ($data->taxBreakdowns as $breakdown) {
            $builder->addDocumentTax(
                $breakdown->categoryCode,
                'VAT',
                round($breakdown->basisAmount, 2),
                round($breakdown->taxAmount, 2),
                $breakdown->rate
            );
        }
    }

    private function buildPaymentTerms(ZugferdDocumentBuilder $builder, FacturXDocumentData $data): void
    {
        if (null !== $data->paymentTermsText || null !== $data->dueDate) {
            $builder->addDocumentPaymentTerm($data->paymentTermsText, $data->dueDate);
        }
    }

    private function buildSummation(ZugferdDocumentBuilder $builder, FacturXDocumentData $data): void
    {
        // Totaux (BG-22) — l'ordre des arguments suit l'API horstoeko.
        $builder->setDocumentSummation(
            round($data->grandTotal, 2),
            round($data->duePayable, 2),
            round($data->lineTotal, 2),
            round($data->chargeTotal, 2),
            round($data->allowanceTotal, 2),
            round($data->taxBasisTotal, 2),
            round($data->taxTotal, 2),
            null,
            round($data->prepaidAmount, 2)
        );
    }

    /**
     * Validation XSD systématique avant incrustation : on échoue ici avec la
     * liste des erreurs plutôt que de produire un PDF non conforme.
     */
    private function assertXsdValid(ZugferdDocumentBuilder $builder, FacturXDocumentData $data): void
    {
        $validator = new ZugferdXsdValidator($builder);
        $validator->validate();

        if ($validator->hasValidationErrors()) {
            $errors = [];
            foreach ($validator->validationErrors() as $error) {
                $errors[] = (string) $error;
            }

            throw new FacturXGenerationException(
                FacturXGenerationException::CODE_XSD_INVALID,
                sprintf(
                    'Le XML du document %s ne passe pas la validation XSD : %s',
                    $data->number,
                    implode(' | ', array_slice($errors, 0, 5))
                )
            );
        }
    }
}
