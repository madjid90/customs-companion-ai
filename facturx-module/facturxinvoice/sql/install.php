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
if (!defined('_PS_VERSION_')) {
    exit;
}

/*
 * Table de suivi des documents Factur-X générés : une ligne par facture
 * native, statut generated/error, message actionnable, chemin du fichier.
 */
$sql = [];

$sql[] = 'CREATE TABLE IF NOT EXISTS `' . _DB_PREFIX_ . 'facturx_document` (
    `id_facturx_document` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `id_order_invoice` INT UNSIGNED NULL,
    `id_order_slip` INT UNSIGNED NULL,
    `id_order` INT UNSIGNED NOT NULL,
    `document_type` VARCHAR(16) NOT NULL DEFAULT \'invoice\',
    `profile` VARCHAR(16) NOT NULL DEFAULT \'EN16931\',
    `status` VARCHAR(16) NOT NULL,
    `error_code` VARCHAR(64) NULL,
    `error_message` TEXT NULL,
    `pdf_path` VARCHAR(255) NULL,
    `xml_checksum` VARCHAR(64) NULL,
    `date_add` DATETIME NOT NULL,
    `date_upd` DATETIME NOT NULL,
    PRIMARY KEY (`id_facturx_document`),
    KEY `idx_facturx_order_invoice` (`id_order_invoice`),
    KEY `idx_facturx_order` (`id_order`),
    KEY `idx_facturx_status` (`status`)
) ENGINE=' . _MYSQL_ENGINE_ . ' DEFAULT CHARSET=utf8mb4;';
