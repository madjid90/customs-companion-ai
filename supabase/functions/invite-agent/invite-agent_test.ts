// ============================================================================
// TESTS: invite-agent Edge Function (Unit Tests)
// ============================================================================
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || "";
const BASE_URL = `${SUPABASE_URL}/functions/v1/invite-agent`;
const ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") || "";

const headers = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${ANON_KEY}`,
  "apikey": ANON_KEY,
};

Deno.test("invite-agent: rejects missing email", async () => {
  if (!SUPABASE_URL) return; // skip if no env
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });

  const data = await res.json();
  assertExists(data.error);
  assertEquals(res.status, 400);
});

Deno.test("invite-agent: rejects invalid email format", async () => {
  if (!SUPABASE_URL) return;
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "not-an-email" }),
  });

  const data = await res.json();
  assertExists(data.error);
  assertEquals(res.status, 400);
});

Deno.test("invite-agent: rejects unauthenticated request", async () => {
  if (!SUPABASE_URL) return;
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "test@example.com" }),
  });

  const data = await res.json();
  assertExists(data.error);
  assertEquals(res.status >= 401 && res.status <= 403, true);
});
