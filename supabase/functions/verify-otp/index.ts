import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getCorsHeaders,
  handleCorsPreFlight,
  getClientId,
  checkRateLimitDistributed,
  rateLimitResponse,
} from "../_shared/cors.ts";

// Compute a deterministic password from server secret + phone + unique salt
async function computePassword(secret: string, phone: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = `${secret}:${salt}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyMaterial),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(phone));
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

// Generate a unique salt for a user
function generateSalt(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight(req);
  }

  const corsHeaders = getCorsHeaders(req);

  // Rate limiting: max 10 verify attempts per IP per hour
  const clientId = getClientId(req);
  const rateLimit = await checkRateLimitDistributed(clientId, {
    maxRequests: 10,
    windowMs: 60 * 60 * 1000, // 1 hour
    blockDurationMs: 60 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse(req, rateLimit.resetAt);
  }

  try {
    const { phone, code, displayName } = await req.json();

    if (!phone || !code) {
      return new Response(
        JSON.stringify({ error: "Numéro et code requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedPhone = phone.startsWith("+") ? phone : `+${phone}`;

    if (!/^\+[1-9]\d{6,14}$/.test(normalizedPhone)) {
      return new Response(
        JSON.stringify({ error: "Format de numéro invalide" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!/^\d{6}$/.test(code)) {
      return new Response(
        JSON.stringify({ error: "Code invalide (6 chiffres requis)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Find valid OTP
    const { data: otpRecord, error: otpError } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("phone", normalizedPhone)
      .eq("code", code)
      .eq("is_used", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otpError) {
      console.error("OTP lookup error:", otpError);
      return new Response(
        JSON.stringify({ error: "Erreur interne" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!otpRecord) {
      // Increment attempts on latest OTP for this phone
      const { data: latestOtp } = await supabase
        .from("otp_codes")
        .select("id, attempts")
        .eq("phone", normalizedPhone)
        .eq("is_used", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestOtp) {
        const newAttempts = (latestOtp.attempts || 0) + 1;
        await supabase
          .from("otp_codes")
          .update({ attempts: newAttempts, is_used: newAttempts >= 5 })
          .eq("id", latestOtp.id);
      }

      return new Response(
        JSON.stringify({ error: "Code incorrect ou expiré" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark OTP as used
    await supabase
      .from("otp_codes")
      .update({ is_used: true })
      .eq("id", otpRecord.id);

    // Check if bootstrap (first user)
    const { count: totalUsers } = await supabase
      .from("phone_users")
      .select("*", { count: "exact", head: true });

    let phoneUser;

    if (totalUsers === 0) {
      // Bootstrap: create first manager
      const bootstrapSalt = generateSalt();
      const { data: newUser, error: createError } = await supabase
        .from("phone_users")
        .insert({
          phone: normalizedPhone,
          display_name: displayName || "Manager",
          role: "manager",
          max_invites: 10,
          password_salt: bootstrapSalt,
        })
        .select()
        .single();

      if (createError) {
        console.error("Create manager error:", createError);
        return new Response(
          JSON.stringify({ error: "Erreur lors de la création du compte" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      phoneUser = newUser;
    } else {
      // Get existing phone user
      const { data: existingUser, error: lookupError } = await supabase
        .from("phone_users")
        .select("*")
        .eq("phone", normalizedPhone)
        .maybeSingle();

      if (lookupError || !existingUser) {
        return new Response(
          JSON.stringify({ error: "Utilisateur non trouvé" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      phoneUser = existingUser;
    }

    // Ensure user has a unique salt
    let userSalt = phoneUser.password_salt;
    if (!userSalt) {
      userSalt = generateSalt();
      await supabase
        .from("phone_users")
        .update({ password_salt: userSalt })
        .eq("id", phoneUser.id);
    }

    const email = `${normalizedPhone.replace("+", "")}@phone.douane.app`;
    const password = await computePassword(supabaseServiceKey, normalizedPhone, userSalt);

    let session;

    if (phoneUser.auth_user_id) {
      // User already has auth account, sign in
      const { data: signInData, error: signInError } =
        await supabase.auth.signInWithPassword({ email, password });

      if (signInError) {
        console.error("Sign in error:", signInError);
        // Try to reset password via admin
        const { error: updateError } = await supabase.auth.admin.updateUserById(
          phoneUser.auth_user_id,
          { password }
        );
        if (updateError) {
          console.error("Password update error:", updateError);
          return new Response(
            JSON.stringify({ error: "Erreur de connexion" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // Try sign in again
        const { data: retryData, error: retryError } =
          await supabase.auth.signInWithPassword({ email, password });
        if (retryError) {
          console.error("Retry sign in error:", retryError);
          return new Response(
            JSON.stringify({ error: "Erreur de connexion" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        session = retryData.session;
      } else {
        session = signInData.session;
      }
    } else {
      // Create new auth user
      const { data: createData, error: createError } =
        await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            phone: normalizedPhone,
            display_name: phoneUser.display_name,
            role: phoneUser.role,
          },
        });

      if (createError) {
        console.error("Create auth user error:", createError);
        return new Response(
          JSON.stringify({ error: "Erreur lors de la création du compte" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update phone_user with auth_user_id
      await supabase
        .from("phone_users")
        .update({ auth_user_id: createData.user.id })
        .eq("id", phoneUser.id);

      // Add user_roles entry
      await supabase.from("user_roles").insert({
        user_id: createData.user.id,
        role: phoneUser.role,
      });

      // Sign in to get session
      const { data: signInData, error: signInError } =
        await supabase.auth.signInWithPassword({ email, password });

      if (signInError) {
        console.error("Post-create sign in error:", signInError);
        return new Response(
          JSON.stringify({ error: "Compte créé mais erreur de connexion" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      session = signInData.session;
    }

    if (!session) {
      return new Response(
        JSON.stringify({ error: "Erreur de session" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        session: {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_in: session.expires_in,
        },
        user: {
          id: phoneUser.id,
          phone: phoneUser.phone,
          display_name: phoneUser.display_name,
          role: phoneUser.role,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("verify-otp error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur inconnue" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});