#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  const next = process.argv[index + 1];
  if (key.startsWith("--")) {
    args.set(key, next && !next.startsWith("--") ? next : true);
    if (next && !next.startsWith("--")) index += 1;
  }
}

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

const scopes = String(args.get("--scopes") || "extract_tariff").split(",").map((scope) => scope.trim()).filter(Boolean);
const name = String(args.get("--name") || `worker-${scopes.join("-")}-${Date.now()}`);
const expiresDays = Math.max(1, Math.min(30, Number(args.get("--days") || 7)));
const token = `dai_${randomBytes(48).toString("base64url")}`;
const tokenSha256 = createHash("sha256").update(token).digest("hex");
const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString();

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { error } = await db.from("worker_access_tokens").insert({
  name,
  token_sha256: tokenSha256,
  scopes,
  expires_at: expiresAt,
});
if (error) throw new Error(`worker_token_insert:${error.message}`);

process.stdout.write(`${JSON.stringify({ name, scopes, expires_at: expiresAt, token }, null, 2)}\n`);
