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

namespace FacturXInvoice\Exception;

use Exception;

/**
 * Erreur de génération Factur-X.
 *
 * Porte un code d'erreur stable (pour la table de suivi et les statistiques)
 * et un message actionnable pour le marchand. Cette exception ne doit JAMAIS
 * remonter jusqu'au workflow de commande : elle est interceptée par le module
 * qui déclenche alors le repli sur le PDF natif.
 */
class FacturXGenerationException extends Exception
{
    /** Le vendeur n'a pas renseigné ses informations légales dans la configuration */
    public const CODE_SELLER_CONFIG_MISSING = 'seller_config_missing';

    /** Donnée obligatoire manquante côté commande/client */
    public const CODE_MISSING_DATA = 'missing_data';

    /** Le XML produit ne passe pas la validation XSD */
    public const CODE_XSD_INVALID = 'xsd_invalid';

    /** Échec d'incrustation dans le PDF ou de conversion PDF/A-3 */
    public const CODE_PDF_EMBED_FAILED = 'pdf_embed_failed';

    /** Échec d'écriture du fichier généré */
    public const CODE_STORAGE_FAILED = 'storage_failed';

    /** Erreur inattendue */
    public const CODE_UNEXPECTED = 'unexpected';

    /** @var string Code d'erreur stable (constantes CODE_*) */
    private $errorCode;

    public function __construct(string $errorCode, string $message, ?\Throwable $previous = null)
    {
        parent::__construct($message, 0, $previous);
        $this->errorCode = $errorCode;
    }

    public function getErrorCode(): string
    {
        return $this->errorCode;
    }
}
