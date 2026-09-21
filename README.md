# Douane AI

Assistant douanier marocain pour la classification SH, l'analyse juridique, la gestion des dossiers import/export et la génération de livrables sourcés.

## Architecture

- **Application** : React, TypeScript, Vite et shadcn/ui
- **Données et authentification** : Supabase Postgres, Auth, Storage et Edge Functions
- **IA** : OpenAI pour le chat, la vision, l'extraction structurée et les embeddings; Anthropic peut être activé pour l'analyse PDF longue
- **Déploiement** : Vercel pour l'application et Supabase pour le backend

Le corpus sépare les sources officielles, documents immuables, exécutions d'ingestion, textes juridiques versionnés, dispositions, relations, nomenclatures SH et mesures réglementaires. Les données client sont isolées par organisation avec RLS.

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
