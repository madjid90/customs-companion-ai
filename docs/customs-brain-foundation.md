# Customs brain foundation

This foundation turns the existing document search stack into a versioned customs
decision system. It is manual-first: official documents are deposited by an
administrator, reviewed, and published. RSS can later provide change notices; no
scraper or external connector is required for the first Morocco release.

This document is historical. The authoritative architecture is now under
`docs/architecture/`. The product center is the customs brain and its API; web
pages, chat, agents and integrations are consumers built on top of that API.

## Domain boundaries

1. **Sources and ingestion** preserve the original file, its SHA-256, every
   extraction run, page accounting, quality score, and unresolved issues.
2. **Legal corpus** separates a legal instrument from its dated versions and
   provisions. Relationships carry evidence and must be validated.
3. **HS corpus** stores independent nomenclature editions and the complete
   parent/child tree. A national line never loses its inherited description.
4. **Regulatory context** connects a validated HS node or prefix to a legal
   provision and a dated measure: duty, authorization, control, origin rule,
   required document, restriction, or procedure.
5. **Company memory** stores tenant-isolated products and immutable product
   versions.
6. **Operational dossiers** store import/export/transit cases, their lines,
   supporting documents, classification decisions, candidates, evidence, and
   generated documents.

## Publication invariant

A source revision cannot become `published` unless all of these conditions hold:

- the source permits reuse;
- the latest ingestion run completed;
- every page was processed and no page failed;
- quality is at least 85/100;
- no blocking issue remains open;
- an expert approved the exact extraction hash;
- the published actor and timestamp are persisted by the database trigger.

The browser cannot self-assert publication approval. The database enforces the
gate in `private.enforce_source_document_publication()`.

## Access model

Shared regulatory data is read-only for signed-in users and writable by platform
administrators. Draft and rejected corpus entries remain admin-only. Company
products, dossiers, decisions, evidence, and generated documents are isolated by
organization membership. Elevated dossier operations require an organization
role (`owner`, `admin`, `expert`, or `analyst`).

## Migration from the legacy corpus

Existing tables remain untouched in the first migration. Data moves in controlled
batches:

1. register the official source;
2. create an immutable `source_documents` revision;
3. create and review an `ingestion_runs` result;
4. map documents into instruments, versions, provisions, and HS nodes;
5. validate relationships and regulatory measures;
6. publish only after the gate accepts the revision;
7. compare search and classification results against the reference test corpus;
8. retire legacy reads only after parity is demonstrated.

## Next implementation slice

The next slice is the corpus workbench and durable ingestion pipeline: source
registration, file deposit, ingestion status, issue queue, side-by-side
source/extraction review, and approval gates. After that, the brain API reads only
published versions and measures. The chat, agents and final pages consume that API
instead of querying corpus tables or implementing customs logic directly.
