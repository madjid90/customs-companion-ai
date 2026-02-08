// ============================================================================
// TESTS: verify-otp Edge Function (Integration Tests)
// ============================================================================
// Run with: deno test --allow-net --allow-env supabase/functions/verify-otp/verify-otp_test.ts
// ============================================================================
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("VITE_SUPABASE_URL") || "";
const BASE_URL = `${SUPABASE_URL}/functions/v1/verify-otp`;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") || "";

const headers = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${ANON_KEY}`,
  "apikey": ANON_KEY,
};

Deno.test("verify-otp: rejects missing phone and code", async () => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });

  assertEquals(res.status, 400);
  const data = await res.json();
  assertEquals(data.error, "Numéro et code requis");
});

Deno.test("verify-otp: rejects missing code", async () => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: "+212600000000" }),
  });

  assertEquals(res.status, 400);
  const data = await res.json();
  assertEquals(data.error, "Numéro et code requis");
});

Deno.test("verify-otp: rejects invalid phone format", async () => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: "abc", code: "123456" }),
  });

  assertEquals(res.status, 400);
  const data = await res.json();
  assertEquals(data.error, "Format de numéro invalide");
});

Deno.test("verify-otp: rejects non-6-digit code", async () => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: "+212600000000", code: "123" }),
  });

  assertEquals(res.status, 400);
  const data = await res.json();
  assertEquals(data.error, "Code invalide (6 chiffres requis)");
});

Deno.test("verify-otp: rejects alpha code", async () => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: "+212600000000", code: "abcdef" }),
  });

  assertEquals(res.status, 400);
  const data = await res.json();
  assertEquals(data.error, "Code invalide (6 chiffres requis)");
});

Deno.test("verify-otp: rejects incorrect OTP", async () => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: "+212600000000", code: "000000" }),
  });

  const data = await res.json();
  assertExists(data.error);
  // 401 = incorrect OTP, 404 = user not found, 429 = rate limit
});

Deno.test("verify-otp: handles OPTIONS preflight", async () => {
  const res = await fetch(BASE_URL, {
    method: "OPTIONS",
    headers: { "Origin": "http://localhost:5173" },
  });

  assertEquals(res.status, 204);
});
