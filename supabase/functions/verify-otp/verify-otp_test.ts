// ============================================================================
// TESTS: verify-otp Edge Function (Integration Tests)
// ============================================================================
// Run with: deno test --allow-net --allow-env supabase/functions/verify-otp/verify-otp_test.ts
// ============================================================================
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import "https://deno.land/std@0.224.0/dotenv/load.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("VITE_SUPABASE_URL") || "";

const BASE_URL = `${SUPABASE_URL}/functions/v1/verify-otp`;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") || "";

const headers = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${ANON_KEY}`,
  "apikey": ANON_KEY,
};

Deno.test("verify-otp: rejects missing email", async () => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });

  const status = res.status;
  const data = await res.json();
  // Accept 400 (validation error) or 429 (rate limit)
  if (status === 429) {
    console.log("Rate limited — skipping assertion");
    return;
  }
  assertEquals(status, 400);
  assertEquals(data.error, "Email requis");
});

Deno.test("verify-otp: rejects invalid email format", async () => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "not-an-email" }),
  });

  const status = res.status;
  const data = await res.json();
  if (status === 429) {
    console.log("Rate limited — skipping assertion");
    return;
  }
  assertEquals(status, 400);
  assertEquals(data.error, "Format d'email invalide");
});

Deno.test("verify-otp: rejects missing code when OTP not skipped", async () => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "test@example.com", code: "123" }),
  });

  const status = res.status;
  const data = await res.json();
  if (status === 429) {
    console.log("Rate limited — skipping assertion");
    return;
  }
  assertEquals(status, 400);
  assertEquals(data.error, "Code invalide (6 chiffres requis)");
});

Deno.test("verify-otp: rejects alpha code", async () => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "test@example.com", code: "abcdef" }),
  });

  const status = res.status;
  const data = await res.json();
  if (status === 429) {
    console.log("Rate limited — skipping assertion");
    return;
  }
  assertEquals(status, 400);
  assertEquals(data.error, "Code invalide (6 chiffres requis)");
});

Deno.test("verify-otp: rejects incorrect OTP", async () => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "test@example.com", code: "000000" }),
  });

  const data = await res.json();
  assertExists(data.error);
  // 401 = incorrect OTP, 404 = user not found
});

Deno.test("verify-otp: handles OPTIONS preflight", async () => {
  const res = await fetch(BASE_URL, {
    method: "OPTIONS",
    headers: { "Origin": "http://localhost:5173" },
  });

  assertEquals(res.status, 204);
  await res.text();
});
