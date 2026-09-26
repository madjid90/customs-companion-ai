# Douane AI

Assistant douanier marocain centré sur un cerveau réglementaire unique : classification SH, analyse juridique, contexte réglementaire, gestion des dossiers import/export et génération de livrables sourcés.

## Architecture

Le produit central est le cerveau douanier : ingestion fiable, données canoniques,
graphe de contexte, règles métier et API versionnée. L'application web est un
consommateur de ce cerveau, comme WhatsApp, les agents métier, ERP/TMS, MCP ou
SDK. Les pages ne doivent pas contenir de logique douanière en dur.

- **Application consommatrice** : React, TypeScript, Vite et shadcn/ui
- **Données et authentification** : Supabase Postgres, Auth, Storage et Edge Functions
- **IA** : OpenAI pour le chat, la vision, l'extraction structurée et les embeddings; Anthropic peut être activé pour l'analyse PDF longue
- **Déploiement** : Vercel pour l'application et Supabase pour le backend

Le corpus sépare les sources officielles, documents immuables, exécutions d'ingestion, textes juridiques versionnés, dispositions, relations, nomenclatures SH et mesures réglementaires. Les données client sont isolées par organisation avec RLS.

La documentation faisant autorité pour le cerveau douanier se trouve dans
[`docs/architecture`](docs/architecture/README.md). Tout agent de développement
doit commencer par lire [`AGENTS.md`](AGENTS.md).

## Développement local

```bash
npm install
npm run dev
```

Variables frontend requises :

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Secrets Supabase Edge Functions : `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL` et, si l'analyse PDF Claude est utilisée, `ANTHROPIC_API_KEY`.

## Contrôles

```bash
npm run lint
npm test
npm run build
```

Les migrations sont dans `supabase/migrations`, les fonctions dans `supabase/functions` et les contrats du cerveau douanier dans `docs/architecture`.
