import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase before importing authHeaders
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}));

import { getAuthHeaders } from "@/lib/authHeaders";
import { supabase } from "@/integrations/supabase/client";

// =============================================================================
// TESTS: Auth Headers - ensures JWT is used instead of anon key
// =============================================================================

describe("getAuthHeaders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock env vars
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-anon-key");
  });

  it("returns JWT token when session exists", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: {
        session: {
          access_token: "jwt-token-123",
          refresh_token: "refresh-token",
        } as any,
      },
      error: null,
    });

    const headers = await getAuthHeaders(true);

    expect(headers["Authorization"]).toBe("Bearer jwt-token-123");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["apikey"]).toBe("test-anon-key");
  });

  it("throws error when session is required but missing", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await expect(getAuthHeaders(true)).rejects.toThrow(
      "Session expirée. Veuillez vous reconnecter."
    );
  });

  it("falls back to anon key when session is not required", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    });

    const headers = await getAuthHeaders(false);

    expect(headers["Authorization"]).toBe("Bearer test-anon-key");
  });

  it("always includes Content-Type and apikey", async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: {
        session: { access_token: "token" } as any,
      },
      error: null,
    });

    const headers = await getAuthHeaders();

    expect(headers).toHaveProperty("Content-Type", "application/json");
    expect(headers).toHaveProperty("apikey");
  });
});
