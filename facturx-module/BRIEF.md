# Brief — Module PrestaShop « Factur-X / Facturation électronique conforme »

## Contexte

La réforme française de la facturation électronique impose aux entreprises d'émettre et de recevoir des factures au format électronique structuré (Factur-X, UBL ou CII), conformes à la norme européenne EN 16931. Les boutiques PrestaShop génèrent nativement des factures PDF simples, qui ne sont pas conformes.

**Objectif produit** : un module PrestaShop vendable sur la marketplace PrestaShop Addons, qui transforme les factures natives PrestaShop en factures Factur-X conformes, sans changer le workflow du marchand.

**Cible** : boutiques PrestaShop françaises avec des clients professionnels (B2B pur ou mixte B2B/B2C). La réforme concerne les transactions B2B domestiques françaises.

**Modèle** : V1 = module autonome (one-shot), tout tourne chez le marchand, aucun backend externe. Une V2 avec services serveur (transmission via Plateforme de Dématérialisation Partenaire, archivage légal) viendra plus tard — ne rien coder pour la V2, mais garder l'architecture ouverte (hooks, interfaces).

## Rôle attendu de Claude Code

Tu es le développeur principal. Je suis le product owner, testeur et responsable conformité. Tu proposes, tu codes, tu écris les tests. Tu ne valides JAMAIS la conformité toi-même : chaque facture générée doit être testée par moi sur les validateurs externes (voir checklist). Tu me demandes validation avant tout choix structurant (lib, architecture, périmètre).

## Stack et bibliothèques imposées

- PHP compatible PrestaShop 1.7.x ET 8.x (vérifier les versions PHP supportées par chaque branche)
- Composer pour les dépendances (avec scoping/préfixage des namespaces si nécessaire pour éviter les conflits entre modules)
- Génération Factur-X : utiliser des libs open-source éprouvées, dans cet ordre de préférence :
  - `atgp/factur-x` (incrustation XML dans PDF, PDF/A-3)
  - `easybill/zugferd-php` (construction du XML CII)
  - `josemmo/einvoicing` (alternative pour EN 16931)
  - Évaluer et me proposer la combinaison la plus adaptée avant de coder.
- Ne PAS réécrire de moteur PDF ni de générateur XML maison.

## Périmètre fonctionnel V1

### 1. Génération Factur-X
- À chaque génération de facture PrestaShop (hook sur la facturation native), produire une facture Factur-X : PDF/A-3 avec XML CII embarqué.
- Profil Factur-X : EN 16931 (profil cible). Prévoir BASIC en option de configuration.
- La facture Factur-X remplace ou accompagne (option de config) le PDF natif envoyé au client et disponible dans l'espace client.
- Gestion complète : factures, avoirs (credit notes), remises ligne et globales, multi-taux de TVA, écotaxe, frais de port, paiements partiels.

### 2. Données obligatoires EN 16931
- Mapping complet des champs PrestaShop → XML CII : vendeur (SIREN/SIRET, TVA intracom, adresse), acheteur (raison sociale, SIREN si B2B, adresse), lignes, totaux, TVA par taux, conditions de paiement, dates.
- Champ SIREN/SIRET client : vérifier ce que PrestaShop offre nativement (champ SIRET sur les adresses) et l'exploiter ; si insuffisant, ajouter les champs nécessaires proprement (pas de override sauvage du core).
- Écran de configuration marchand : ses informations légales complètes, avec contrôle de saisie (format SIREN, TVA intracom).

### 3. Back-office
- Onglet de configuration du module : infos légales du vendeur, profil Factur-X, mode (remplacer / accompagner le PDF natif), activation par groupe de clients (ex : uniquement clients pro).
- Liste des factures générées avec statut (générée / erreur), possibilité de régénérer une facture, téléchargement du XML seul.
- Journal des erreurs lisible (facture sans SIREN client, donnée manquante...) avec message actionnable.

### 4. Robustesse
- Une facture qui ne peut pas être générée en Factur-X ne doit JAMAIS bloquer le workflow de commande : fallback sur le PDF natif + erreur loguée + alerte back-office.
- Compatibilité avec les thèmes et modules de facturation courants : ne pas casser la génération native.
- Performance : la génération ne doit pas ajouter plus de ~2s au processus.

## Hors périmètre V1 (ne pas coder)
- Transmission aux Plateformes de Dématérialisation Partenaires (PDP)
- Archivage légal à valeur probante
- Réception de factures fournisseurs
- Formats UBL et annuaire des entreprises
- e-reporting

## Contraintes marketplace PrestaShop Addons
- Respect strict des normes de développement PrestaShop (validator Addons) : structure de module standard, index.php dans chaque dossier, pas d'override du core sauf nécessité absolue, traductions FR + EN, upgrade path propre entre versions.
- Le module doit passer le validator Addons dès la première soumission — coder avec ces normes dès le départ.
- Licence compatible avec la vente sur Addons (vérifier les licences des libs embarquées : MIT/Apache OK).

## Checklist de conformité (validée par moi, pas par toi)
- Chaque facture générée est testée sur le validateur FNFE-MPE (https://services.fnfe-mpe.org)
- Vérification PDF/A-3 (veraPDF)
- Cas de test obligatoires : facture simple 1 ligne TVA 20% / multi-lignes multi-TVA (20/10/5,5) / avoir complet / avoir partiel / remise globale / frais de port / client B2B avec SIREN / paiement partiel
- Test sur PrestaShop 8.x ET 1.7.x avec données de démo

## Méthode de travail
- Développement par phases, avec STOP et validation entre chaque phase :
  - Phase 0 : environnement Docker + choix des libs + architecture + contraintes Addons (propositions à valider)
  - Phase 1 : génération d'une première facture Factur-X depuis une commande de démo, testable sur FNFE-MPE
  - Phase 2 : mapping complet EN 16931 + tous les cas de test
  - Phase 3 : back-office complet (config, liste, régénération, logs)
  - Phase 4 : robustesse, compatibilité 1.7/8.x, performance
  - Phase 5 : préparation soumission Addons (validator, traductions, doc marchand)
- Commits git fréquents, un commit par étape fonctionnelle, messages clairs.
- Code commenté en français.
- Fin de chaque phase : récap de ce qui est fait, ce qui est testable, et la commande exacte pour tester.
