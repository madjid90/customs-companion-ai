// ============================================================================
// TESTS: invite-agent Edge Function (Integration Tests)
// ============================================================================
// Run with: deno test --allow-net --allow-env supabase/functions/invite-agent/invite-agent_test.ts
// ============================================================================
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("VITE_SUPABASE_URL") || "";
const BASE_URL = `${SUPABASE_URL}/functions/v1/invite-agent`;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") || "";

const headers = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${ANON_KEY}`,
  "apikey": ANON_KEY,
};

Deno.test("invite-agent: rejects missing phone", async () => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });

  assertEquals(res.status, 400);
  const data = await res.json();
  assertEquals(data.error, "Numéro de téléphone requis");
});

Deno.test("invite-agent: rejects invalid phone format", async () => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: "abc" }),
  });

  assertEquals(res.status, 400);
  const data = await res.json();
  assertEquals(data.error, "Format de numéro invalide");
});

Deno.test("invite-agent: rejects unauthenticated request", async () => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "+212600000001" }),
  });

  assertEquals(res.status, 401);
  const data = await res.json();
  assertEquals(data.error, "Non authentifié");
});

Deno.test("invite-agent: rejects non-manager token", async () => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: "+212600000001" }),
  });

  const data = await res.json();
  assertExists(data.error);
  // 401 = invalid token or 403 = not a manager
  assertEquals(res.status >= 401 && res.status <= 403, true);
});

Deno.test("invite-agent: handles OPTIONS preflight", async () => {
  const res = await fetch(BASE_URL, {
    method: "OPTIONS",
    headers: { "Origin": "http://localhost:5173" },
  });

  assertEquals(res.status, 204);
});
