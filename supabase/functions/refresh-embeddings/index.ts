// ============================================================================
// JOB DE RAFRAÎCHISSEMENT DES EMBEDDINGS
// ============================================================================
// Appelé périodiquement pour mettre à jour les embeddings manquants ou obsolètes
// Traite: hs_codes, knowledge_documents, tariff_notes, legal_chunks

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { callOpenAIWithRetry } from "../_shared/retry.ts";

const BATCH_SIZE = 20;   // Documents par batch
const MAX_BATCHES = 25;  // Maximum de batches par exécution (500 docs max)

interface RefreshResult {
  table: string;
  found: number;
  processed: number;
  updated: number;
  errors: number;
  error_details?: string[];
}

// ============================================================================
// EMBEDDING GENERATION (batch)
// ============================================================================

async function generateEmbeddingsBatch(
  texts: string[],
  apiKey: string
): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];

  try {
    const response = await callOpenAIWithRetry(
      apiKey,
      "embeddings",
      {
        model: "text-embedding-3-small",
        input: texts.map(t => t.substring(0, 8000)),
        dimensions: 1536,
      },
      15000
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[refresh-embeddings] OpenAI error ${response.status}: ${errorText}`);
      return texts.map(() => null);
    }

    const data = await response.json();
    return data.data.map((d: { embedding: number[] }) => d.embedding);
  } catch (e) {
    console.error("[refresh-embeddings] Batch embedding error:", e);
    return texts.map(() => null);
  }
}

// ============================================================================
// TABLE CONFIGS
// ============================================================================

interface TableConfig {
  name: string;
  textField: string;
  idField: string;
  idType: 'uuid' | 'int';
  textBuilder: (row: any) => string;
  hasIsActive: boolean;
}

const TABLE_CONFIGS: TableConfig[] = [
  {
    name: 'hs_codes',
    textField: 'description_fr',
    idField: 'id',
    idType: 'uuid',
    textBuilder: (row) => `Code SH ${row.code}: ${row.description_fr || ''} ${row.description_en || ''}`,
    hasIsActive: true,
  },
  {
    name: 'knowledge_documents',
    textField: 'content',
    idField: 'id',
    idType: 'uuid',
    textBuilder: (row) => `${row.title} (${row.category || 'document'}): ${row.content?.substring(0, 6000) || ''}`,
    hasIsActive: true,
  },
  {
    name: 'tariff_notes',
    textField: 'note_text',
    idField: 'id',
    idType: 'int',
    textBuilder: (row) => `Note tarifaire ${row.note_type} (chapitre ${row.chapter_number || ''}): ${row.note_text || ''}`,
    hasIsActive: false,
  },
  {
    name: 'legal_chunks',
    textField: 'chunk_text',
    idField: 'id',
    idType: 'int',
    textBuilder: (row) => `${row.article_number ? `Article ${row.article_number}` : ''} ${row.section_title || ''}: ${row.chunk_text || ''}`,
    hasIsActive: true,
  },
];

// ============================================================================
// REFRESH A TABLE
// ============================================================================

async function refreshTable(
  supabase: any,
  config: TableConfig,
  apiKey: string,
  forceUpdate: boolean = false
): Promise<RefreshResult> {
  const result: RefreshResult = {
    table: config.name,
    found: 0,
    processed: 0,
    updated: 0,
    errors: 0,
    error_details: [],
  };

  // Select columns based on table
  const selectColumns = getSelectColumns(config);

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    // Build query for records missing embeddings
    let query = supabase
      .from(config.name)
      .select(selectColumns)
      .is('embedding', null)
      .limit(BATCH_SIZE);

    if (config.hasIsActive) {
      query = query.eq('is_active', true);
    }

    if (forceUpdate && batch === 0) {
      // For force update, remove the embedding IS NULL filter
      query = supabase
        .from(config.name)
        .select(selectColumns)
        .limit(BATCH_SIZE);
      if (config.hasIsActive) {
        query = query.eq('is_active', true);
      }
    }

    const { data: docs, error } = await query;

    if (error) {
      console.error(`[refresh-embeddings] ${config.name} query error:`, error);
      result.errors++;
      result.error_details!.push(`Query error: ${error.message}`);
      break;
    }

    if (!docs || docs.length === 0) {
      if (batch === 0) {
        console.log(`[refresh-embeddings] ${config.name}: No documents need embedding`);
      }
      break;
    }

    if (batch === 0) {
      result.found = docs.length; // Approximate, first batch only
    }

    console.log(`[refresh-embeddings] ${config.name}: Batch ${batch + 1} (${docs.length} docs)`);

    // Build texts for embedding
    const texts: string[] = [];
    const validDocs: any[] = [];
    for (const doc of docs) {
      const text = config.textBuilder(doc);
      if (text && text.trim().length >= 10) {
        texts.push(text);
        validDocs.push(doc);
      }
    }

    if (texts.length === 0) {
      console.log(`[refresh-embeddings] ${config.name}: No valid texts in batch`);
      break;
    }

    // Generate embeddings in sub-batches of 20 (OpenAI limit)
    const subBatchSize = 20;
    for (let i = 0; i < texts.length; i += subBatchSize) {
      const subTexts = texts.slice(i, i + subBatchSize);
      const subDocs = validDocs.slice(i, i + subBatchSize);

      const embeddings = await generateEmbeddingsBatch(subTexts, apiKey);

      for (let j = 0; j < subDocs.length; j++) {
        result.processed++;
        const embedding = embeddings[j];
        if (!embedding) {
          result.errors++;
          continue;
        }

        const embeddingString = `[${embedding.join(',')}]`;
        const updateData: any = { embedding: embeddingString };

        // Add embedding_updated_at if the table has it
        if (config.name === 'hs_codes' || config.name === 'knowledge_documents' || config.name === 'tariff_notes') {
          updateData.embedding_updated_at = new Date().toISOString();
        }

        const { error: updateError } = await supabase
          .from(config.name)
          .update(updateData)
          .eq(config.idField, subDocs[j][config.idField]);

        if (updateError) {
          result.errors++;
          result.error_details!.push(`Update ${subDocs[j][config.idField]}: ${updateError.message}`);
        } else {
          result.updated++;
        }
      }

      // Rate limiting between sub-batches
      await new Promise(r => setTimeout(r, 200));
    }

    // Pause between batches
    if (docs.length === BATCH_SIZE) {
      await new Promise(r => setTimeout(r, 500));
    } else {
      break; // Last batch was partial, no more to process
    }
  }

  // Clean error details if too many
  if (result.error_details!.length > 10) {
    result.error_details = [
      ...result.error_details!.slice(0, 10),
      `... and ${result.error_details!.length - 10} more errors`,
    ];
  }

  return result;
}

function getSelectColumns(config: TableConfig): string {
  switch (config.name) {
    case 'hs_codes':
      return 'id, code, description_fr, description_en';
    case 'knowledge_documents':
      return 'id, title, content, category';
    case 'tariff_notes':
      return 'id, note_type, note_text, chapter_number';
    case 'legal_chunks':
      return 'id, chunk_text, article_number, section_title';
    default:
      return 'id';
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return handleCorsPreFlight(req);
  }

  const startTime = Date.now();

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'Missing configuration (SUPABASE_URL, SERVICE_ROLE_KEY, or OPENAI_API_KEY)' }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Parse optional params
  let targetTable: string | null = null;
  let forceUpdate = false;

  try {
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      targetTable = body.table || null;
      forceUpdate = body.forceUpdate || false;
    } else {
      const url = new URL(req.url);
      targetTable = url.searchParams.get('table');
      forceUpdate = url.searchParams.get('force') === 'true';
    }
  } catch {
    // Ignore parse errors, use defaults
  }

  // Validate target table
  const validTableNames = TABLE_CONFIGS.map(t => t.name);
  if (targetTable && !validTableNames.includes(targetTable)) {
    return new Response(
      JSON.stringify({ error: `Invalid table. Must be one of: ${validTableNames.join(', ')}` }),
      { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }

  console.log(`[refresh-embeddings] Starting. Target: ${targetTable || 'all'}, Force: ${forceUpdate}`);

  const results: RefreshResult[] = [];

  for (const config of TABLE_CONFIGS) {
    if (targetTable && config.name !== targetTable) continue;

    console.log(`[refresh-embeddings] Processing ${config.name}...`);
    const result = await refreshTable(supabase, config, OPENAI_API_KEY, forceUpdate);
    results.push(result);
    console.log(`[refresh-embeddings] ${config.name}: ${result.updated}/${result.processed} updated, ${result.errors} errors`);
  }

  const totalUpdated = results.reduce((sum, r) => sum + r.updated, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
  const totalProcessed = results.reduce((sum, r) => sum + r.processed, 0);
  const durationMs = Date.now() - startTime;

  console.log(`[refresh-embeddings] Complete in ${durationMs}ms. Updated: ${totalUpdated}, Errors: ${totalErrors}`);

  return new Response(
    JSON.stringify({
      success: true,
      duration_ms: durationMs,
      results,
      summary: {
        total_processed: totalProcessed,
        total_updated: totalUpdated,
        total_errors: totalErrors,
      },
    }),
    {
      headers: {
        ...getCorsHeaders(req),
        'Content-Type': 'application/json',
      },
    }
  );
});
