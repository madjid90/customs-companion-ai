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

// Autoload du module : classes src/ + bibliothèques embarquées.
if (file_exists(__DIR__ . '/vendor/autoload.php')) {
    require_once __DIR__ . '/vendor/autoload.php';
}

use FacturXInvoice\Builder\CiiBuilderInterface;
use FacturXInvoice\Builder\HorstoekoCiiBuilder;
use FacturXInvoice\Exception\FacturXGenerationException;
use FacturXInvoice\Extractor\InvoiceDataExtractor;
use FacturXInvoice\Model\PartyData;
use FacturXInvoice\Pdf\AtgpPdfEmbedder;
use FacturXInvoice\Repository\FacturXDocumentRepository;
use FacturXInvoice\Service\FacturXGenerator;
use FacturXInvoice\Storage\DocumentStorage;
use FacturXInvoice\Validator\SirenValidator;
use FacturXInvoice\Validator\VatNumberValidator;

/**
 * Module de facturation électronique Factur-X.
 *
 * Génère, pour chaque facture native PrestaShop, une facture Factur-X
 * (PDF/A-3 avec XML CII embarqué, profil EN 16931 ou BASIC) sans jamais
 * bloquer le workflow de commande en cas d'échec.
 */
class Facturxinvoice extends Module
{
    /** Clés de configuration du module */
    public const CONF_PROFILE = 'FACTURXINVOICE_PROFILE';
    public const CONF_SELLER_COMPANY = 'FACTURXINVOICE_SELLER_COMPANY';
    public const CONF_SELLER_SIREN = 'FACTURXINVOICE_SELLER_SIREN';
    public const CONF_SELLER_SIRET = 'FACTURXINVOICE_SELLER_SIRET';
    public const CONF_SELLER_VAT = 'FACTURXINVOICE_SELLER_VAT';
    public const CONF_SELLER_ADDR1 = 'FACTURXINVOICE_SELLER_ADDR1';
    public const CONF_SELLER_ADDR2 = 'FACTURXINVOICE_SELLER_ADDR2';
    public const CONF_SELLER_ZIP = 'FACTURXINVOICE_SELLER_ZIP';
    public const CONF_SELLER_CITY = 'FACTURXINVOICE_SELLER_CITY';
    public const CONF_SELLER_COUNTRY = 'FACTURXINVOICE_SELLER_COUNTRY';

    public function __construct()
    {
        $this->name = 'facturxinvoice';
        $this->tab = 'billing_invoicing';
        $this->version = '0.1.0';
        $this->author = 'FacturXInvoice';
        $this->need_instance = 0;
        $this->bootstrap = true;

        parent::__construct();

        $this->displayName = $this->l('Factur-X - Facturation électronique');
        $this->description = $this->l('Génère des factures électroniques Factur-X (PDF/A-3 + XML CII, norme EN 16931) à partir des factures natives PrestaShop.');
        $this->confirmUninstall = $this->l('Les factures Factur-X déjà générées seront conservées sur le disque. Désinstaller le module ?');

        $this->ps_versions_compliancy = ['min' => '1.7.8.0', 'max' => '8.99.99'];
    }

    /**
     * Installation : hooks + table de suivi + configuration par défaut.
     */
    public function install()
    {
        return parent::install()
            && $this->registerHook('actionObjectOrderInvoiceAddAfter')
            && $this->installSql()
            && $this->installConfiguration();
    }

    public function uninstall()
    {
        // La table de suivi et les fichiers générés sont volontairement
        // conservés : ce sont des documents comptables du marchand.
        return $this->uninstallConfiguration() && parent::uninstall();
    }

    private function installSql()
    {
        $sql = [];
        include __DIR__ . '/sql/install.php';

        foreach ($sql as $query) {
            if (!Db::getInstance()->execute($query)) {
                return false;
            }
        }

        return true;
    }

    private function installConfiguration()
    {
        // Pré-remplissage depuis les informations boutique existantes :
        // le marchand n'a plus qu'à compléter SIREN/SIRET/TVA.
        return Configuration::updateValue(self::CONF_PROFILE, CiiBuilderInterface::PROFILE_EN16931)
            && Configuration::updateValue(self::CONF_SELLER_COMPANY, (string) Configuration::get('PS_SHOP_NAME'))
            && Configuration::updateValue(self::CONF_SELLER_ADDR1, (string) Configuration::get('PS_SHOP_ADDR1'))
            && Configuration::updateValue(self::CONF_SELLER_ADDR2, (string) Configuration::get('PS_SHOP_ADDR2'))
            && Configuration::updateValue(self::CONF_SELLER_ZIP, (string) Configuration::get('PS_SHOP_CODE'))
            && Configuration::updateValue(self::CONF_SELLER_CITY, (string) Configuration::get('PS_SHOP_CITY'))
            && Configuration::updateValue(self::CONF_SELLER_COUNTRY, 'FR');
    }

