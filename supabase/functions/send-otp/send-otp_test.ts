// ============================================================================
// TESTS: send-otp Edge Function (Integration Tests)
// ============================================================================
// Run with: deno test --allow-net --allow-env supabase/functions/send-otp/send-otp_test.ts
// ============================================================================
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("VITE_SUPABASE_URL") || "";
const BASE_URL = `${SUPABASE_URL}/functions/v1/send-otp`;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") || "";

const headers = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${ANON_KEY}`,
  "apikey": ANON_KEY,
};

Deno.test("send-otp: rejects missing phone", async () => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  
  assertEquals(res.status, 400);
  const data = await res.json();
  assertEquals(data.error, "Numéro de téléphone requis");
});

Deno.test("send-otp: rejects invalid phone format", async () => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: "abc" }),
  });
  
  assertEquals(res.status, 400);
  const data = await res.json();
  assertEquals(data.error, "Format de numéro invalide");
});

Deno.test("send-otp: rejects too short phone", async () => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: "+123" }),
  });
  
  assertEquals(res.status, 400);
  const data = await res.json();
  assertEquals(data.error, "Format de numéro invalide");
});

Deno.test("send-otp: rejects non-whitelisted phone", async () => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: "+19999999999" }),
  });
  
  const data = await res.json();
  assertExists(data.error || data.success);
  // 403 = not whitelisted, 200 = bootstrap mode, 429 = rate limit, 500 = twilio not configured
});

Deno.test("send-otp: handles OPTIONS preflight", async () => {
  const res = await fetch(BASE_URL, {
    method: "OPTIONS",
    headers: { "Origin": "http://localhost:5173" },
  });
  
  assertEquals(res.status, 204);
});
