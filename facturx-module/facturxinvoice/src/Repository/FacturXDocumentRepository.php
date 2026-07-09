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

namespace FacturXInvoice\Repository;

/**
 * Accès à la table de suivi des documents Factur-X générés.
 *
 * Chaque facture native a au plus une ligne de suivi : la régénération met à
 * jour la ligne existante (l'historique fin viendra avec le journal Phase 3).
 */
class FacturXDocumentRepository
{
    public const STATUS_GENERATED = 'generated';
    public const STATUS_ERROR = 'error';

    public const TABLE = 'facturx_document';

    /**
     * Enregistre une génération réussie (insère ou met à jour).
     */
    public function logSuccess(int $idOrderInvoice, int $idOrder, string $profile, string $pdfPath, string $xmlChecksum): bool
    {
        return $this->upsert($idOrderInvoice, [
            'id_order' => $idOrder,
            'document_type' => 'invoice',
            'profile' => pSQL($profile),
            'status' => self::STATUS_GENERATED,
            'error_code' => null,
            'error_message' => null,
            'pdf_path' => pSQL($pdfPath),
            'xml_checksum' => pSQL($xmlChecksum),
        ]);
    }

    /**
     * Enregistre un échec de génération avec un message actionnable.
     */
    public function logError(int $idOrderInvoice, int $idOrder, string $profile, string $errorCode, string $errorMessage): bool
    {
        return $this->upsert($idOrderInvoice, [
            'id_order' => $idOrder,
            'document_type' => 'invoice',
            'profile' => pSQL($profile),
            'status' => self::STATUS_ERROR,
            'error_code' => pSQL($errorCode),
            'error_message' => pSQL(mb_substr($errorMessage, 0, 60000)),
            'pdf_path' => null,
            'xml_checksum' => null,
        ]);
    }

    /**
     * @return array|null la ligne de suivi de la facture, ou null
     */
    public function findByOrderInvoiceId(int $idOrderInvoice): ?array
    {
        $row = \Db::getInstance()->getRow(
            'SELECT * FROM `' . _DB_PREFIX_ . self::TABLE . '` WHERE `id_order_invoice` = ' . (int) $idOrderInvoice
        );

        return is_array($row) ? $row : null;
    }

    /**
     * Insère la ligne de suivi ou met à jour celle qui existe déjà.
     *
     * @param array<string, mixed> $fields valeurs déjà échappées via pSQL
     */
    private function upsert(int $idOrderInvoice, array $fields): bool
    {
        $db = \Db::getInstance();
        $now = date('Y-m-d H:i:s');
        $existing = $this->findByOrderInvoiceId($idOrderInvoice);

        $fields['date_upd'] = $now;

        if (null !== $existing) {
            return (bool) $db->update(
                self::TABLE,
                $fields,
                '`id_order_invoice` = ' . (int) $idOrderInvoice
            );
        }

        $fields['id_order_invoice'] = $idOrderInvoice;
        $fields['date_add'] = $now;

        return (bool) $db->insert(self::TABLE, $fields);
    }
}