    private function uninstallConfiguration()
    {
        $keys = [
            self::CONF_PROFILE,
            self::CONF_SELLER_COMPANY,
            self::CONF_SELLER_SIREN,
            self::CONF_SELLER_SIRET,
            self::CONF_SELLER_VAT,
            self::CONF_SELLER_ADDR1,
            self::CONF_SELLER_ADDR2,
            self::CONF_SELLER_ZIP,
            self::CONF_SELLER_CITY,
            self::CONF_SELLER_COUNTRY,
        ];

        foreach ($keys as $key) {
            Configuration::deleteByName($key);
        }

        return true;
    }

    /**
     * Écran de configuration : informations légales du vendeur + profil.
     */
    public function getContent()
    {
        $output = '';

        if (Tools::isSubmit('submitFacturxinvoice')) {
            $errors = $this->saveConfiguration();
            if ([] === $errors) {
                $output .= $this->displayConfirmation($this->l('Configuration enregistrée.'));
            } else {
                foreach ($errors as $error) {
                    $output .= $this->displayError($error);
                }
            }
        }

        return $output . $this->renderConfigurationForm();
    }

    /**
     * Contrôle de saisie puis enregistrement de la configuration.
     *
     * @return string[] liste de messages d'erreur (vide si tout est valide)
     */
    private function saveConfiguration()
    {
        $errors = [];

        $company = trim((string) Tools::getValue('seller_company'));
        $siren = SirenValidator::normalize((string) Tools::getValue('seller_siren'));
        $siret = SirenValidator::normalize((string) Tools::getValue('seller_siret'));
        $vat = VatNumberValidator::normalize((string) Tools::getValue('seller_vat'));
        $profile = (string) Tools::getValue('profile');

        if ('' === $company) {
            $errors[] = $this->l('La raison sociale est obligatoire.');
        }
        if ('' === $siren || !SirenValidator::isValidSiren($siren)) {
            $errors[] = $this->l('Le SIREN est invalide : 9 chiffres attendus (clé de contrôle vérifiée).');
        }
        if ('' !== $siret && !SirenValidator::isValidSiret($siret)) {
            $errors[] = $this->l('Le SIRET est invalide : 14 chiffres attendus (clé de contrôle vérifiée).');
        }
        if ('' !== $siret && '' !== $siren && 0 !== strpos($siret, $siren)) {
            $errors[] = $this->l('Le SIRET doit commencer par le SIREN.');
        }
        if ('' === $vat || !VatNumberValidator::isValid($vat)) {
            $errors[] = $this->l('Le numéro de TVA intracommunautaire est invalide (format attendu : FRXX123456789).');
        }
        if (!in_array($profile, [CiiBuilderInterface::PROFILE_EN16931, CiiBuilderInterface::PROFILE_BASIC], true)) {
            $errors[] = $this->l('Profil Factur-X inconnu.');
        }

        if ([] !== $errors) {
            return $errors;
        }

        Configuration::updateValue(self::CONF_PROFILE, $profile);
        Configuration::updateValue(self::CONF_SELLER_COMPANY, $company);
        Configuration::updateValue(self::CONF_SELLER_SIREN, $siren);
        Configuration::updateValue(self::CONF_SELLER_SIRET, $siret);
        Configuration::updateValue(self::CONF_SELLER_VAT, $vat);
        Configuration::updateValue(self::CONF_SELLER_ADDR1, trim((string) Tools::getValue('seller_addr1')));
        Configuration::updateValue(self::CONF_SELLER_ADDR2, trim((string) Tools::getValue('seller_addr2')));
        Configuration::updateValue(self::CONF_SELLER_ZIP, trim((string) Tools::getValue('seller_zip')));
        Configuration::updateValue(self::CONF_SELLER_CITY, trim((string) Tools::getValue('seller_city')));
        Configuration::updateValue(self::CONF_SELLER_COUNTRY, strtoupper(trim((string) Tools::getValue('seller_country'))) ?: 'FR');

        return [];
    }

