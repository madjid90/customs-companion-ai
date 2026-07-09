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

/**
 * Construction du XML CII à partir du modèle interne.
 *
 * Interface volontairement minimale : elle isole le reste du module de la
 * bibliothèque XML utilisée (horstoeko/zugferd en V1) et permet d'en changer
 * sans toucher au métier.
 */
interface CiiBuilderInterface
{
    /** Profil Factur-X EN 16931 (profil cible) */
    public const PROFILE_EN16931 = 'EN16931';

    /** Profil Factur-X BASIC (option de configuration) */
    public const PROFILE_BASIC = 'BASIC';

    /**
     * Construit le XML CII du document, validé contre les XSD officiels.
     *
     * @param FacturXDocumentData $data document à sérialiser
     *
     * @return string le XML CII (UTF-8, avec déclaration XML)
     *
     * @throws FacturXGenerationException si une donnée obligatoire manque ou si le XML est invalide
     */
    public function build(FacturXDocumentData $data): string;
}
