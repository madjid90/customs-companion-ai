
-- Seed: Trade Agreements
INSERT INTO public.trade_agreements (code, name_fr, parties, proof_required, is_active)
VALUES
('eur1', 'Accord Association Maroc-UE', '["Maroc","Union Européenne"]', 'EUR.1 ou déclaration sur facture', true),
('usa', 'ALE Maroc-USA', '["Maroc","USA"]', 'Certificat origine ALE', true),
('atr', 'Union douanière Maroc-Turquie', '["Maroc","Turquie"]', 'ATR (industriels) ou EUR.1 (agricoles)', true),
('agadir', 'Accord Agadir', '["Maroc","Tunisie","Égypte","Jordanie"]', 'EUR.1 ou EUR-MED', true),
('aele', 'ALE Maroc-AELE', '["Maroc","Suisse","Norvège","Islande"]', 'EUR.1', true),
('golfe', 'ALE Maroc-EAU', '["Maroc","EAU"]', 'Certificat origine', true),
('gzale', 'Grande Zone Arabe Libre-Échange', '["Maroc","Pays arabes"]', 'Certificat origine arabe', true),
('zlecaf', 'ZLECAf', '["Maroc","Afrique"]', 'Certificat origine ZLECAf', true),
('gb', 'Accord Maroc-Royaume-Uni', '["Maroc","Royaume-Uni"]', 'EUR.1', true)
ON CONFLICT (code) DO NOTHING;

-- Seed: Controlled Products
INSERT INTO public.controlled_products (hs_code, country_code, control_type, control_authority, standard_required, required_documents, notes, procedure_steps, estimated_delay, estimated_cost, required_before, portal_url, legal_basis, is_active)
VALUES
('0201', 'MA', 'sanitary', 'ONSSA', 'Contrôle sanitaire vétérinaire', '["Certificat sanitaire","Certificat vétérinaire","Rapport analyse"]', 'Viandes bovines', '["Certificat sanitaire pays origine","Notification ONSSA 48h","Contrôle documentaire","Analyse labo","Mainlevée"]', '3-7 jours', '500-2000 MAD', 'customs', 'https://www.onssa.gov.ma', 'Loi 28-07', true),
('0401', 'MA', 'sanitary', 'ONSSA', 'Contrôle sanitaire', '["Certificat sanitaire","Analyse labo"]', 'Produits laitiers', '["Certificat sanitaire","Notification ONSSA","Contrôle","Analyse","Mainlevée"]', '3-7 jours', '500-1500 MAD', 'customs', 'https://www.onssa.gov.ma', 'Loi 28-07', true),
('0901', 'MA', 'sanitary', 'ONSSA', 'Contrôle phytosanitaire', '["Certificat phytosanitaire"]', 'Café', '["Certificat phytosanitaire","Contrôle","Inspection","Mainlevée"]', '2-5 jours', '300-1000 MAD', 'customs', 'https://www.onssa.gov.ma', 'Loi 28-07', true),
('8517', 'MA', 'telecom', 'ANRT', 'Homologation ANRT', '["Fiche technique","Rapports test CE/FCC","Déclaration conformité"]', 'Téléphones, routeurs, modems', '["Préparer dossier technique","Soumettre portail ANRT","Payer frais","Attendre décision","Attestation"]', '5-15 jours', '500-2000 MAD', 'before_customs', 'https://www.anrt.ma', 'Loi 24-96', true),
('8471', 'MA', 'telecom', 'ANRT', 'Homologation ANRT (Wi-Fi/BT)', '["Fiche technique","Rapports test radio"]', 'Ordinateurs avec Wi-Fi/Bluetooth', '["Dossier technique","Soumission ANRT","Frais","Décision"]', '5-15 jours', '500-2000 MAD', 'before_customs', 'https://www.anrt.ma', 'Loi 24-96', true),
('7213', 'MA', 'conformity', 'CoC/MCINET', 'Certificat de conformité', '["CoC","Rapport inspection"]', 'Aciers et fers', '["Inspection pré-embarquement","Organisme agréé (BV, SGS)","Inspection usine","CoC émis","Présenter douane"]', '5-10 jours', '0.2-0.5% FOB', 'before_shipment', 'https://www.mcinet.gov.ma', 'Arrêté MCINET', true),
('3004', 'MA', 'pharmaceutical', 'DMP', 'AMM obligatoire', '["AMM","Certificat libre vente","Certificat BPF"]', 'Médicaments', '["Demande AMM","Dossier CTD","Évaluation DMP","AMM obtenue","Import autorisé"]', '6-12 mois (AMM)', '50000+ MAD', 'before_customs', 'https://www.sante.gov.ma', 'Loi 17-04', true)
ON CONFLICT DO NOTHING;