    private function renderConfigurationForm()
    {
        $helper = new HelperForm();
        $helper->module = $this;
        $helper->name_controller = $this->name;
        $helper->token = Tools::getAdminTokenLite('AdminModules');
        $helper->currentIndex = AdminController::$currentIndex . '&configure=' . $this->name;
        $helper->submit_action = 'submitFacturxinvoice';
        $helper->default_form_language = (int) Configuration::get('PS_LANG_DEFAULT');

        $helper->fields_value = [
            'profile' => Tools::getValue('profile', Configuration::get(self::CONF_PROFILE)),
            'seller_company' => Tools::getValue('seller_company', Configuration::get(self::CONF_SELLER_COMPANY)),
            'seller_siren' => Tools::getValue('seller_siren', Configuration::get(self::CONF_SELLER_SIREN)),
            'seller_siret' => Tools::getValue('seller_siret', Configuration::get(self::CONF_SELLER_SIRET)),
            'seller_vat' => Tools::getValue('seller_vat', Configuration::get(self::CONF_SELLER_VAT)),
            'seller_addr1' => Tools::getValue('seller_addr1', Configuration::get(self::CONF_SELLER_ADDR1)),
            'seller_addr2' => Tools::getValue('seller_addr2', Configuration::get(self::CONF_SELLER_ADDR2)),
            'seller_zip' => Tools::getValue('seller_zip', Configuration::get(self::CONF_SELLER_ZIP)),
            'seller_city' => Tools::getValue('seller_city', Configuration::get(self::CONF_SELLER_CITY)),
            'seller_country' => Tools::getValue('seller_country', Configuration::get(self::CONF_SELLER_COUNTRY)),
        ];

        $form = [
            'form' => [
                'legend' => [
                    'title' => $this->l('Informations légales du vendeur'),
                    'icon' => 'icon-file-text',
                ],
                'input' => [
                    [
                        'type' => 'text',
                        'label' => $this->l('Raison sociale'),
                        'name' => 'seller_company',
                        'required' => true,
                    ],
                    [
                        'type' => 'text',
                        'label' => $this->l('SIREN'),
                        'name' => 'seller_siren',
                        'required' => true,
                        'desc' => $this->l('9 chiffres, ex. 552100554'),
                    ],
                    [
                        'type' => 'text',
                        'label' => $this->l('SIRET'),
                        'name' => 'seller_siret',
                        'desc' => $this->l('14 chiffres (siège), optionnel mais recommandé'),
                    ],
                    [
                        'type' => 'text',
                        'label' => $this->l('TVA intracommunautaire'),
                        'name' => 'seller_vat',
                        'required' => true,
                        'desc' => $this->l('Ex. FR40303265045'),
                    ],
                    [
                        'type' => 'text',
                        'label' => $this->l('Adresse'),
                        'name' => 'seller_addr1',
                        'required' => true,
                    ],
                    [
                        'type' => 'text',
                        'label' => $this->l('Adresse (complément)'),
                        'name' => 'seller_addr2',
                    ],
                    [
                        'type' => 'text',
                        'label' => $this->l('Code postal'),
                        'name' => 'seller_zip',
                        'required' => true,
                    ],
                    [
                        'type' => 'text',
                        'label' => $this->l('Ville'),
                        'name' => 'seller_city',
                        'required' => true,
                    ],
                    [
                        'type' => 'text',
                        'label' => $this->l('Code pays (ISO)'),
                        'name' => 'seller_country',
                        'desc' => $this->l('Code à 2 lettres, ex. FR'),
                    ],
                    [
                        'type' => 'select',
                        'label' => $this->l('Profil Factur-X'),
                        'name' => 'profile',
                        'options' => [
                            'query' => [
                                ['id' => CiiBuilderInterface::PROFILE_EN16931, 'name' => 'EN 16931 (recommandé)'],
                                ['id' => CiiBuilderInterface::PROFILE_BASIC, 'name' => 'BASIC'],
                            ],
                            'id' => 'id',
                            'name' => 'name',
                        ],
                    ],
                ],
                'submit' => [
                    'title' => $this->l('Enregistrer'),
                ],
            ],
        ];

        return $helper->generateForm([$form]);
    }

    /**
     * Hook déclencheur : une facture native vient d'être créée.
     *
     * Toute la génération est enveloppée : aucune exception ne doit remonter
     * au workflow de commande (exigence de robustesse du brief).
     *
     * @param array $params ['object' => OrderInvoice]
     */
    public function hookActionObjectOrderInvoiceAddAfter($params)
    {
        if (!isset($params['object']) || !($params['object'] instanceof OrderInvoice)) {
            return;
        }

        /** @var OrderInvoice $orderInvoice */
        $orderInvoice = $params['object'];

        try {
            $this->generateFacturX($orderInvoice);
        } catch (\Throwable $e) {
            $this->logGenerationFailure($orderInvoice, $e);
        }
    }

