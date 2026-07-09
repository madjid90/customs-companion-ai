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

namespace FacturXInvoice\Storage;

use FacturXInvoice\Exception\FacturXGenerationException;

/**
 * Stockage des fichiers Factur-X générés.
 *
 * Les fichiers sont écrits hors du dossier du module (ils survivraient mal à
 * une mise à jour) dans un répertoire protégé contre l'accès web direct.
 */
class DocumentStorage
{
    /** @var string Répertoire de base, sans slash final */
    private $baseDir;

    public function __construct(string $baseDir)
    {
        $this->baseDir = rtrim($baseDir, '/');
    }

    /**
     * Écrit un fichier et retourne son chemin absolu.
     *
     * @throws FacturXGenerationException si l'écriture échoue
     */
    public function save(string $fileName, string $content): string
    {
        $this->ensureDirectory();

        $path = $this->baseDir . '/' . basename($fileName);
        if (false === @file_put_contents($path, $content)) {
            throw new FacturXGenerationException(
                FacturXGenerationException::CODE_STORAGE_FAILED,
                sprintf('Impossible d\'écrire le fichier %s : vérifiez les droits sur %s.', $fileName, $this->baseDir)
            );
        }

        return $path;
    }

    public function read(string $fileName): ?string
    {
        $path = $this->baseDir . '/' . basename($fileName);
        if (!is_file($path)) {
            return null;
        }

        $content = @file_get_contents($path);

        return false === $content ? null : $content;
    }

    public function getPath(string $fileName): string
    {
        return $this->baseDir . '/' . basename($fileName);
    }

    /**
     * Crée le répertoire au premier usage, avec protection anti-listing
     * (.htaccess pour Apache, index.php par convention PrestaShop).
     */
    private function ensureDirectory(): void
    {
        if (is_dir($this->baseDir)) {
            return;
        }

        if (!@mkdir($this->baseDir, 0755, true) && !is_dir($this->baseDir)) {
            throw new FacturXGenerationException(
                FacturXGenerationException::CODE_STORAGE_FAILED,
                sprintf('Impossible de créer le répertoire de stockage %s.', $this->baseDir)
            );
        }

        @file_put_contents($this->baseDir . '/.htaccess', "Require all denied\n");
        @file_put_contents($this->baseDir . '/index.php', "<?php\nheader('Location: ../');\nexit;\n");
    }
}
