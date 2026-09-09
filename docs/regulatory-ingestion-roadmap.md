# Regulatory ingestion foundation

Status: first isolated policy module, not integrated into the live application.
The publication gate is not an authorization boundary: the future backend must
derive reviewer identity and approval from authenticated, persisted records.
Clients must never be allowed to self-assert these fields. Approval of the original
file alone is insufficient after extraction edits: the integration must also bind
approval to an immutable extraction/rules revision.

## Official source register (discovery checked 2026-09-10)

| Pack | Source | Intended content | Connector status |
| --- | --- | --- | --- |
| OMD | https://www.wcoomd.org/en/topics/nomenclature/instrument-and-tools/hs-nomenclature-2022-edition.aspx | SH, legal notes, amendments, correlation tables | Discovery only; edition and reuse checks required |
| OMD licensed | https://www.wcoomdpublications.org/en | Explanatory notes, opinions, XML/CSV | License and automated reuse permission required |
| Morocco | https://www.douane.gov.ma | Code, RDII, circulars, ADIL tariffs and agreements | Direct access rejected during research |
| Morocco ADIL | https://www.douane.gov.ma/adil/rss.xml | Change discovery | Feed documented in ADIL brochure; live retrieval not verified |
| Morocco legislation | https://www.sgg.gov.ma/imprimerieofficielle.aspx | Official gazette, laws and implementing texts | Discovery only |
| Morocco controls | https://www.mcinet.gov.ma/content/liste-des-produits-contr%C3%B4l%C3%A9s-%C3%A0-limportation-au-maroc | Product controls and associated publications | Discovery only |
| EU | https://taxation-customs.ec.europa.eu/customs/union-customs-code/ucc-legislation_en | UCC and delegated/implementing acts | Discovery only |
| EU tariff | https://taxation-customs.ec.europa.eu/online-services/online-services-and-databases-customs/eu-customs-tariff-taric_fr | TARIC measures and nomenclature | Official extraction route to validate |
| International | https://www.wcoomd.org/en/topics/facilitation/instrument-and-tools/conventions/pf_revised_kyoto_conv.aspx | Revised Kyoto Convention | Applicability depends on parties and accepted annexes |
| International | https://www.wto.org/english/tratop_e/cusval_e/cusval_e.htm | Customs valuation | Discovery only |
| International | https://www.wto.org/english/tratop_e/roi_e/roi_e.htm | Origin instruments and agreement references | Discovery only |

## Target flow

Official feed/export/API (HTML collection when needed) -> immutable source copy
and SHA-256 -> duplicate/version detection -> page-aware extraction -> structured
codes/articles/tables -> proposed legal relations -> quality checks -> review of
document, extraction and applicability -> atomic publication -> incremental index
refresh -> affected dossier notifications. Failed retrieval is never interpreted
as deletion or repeal. No automatic bypass of access restrictions.

Store publication date, effective interval and retrieval timestamp separately.
Model amendment, repeal, exception and explanatory relationships explicitly.
No global newest-document-wins policy. Never silently rewrite approved dossiers.
Preserve raw source and extraction/rule revisions, reviewer and audit history.

## Delivery sequence

1. Fix audited authentication and ingestion defects; restore reproducible CI.
2. Durable worker, versioned storage, page accounting and retry/idempotency.
3. OMD + Morocco pilot, explicit links and reviewed rule applicability.
4. Shared retrieval/classification/context service and isolated dossier memory.
5. Templates from structured decisions, revisioned generated documents.
6. Official-source connectors and change review; EU pack; production pilot.

Production acceptance requires corpus-based SH/extraction evaluation, tenant and
role isolation tests, migration rehearsal, restore test, source citation checks,
and demonstrated propagation of a circular amendment to an affected dossier.

## Access observations

GitHub write credentials available. Repository Supabase ref is
`mefyrysrlmzzcsyyysqp`, absent from connected project's listing. Connected Vercel
team contains another application, not this repository. No database or deployment
changes made by this foundation PR.