    /**
     * Chaîne complète : extraction → XML CII validé → PDF/A-3 → stockage → suivi.
     *
     * @throws FacturXGenerationException
     */
    public function generateFacturX(OrderInvoice $orderInvoice)
    {
        $order = new Order((int) $orderInvoice->id_order);
        $profile = (string) Configuration::get(self::CONF_PROFILE) ?: CiiBuilderInterface::PROFILE_EN16931;

        // 1. Extraction des données vers le modèle interne
        $extractor = new InvoiceDataExtractor();
        $data = $extractor->extractFromOrderInvoice($orderInvoice, $order, $this->buildSellerFromConfiguration());

        // 2. Rendu du PDF natif PrestaShop (celui que le client aurait reçu)
        $pdf = new PDF($orderInvoice, PDF::TEMPLATE_INVOICE, Context::getContext()->smarty);
        $nativePdf = (string) $pdf->render(false);

        // 3. XML CII validé XSD + incrustation PDF/A-3
        $generator = new FacturXGenerator(new HorstoekoCiiBuilder($profile), new AtgpPdfEmbedder());
        $result = $generator->generate($data, $nativePdf);

        // 4. Stockage hors dossier module + ligne de suivi
        $storage = $this->getDocumentStorage();
        $baseName = $this->buildDocumentBaseName($orderInvoice, $data->number);
        $pdfPath = $storage->save($baseName . '.pdf', $result['pdf']);
        $storage->save($baseName . '.xml', $result['xml']);

        $repository = new FacturXDocumentRepository();
        $repository->logSuccess(
            (int) $orderInvoice->id,
            (int) $order->id,
            $profile,
            $pdfPath,
            hash('sha256', $result['xml'])
        );
    }

    /**
     * Vendeur depuis la configuration du module.
     *
     * @throws FacturXGenerationException si la configuration est incomplète
     */
    private function buildSellerFromConfiguration()
    {
        $company = trim((string) Configuration::get(self::CONF_SELLER_COMPANY));
        $siren = (string) Configuration::get(self::CONF_SELLER_SIREN);
        $vat = (string) Configuration::get(self::CONF_SELLER_VAT);

        if ('' === $company || '' === $siren || '' === $vat) {
            throw new FacturXGenerationException(
                FacturXGenerationException::CODE_SELLER_CONFIG_MISSING,
                $this->l('Les informations légales du vendeur sont incomplètes : ouvrez la configuration du module Factur-X et renseignez raison sociale, SIREN et TVA intracommunautaire.')
            );
        }

        $seller = new PartyData($company);
        $seller->siren = $siren;
        $seller->siret = (string) Configuration::get(self::CONF_SELLER_SIRET) ?: null;
        $seller->vatNumber = $vat;
        $seller->addressLine1 = (string) Configuration::get(self::CONF_SELLER_ADDR1);
        $seller->addressLine2 = (string) Configuration::get(self::CONF_SELLER_ADDR2) ?: null;
        $seller->postCode = (string) Configuration::get(self::CONF_SELLER_ZIP);
        $seller->city = (string) Configuration::get(self::CONF_SELLER_CITY);
        $seller->countryCode = (string) Configuration::get(self::CONF_SELLER_COUNTRY) ?: 'FR';

        return $seller;
    }

    /**
     * Nom de fichier stable et sûr pour les documents générés.
     */
    private function buildDocumentBaseName(OrderInvoice $orderInvoice, $number)
    {
        $safeNumber = preg_replace('/[^A-Za-z0-9#_-]/', '-', (string) $number);

        return sprintf('facturx-%d-%s', (int) $orderInvoice->id, trim((string) $safeNumber, '-'));
    }

    private function getDocumentStorage()
    {
        // Hors du dossier du module : survivre aux mises à jour du module.
        return new DocumentStorage(_PS_ROOT_DIR_ . '/var/facturxinvoice');
    }

    /**
     * Trace l'échec : table de suivi + journal PrestaShop. Jamais d'exception.
     */
    private function logGenerationFailure(OrderInvoice $orderInvoice, \Throwable $e)
    {
        $errorCode = $e instanceof FacturXGenerationException
            ? $e->getErrorCode()
            : FacturXGenerationException::CODE_UNEXPECTED;

        try {
            $repository = new FacturXDocumentRepository();
            $repository->logError(
                (int) $orderInvoice->id,
                (int) $orderInvoice->id_order,
                (string) Configuration::get(self::CONF_PROFILE) ?: CiiBuilderInterface::PROFILE_EN16931,
                $errorCode,
                $e->getMessage()
            );
        } catch (\Throwable $loggingError) {
            // La table de suivi elle-même est indisponible : dernier recours ci-dessous.
        }

        try {
            PrestaShopLogger::addLog(
                sprintf('[facturxinvoice] Échec de génération Factur-X pour la facture #%d : %s', (int) $orderInvoice->id, $e->getMessage()),
                3,
                null,
                'OrderInvoice',
                (int) $orderInvoice->id,
                true
            );
        } catch (\Throwable $loggingError) {
            // Ne jamais bloquer le workflow de commande, même pour un échec de log.
        }
    }
}
