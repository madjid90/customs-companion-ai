# Sources marocaines : collecte web et PDF

Repérage du 10 septembre 2026. Aucun connecteur de téléchargement n'est encore
implémenté par ce document. Les pages ont été repérées/consultées, sans validation
exhaustive de toutes leurs pièces jointes ni de l'actualité juridique des textes.
Le fonctionnement ne dépend pas d'une API marocaine.

## ADII — sources prioritaires fournies par l'utilisateur

- Tarif : https://www.douane.gov.ma/web/guest/tarif#https://www.douane.gov.ma/tarif/tarif/init.jsf?
- Bases législatives : https://www.douane.gov.ma/web/guest/nos-bases-legislatives-et-reglementaires
- Circulaires : https://www.douane.gov.ma/circulaires/

Ces pages renvoient Request Rejected à l'outil de consultation utilisé. La collecte
par navigateur reste à vérifier. Ne pas considérer cette erreur comme une absence
de documents. Conserver le corpus local comme point de départ et rapprocher ses
empreintes des téléchargements futurs. Ne pas déduire le chapitre SH du nom du PDF.

## Accords : points d'entrée officiels MIC

- Catalogue : https://www.mcinet.gov.ma/fr/content/accords-par-pays
- UE : https://www.mcinet.gov.ma/fr/content/commerce-exterieur/accords-de-libre-echange-ue
- USA : https://www.mcinet.gov.ma/fr/content/commerce-exterieur/accords-de-libre-echange-usa
- Turquie : https://www.mcinet.gov.ma/fr/content/accords-de-libre-echange-turquie
- Royaume-Uni : https://www.mcinet.gov.ma/fr/content/accords-association-Maroc-Royaume-Uni
- Pays arabes : https://www.mcinet.gov.ma/fr/content/paysarabes
- AELE : https://www.mcinet.gov.ma/fr/content/maroc-etats-de-lassociation-europeene-de-libre-echange
- ZLECAF : https://www.mcinet.gov.ma/fr/content/zone-de-libre-echange-continentale-africaine-zlecaf
- Conventions commerciales : https://www.mcinet.gov.ma/fr/content/autres-types-daccords-conventions
- Exemple de texte AELE PDF : https://mcinet.gov.ma/sites/default/files/AccordsCommerciaux/AELE/AccordAELE.pdf

Collecter texte, annexes, listes de concessions, protocoles d'origine, amendements,
décisions et circulaires d'application. Une fiche de présentation d'accord ne
prouve pas à elle seule une préférence applicable. Versionner pays/territoires,
produits, dates, origine, contingents et justificatifs.

## Autorisations, contrôles et agréments

- Licences : https://www.mcinet.gov.ma/fr/content/liste-des-marchandises-soumises-licence-dimportation-0
- PDF lié, ouvert (17 pages) : https://www.mcinet.gov.ma/sites/default/files/documents/marchandisesimportation_0.pdf
- Produits contrôlés : https://www.mcinet.gov.ma/content/liste-des-produits-contr%C3%B4l%C3%A9s-%C3%A0-limportation-au-maroc
- Biens à double usage : https://www.mcinet.gov.ma/fr/content/commerce-exterieur/reglementation-controle-des-biens-double-usage
- Avis importateurs : https://www.mcinet.gov.ma/fr/importateurs?field_type_avis_target_id=78
- Contingents : https://www.mcinet.gov.ma/fr/content/contingents-dimportation-et-franchises-douaneres
- ANRT, catalogue repéré avec pagination : https://www.anrt.ma/e-services/agrements-des-equipements/consulter-la-liste-des-equipements-agrees?csrt=16963054125307562395&page=2775
- ANRT, décision PDF repérée : https://www.anrt.ma/sites/default/files/2025-04/Decision-Agrement-16-24-Ver-exploitable-FR.pdf?csrt=8283542016405953461
- ONSSA importation : https://www.onssa.gov.ma/controle-a-limportation-et-a-lexportation/controle-a-limportation/
- ONSSA modèles de certificats : https://www.onssa.gov.ma/controle-a-limportation-et-a-lexportation/modele-de-certificats-valides/
- ONSSA établissements agréés : https://www.onssa.gov.ma/agerements-et-autorisations/

Les paramètres de session ANRT observés ne doivent pas être codés en dur dans le
connecteur. Il devra retrouver le catalogue et sa pagination par navigation.

## Contrat du futur collecteur

1. Parcourir chaque point d'entrée et sa pagination ; enregistrer les pages vues.
2. Découvrir les liens PDF et sous-pages pertinents, sans deviner des identifiants.
3. Télécharger dans des limites de taille/durée/fréquence ; vérifier le contenu
   PDF réel, pas seulement une réponse HTTP 200 ou une extension de fichier.
4. Conserver URL de découverte, URL finale, empreinte, horodatage, langue et titre.
5. Comparer les empreintes, y compris si un fichier est remplacé à URL constante.
6. Extraire et proposer les relations, puis validation avant publication.
7. Signaler source inaccessible, pagination interrompue et extraction incomplète.

Un contrôle technique vise une catégorie de produits ; un agrément peut viser un
modèle précis ; une autorisation sanitaire peut viser un établissement ; un
certificat ou une autorisation peut viser une expédition. Modéliser ces portées
séparément et ne jamais les généraliser à tous les produits d'un même code SH.
