import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getCorsHeaders,
  handleCorsPreFlight,
  checkRateLimitDistributed,
  rateLimitResponse,
  getClientId,
  errorResponse,
  successResponse,
} from "../_shared/cors.ts";
import { validateGenerateEmbeddingsRequest } from "../_shared/validation.ts";
import { callOpenAIWithRetry } from "../_shared/retry.ts";
import { createLogger } from "../_shared/logger.ts";

// Generate embedding using OpenAI API with retry
async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await callOpenAIWithRetry(
    apiKey,
    "embeddings",
    {
      model: "text-embedding-3-small",
      input: text.substring(0, 8000),
      dimensions: 1536,
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

// Process batch of texts into embeddings with retry
async function generateEmbeddingsBatch(
  texts: string[],
  apiKey: string
): Promise<number[][]> {
  const response = await callOpenAIWithRetry(
    apiKey,
    "embeddings",
    {
      model: "text-embedding-3-small",
      input: texts.map(t => t.substring(0, 8000)),
      dimensions: 1536,
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data.map((d: { embedding: number[] }) => d.embedding);
}

serve(async (req) => {
  const logger = createLogger("generate-embeddings", req);
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight(req);
  }

  // Rate limiting distribué (10 requests per minute for batch processing)
  const clientId = getClientId(req);
  const rateLimit = await checkRateLimitDistributed(clientId, {
    maxRequests: 10,
    windowMs: 60000,
    blockDurationMs: 60000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse(req, rateLimit.resetAt);
  }

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch (e) {
      return errorResponse(req, "Body JSON invalide", 400);
    }

    const validation = validateGenerateEmbeddingsRequest(body);
    if (!validation.valid) {
      return errorResponse(req, validation.error!, 400);
    }

    const { table, limit = 500, forceUpdate = false } = validation.data!;
    logger.info("Starting embeddings generation", { table, limit, forceUpdate });

    // Validate table parameter to prevent injection
    const validTables = ["hs_codes", "knowledge_documents", "pdf_extractions", "veille_documents"];
    if (table && !validTables.includes(table)) {
      return errorResponse(req, `Invalid table. Must be one of: ${validTables.join(", ")}`, 400);
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!OPENAI_API_KEY) {
      return errorResponse(req, "OPENAI_API_KEY is not configured", 500);
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const results: {
      table: string;
      processed: number;
      errors: number;
      details: string[];
    } = {
      table: table || "all",
      processed: 0,
      errors: 0,
      details: [],
    };

    // Process HS codes
    if (!table || table === "hs_codes") {
      try {
        let query = supabase
          .from("hs_codes")
          .select("id, code, description_fr, description_en")
          .eq("is_active", true)
          .limit(limit);

        if (!forceUpdate) {
          query = query.is("embedding", null);
        }

        const { data: hsCodes, error } = await query;

        if (error) throw error;

        if (hsCodes && hsCodes.length > 0) {
          // Process in batches of 20
          const batchSize = 20;
          for (let i = 0; i < hsCodes.length; i += batchSize) {
            const batch = hsCodes.slice(i, i + batchSize);
            const texts = batch.map((hs) =>
              `Code SH ${hs.code}: ${hs.description_fr || ""} ${hs.description_en || ""}`
            );

            try {
              const embeddings = await generateEmbeddingsBatch(texts, OPENAI_API_KEY);

              for (let j = 0; j < batch.length; j++) {
                const { error: updateError } = await supabase
                  .from("hs_codes")
                  .update({
                    embedding: embeddings[j],
                    embedding_updated_at: new Date().toISOString(),
                  })
                  .eq("id", batch[j].id);

                if (updateError) {
                  results.errors++;
                  results.details.push(`hs_codes ${batch[j].code}: ${updateError.message}`);
                } else {
                  results.processed++;
                }
              }
            } catch (batchError) {
              results.errors += batch.length;
              results.details.push(`hs_codes batch error: ${batchError}`);
            }

            // Rate limiting
            await new Promise((r) => setTimeout(r, 500));
          }
        }
        results.details.push(`hs_codes: ${hsCodes?.length || 0} found, ${results.processed} processed`);
      } catch (e) {
        results.details.push(`hs_codes error: ${e}`);
      }
    }

    // Process knowledge documents
    if (!table || table === "knowledge_documents") {
      const startProcessed = results.processed;
      try {
        let query = supabase
          .from("knowledge_documents")
          .select("id, title, content, category")
          .eq("is_active", true)
          .limit(limit);

        if (!forceUpdate) {
          query = query.is("embedding", null);
        }

        const { data: docs, error } = await query;

        if (error) throw error;

        if (docs && docs.length > 0) {
          const batchSize = 10;
          for (let i = 0; i < docs.length; i += batchSize) {
            const batch = docs.slice(i, i + batchSize);
            const texts = batch.map((doc) =>
              `${doc.title} (${doc.category || "document"}): ${doc.content?.substring(0, 6000) || ""}`
            );

            try {
              const embeddings = await generateEmbeddingsBatch(texts, OPENAI_API_KEY);

              for (let j = 0; j < batch.length; j++) {
                const { error: updateError } = await supabase
                  .from("knowledge_documents")
                  .update({
                    embedding: embeddings[j],
                    embedding_updated_at: new Date().toISOString(),
                  })
                  .eq("id", batch[j].id);

                if (updateError) {
                  results.errors++;
                } else {
                  results.processed++;
                }
              }
            } catch (batchError) {
              results.errors += batch.length;
            }

            await new Promise((r) => setTimeout(r, 500));
          }
        }
        results.details.push(`knowledge_documents: ${docs?.length || 0} found, ${results.processed - startProcessed} processed`);
      } catch (e) {
        results.details.push(`knowledge_documents error: ${e}`);
      }
    }

    // Process PDF extractions
    if (!table || table === "pdf_extractions") {
      const startProcessed = results.processed;
      try {
        let query = supabase
          .from("pdf_extractions")
          .select("id, summary, extracted_text, key_points")
          .limit(limit);

        if (!forceUpdate) {
          query = query.is("embedding", null);
        }

        const { data: extractions, error } = await query;

        if (error) throw error;

        if (extractions && extractions.length > 0) {
          const batchSize = 5; // Smaller batch for larger texts
          for (let i = 0; i < extractions.length; i += batchSize) {
            const batch = extractions.slice(i, i + batchSize);
            const texts = batch.map((ext) => {
              const keyPointsText = ext.key_points?.join(". ") || "";
              return `${ext.summary || ""} ${keyPointsText} ${ext.extracted_text?.substring(0, 5000) || ""}`;
            });

            try {
              const embeddings = await generateEmbeddingsBatch(texts, OPENAI_API_KEY);

              for (let j = 0; j < batch.length; j++) {
                const { error: updateError } = await supabase
                  .from("pdf_extractions")
                  .update({
                    embedding: embeddings[j],
                    embedding_updated_at: new Date().toISOString(),
                  })
                  .eq("id", batch[j].id);

                if (updateError) {
                  results.errors++;
                } else {
                  results.processed++;
                }
              }
            } catch (batchError) {
              results.errors += batch.length;
            }

            await new Promise((r) => setTimeout(r, 1000));
          }
        }
        results.details.push(`pdf_extractions: ${extractions?.length || 0} found, ${results.processed - startProcessed} processed`);
      } catch (e) {
        results.details.push(`pdf_extractions error: ${e}`);
      }
    }

    // Process veille documents
    if (!table || table === "veille_documents") {
      const startProcessed = results.processed;
      try {
        let query = supabase
          .from("veille_documents")
          .select("id, title, summary, content, category")
          .eq("status", "approved")
          .limit(limit);

        if (!forceUpdate) {
          query = query.is("embedding", null);
        }

        const { data: veilleD, error } = await query;

        if (error) throw error;

        if (veilleD && veilleD.length > 0) {
          const batchSize = 10;
          for (let i = 0; i < veilleD.length; i += batchSize) {
            const batch = veilleD.slice(i, i + batchSize);
            const texts = batch.map((doc) =>
              `${doc.title} (${doc.category || "veille"}): ${doc.summary || ""} ${doc.content?.substring(0, 5000) || ""}`
            );

            try {
              const embeddings = await generateEmbeddingsBatch(texts, OPENAI_API_KEY);

              for (let j = 0; j < batch.length; j++) {
                const { error: updateError } = await supabase
                  .from("veille_documents")
                  .update({
                    embedding: embeddings[j],
                    embedding_updated_at: new Date().toISOString(),
                  })
                  .eq("id", batch[j].id);

                if (updateError) {
                  results.errors++;
                } else {
                  results.processed++;
                }
              }
            } catch (batchError) {
              results.errors += batch.length;
            }

            await new Promise((r) => setTimeout(r, 500));
          }
        }
        results.details.push(`veille_documents: ${veilleD?.length || 0} found, ${results.processed - startProcessed} processed`);
      } catch (e) {
        results.details.push(`veille_documents error: ${e}`);
      }
    }

    return successResponse(req, {
      success: true,
      results,
    });
  } catch (error) {
    console.error("Generate embeddings error:", error);
    return errorResponse(req, "Erreur lors de la génération des embeddings", 500);
  }
});
