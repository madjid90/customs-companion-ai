import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, displayName } = await req.json();

    if (!phone || typeof phone !== "string") {
      return new Response(
        JSON.stringify({ error: "Numéro de téléphone requis" }),
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

    // Validate display name
    const name = (displayName || "").trim().slice(0, 100);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Get the manager from the auth token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Non authentifié" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !authUser) {
      return new Response(
        JSON.stringify({ error: "Token invalide" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the caller is a manager
    const { data: manager, error: managerError } = await supabase
      .from("phone_users")
      .select("*")
      .eq("auth_user_id", authUser.id)
      .eq("role", "manager")
      .eq("is_active", true)
      .maybeSingle();

    if (managerError || !manager) {
      return new Response(
        JSON.stringify({ error: "Seuls les managers peuvent inviter des agents" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check invite limit (count existing agents invited by this manager)
    const { count: agentCount } = await supabase
      .from("phone_users")
      .select("*", { count: "exact", head: true })
      .eq("invited_by", manager.id)
      .eq("role", "agent");

    const maxInvites = manager.max_invites || 2;
    if ((agentCount || 0) >= maxInvites) {
      return new Response(
        JSON.stringify({
          error: `Limite d'invitations atteinte (${maxInvites} agents maximum)`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if phone already exists
    const { data: existingUser } = await supabase
      .from("phone_users")
      .select("id")
      .eq("phone", normalizedPhone)
      .maybeSingle();

    if (existingUser) {
      return new Response(
        JSON.stringify({ error: "Ce numéro est déjà enregistré" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create phone_user entry for the agent
    const { data: newAgent, error: insertError } = await supabase
      .from("phone_users")
      .insert({
        phone: normalizedPhone,
        display_name: name || null,
        role: "agent",
        invited_by: manager.id,
        max_invites: 0,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert agent error:", insertError);
      return new Response(
        JSON.stringify({ error: "Erreur lors de la création de l'invitation" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send invitation SMS via Twilio
    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioPhone = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (twilioSid && twilioToken && twilioPhone) {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
      const twilioAuth = btoa(`${twilioSid}:${twilioToken}`);

      const managerName = manager.display_name || "votre manager";
      const smsBody = `${managerName} vous invite à rejoindre DouaneAI. Connectez-vous avec ce numéro sur l'application pour accéder à l'assistant douanier.`;

      try {
        const twilioResponse = await fetch(twilioUrl, {
          method: "POST",
          headers: {
            Authorization: `Basic ${twilioAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: normalizedPhone,
            From: twilioPhone,
            Body: smsBody,
          }),
        });

        if (!twilioResponse.ok) {
          const errorText = await twilioResponse.text();
          console.error("Twilio SMS error:", errorText);
          // Don't fail the invitation, just log the error
        }
      } catch (smsError) {
        console.error("SMS sending failed:", smsError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        agent: {
          id: newAgent.id,
          phone: newAgent.phone,
          display_name: newAgent.display_name,
          role: newAgent.role,
          created_at: newAgent.created_at,
        },
        message: "Agent invité avec succès",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("invite-agent error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur inconnue" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
