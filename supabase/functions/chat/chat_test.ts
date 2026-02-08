import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// =============================================================================
// TESTS: Chat Edge Function - Request validation & security
// =============================================================================

// Simulate the validateChatRequest logic
function validateChatRequest(body: unknown): { valid: boolean; error?: string; data?: any } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Body must be a JSON object" };
  }

  const { question, sessionId, images, pdfDocuments, conversationHistory } = body as any;

  // Question validation
  if (question !== undefined && question !== null) {
    if (typeof question !== "string") {
      return { valid: false, error: "Question must be a string" };
    }
    if (question.length > 10000) {
      return { valid: false, error: "Question too long (max 10000 chars)" };
    }
  }

  // Session ID validation
  if (sessionId) {
    if (typeof sessionId !== "string") {
      return { valid: false, error: "sessionId must be a string" };
    }
    // UUID format check
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(sessionId)) {
      return { valid: false, error: "sessionId must be a valid UUID" };
    }
  }

  return {
    valid: true,
    data: { question, sessionId, images, pdfDocuments, conversationHistory },
  };
}

// Simulate URL stripping
function stripUrlsFromResponse(text: string): string {
  if (!text) return text;
  
  return text
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/https?:\/\/[a-z0-9-]+\.supabase\.co\/[^\s"'<>\])}]+/gi, '[source validée ci-dessous]')
    .replace(/(?<![`])https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9()@:%_+.~#?&/=]*(?![`])/gi, (match) => {
      const allowedDomains = ['douane.gov.ma', 'adii.gov.ma', 'ompic.ma'];
      const isAllowed = allowedDomains.some(domain => match.includes(domain));
      return isAllowed ? match : '[voir sources ci-dessous]';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// =============================================================================
// Request Validation Tests
// =============================================================================

Deno.test("validates question as a string", () => {
  const result = validateChatRequest({ question: "Quel est le DDI pour le code 8471?" });
  assertEquals(result.valid, true);
  assertEquals(result.data?.question, "Quel est le DDI pour le code 8471?");
});

Deno.test("rejects non-string question", () => {
  const result = validateChatRequest({ question: 12345 });
  assertEquals(result.valid, false);
  assertEquals(result.error, "Question must be a string");
});

Deno.test("rejects question that's too long", () => {
  const longQuestion = "a".repeat(10001);
  const result = validateChatRequest({ question: longQuestion });
  assertEquals(result.valid, false);
});

Deno.test("accepts question at max length", () => {
  const maxQuestion = "a".repeat(10000);
  const result = validateChatRequest({ question: maxQuestion });
  assertEquals(result.valid, true);
});

Deno.test("validates proper UUID sessionId", () => {
  const result = validateChatRequest({
    question: "test",
    sessionId: "550e8400-e29b-41d4-a716-446655440000",
  });
  assertEquals(result.valid, true);
});

Deno.test("rejects invalid sessionId format", () => {
  const result = validateChatRequest({
    question: "test",
    sessionId: "not-a-valid-uuid",
  });
  assertEquals(result.valid, false);
});

Deno.test("rejects null body", () => {
  const result = validateChatRequest(null);
  assertEquals(result.valid, false);
});

Deno.test("rejects non-object body", () => {
  const result = validateChatRequest("just a string");
  assertEquals(result.valid, false);
});

Deno.test("accepts body with images array", () => {
  const result = validateChatRequest({
    question: "Identifie ce produit",
    images: [{ type: "image", base64: "abc123", mediaType: "image/jpeg" }],
  });
  assertEquals(result.valid, true);
  assertEquals(result.data?.images?.length, 1);
});

Deno.test("accepts body with pdfDocuments array", () => {
  const result = validateChatRequest({
    question: "Analyse ce document",
    pdfDocuments: [{ type: "pdf", base64: "abc", fileName: "test.pdf" }],
  });
  assertEquals(result.valid, true);
  assertEquals(result.data?.pdfDocuments?.length, 1);
});

// =============================================================================
// URL Stripping Tests (Anti-hallucination)
// =============================================================================

Deno.test("strips markdown links from AI response", () => {
  const input = "Voir [ce document](https://example.com/doc.pdf) pour plus.";
  const result = stripUrlsFromResponse(input);
  assertEquals(result.includes("](https://"), false);
  assertEquals(result.includes("ce document"), true);
});

Deno.test("strips Supabase storage URLs", () => {
  const input = "URL: https://mefyrysrlmzzcsyyysqp.supabase.co/storage/v1/object/test.pdf";
  const result = stripUrlsFromResponse(input);
  assertEquals(result.includes("supabase.co"), false);
  assertEquals(result.includes("[source validée ci-dessous]"), true);
});

Deno.test("preserves official government URLs", () => {
  const input = "Consultez https://www.douane.gov.ma pour plus d'informations.";
  const result = stripUrlsFromResponse(input);
  assertEquals(result.includes("douane.gov.ma"), true);
});

Deno.test("strips random external URLs", () => {
  const input = "Voir https://random-site.com/info pour détails.";
  const result = stripUrlsFromResponse(input);
  assertEquals(result.includes("random-site.com"), false);
  assertEquals(result.includes("[voir sources ci-dessous]"), true);
});

Deno.test("handles empty string input", () => {
  assertEquals(stripUrlsFromResponse(""), "");
});

Deno.test("preserves ADII URLs", () => {
  const input = "Source: https://adii.gov.ma/circulaire-123";
  const result = stripUrlsFromResponse(input);
  assertEquals(result.includes("adii.gov.ma"), true);
});

Deno.test("collapses excessive newlines after stripping", () => {
  const input = "Ligne 1\n\n\n\n\nLigne 2";
  const result = stripUrlsFromResponse(input);
  assertEquals(result, "Ligne 1\n\nLigne 2");
});
