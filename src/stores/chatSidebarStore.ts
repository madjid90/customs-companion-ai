import { create } from "zustand";
import { persist } from "zustand/middleware";
import { supabase } from "@/integrations/supabase/client";

export interface SidebarCitation {
  id: string;
  messageId: string;
  reference_type?: string;
  reference_number?: string;
  title?: string;
  pdf_title?: string;
  page_number?: number;
  download_url?: string;
  reference_date?: string;
  validated?: boolean;
  addedAt: number;
}

export interface SavedResponse {
  id: string; // db row id (uuid) when synced; falls back to message id locally
  messageId?: string; // original chat message id (local)
  conversationId?: string;
  question: string;
  response: string;
  sessionId?: string;
  citedCirculars?: SidebarCitation[];
  savedAt: number;
  synced?: boolean;
}

type SidebarTab = "citations" | "saved";

interface ChatSidebarState {
  // UI state
  isOpen: boolean;
  activeTab: SidebarTab;
  sizePct: number;
  // Data
  citations: SidebarCitation[];
  savedResponses: SavedResponse[];
  isLoadingSaved: boolean;
  // Actions
  toggle: () => void;
  setOpen: (open: boolean) => void;
  setActiveTab: (tab: SidebarTab) => void;
  setSizePct: (pct: number) => void;
  addCitations: (items: SidebarCitation[]) => void;
  removeCitation: (id: string) => void;
  clearCitations: () => void;
  // Saved responses (persisted to Supabase)
  loadSavedResponses: () => Promise<void>;
  saveResponse: (input: Omit<SavedResponse, "savedAt" | "synced">) => Promise<void>;
  removeSavedResponse: (id: string) => Promise<void>;
}

export const useChatSidebarStore = create<ChatSidebarState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      activeTab: "citations",
      sizePct: 32,
      citations: [],
      savedResponses: [],
      isLoadingSaved: false,
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
      setOpen: (open) => set({ isOpen: open }),
      setActiveTab: (tab) => set({ activeTab: tab, isOpen: true }),
      setSizePct: (pct) => set({ sizePct: pct }),
      addCitations: (items) =>
        set((s) => {
          const existing = new Set(s.citations.map((c) => c.id));
          const merged = [...s.citations, ...items.filter((i) => !existing.has(i.id))];
          return { citations: merged };
        }),
      removeCitation: (id) =>
        set((s) => ({ citations: s.citations.filter((c) => c.id !== id) })),
      clearCitations: () => set({ citations: [] }),

      loadSavedResponses: async () => {
        set({ isLoadingSaved: true });
        try {
          const { data, error } = await supabase
            .from("saved_responses")
            .select("id, conversation_id, session_id, question, response, cited_circulars, created_at")
            .order("created_at", { ascending: false })
            .limit(200);
          if (error) throw error;
          const mapped: SavedResponse[] = (data || []).map((r) => ({
            id: r.id,
            conversationId: r.conversation_id || undefined,
            sessionId: r.session_id || undefined,
            question: r.question || "",
            response: r.response || "",
            citedCirculars: (r.cited_circulars as SidebarCitation[] | null) || undefined,
            savedAt: new Date(r.created_at).getTime(),
            synced: true,
          }));
          set({ savedResponses: mapped });
        } catch (e) {
          console.error("[chatSidebarStore] loadSavedResponses error", e);
        } finally {
          set({ isLoadingSaved: false });
        }
      },

      saveResponse: async (input) => {
        // optimistic insert (local only) — replaced by db row on success
        const tempId = input.id || crypto.randomUUID();
        const optimistic: SavedResponse = {
          ...input,
          id: tempId,
          savedAt: Date.now(),
          synced: false,
        };
        set((s) => ({ savedResponses: [optimistic, ...s.savedResponses] }));

        try {
          const { data: userData } = await supabase.auth.getUser();
          const userId = userData?.user?.id;
          if (!userId) throw new Error("not_authenticated");

          const { data, error } = await supabase
            .from("saved_responses")
            .insert({
              user_id: userId,
              conversation_id: input.conversationId || null,
              session_id: input.sessionId || null,
              question: input.question || null,
              response: input.response,
              cited_circulars: input.citedCirculars
                ? (input.citedCirculars as unknown as Record<string, unknown>[])
                : null,
            })
            .select("id, created_at")
            .single();
          if (error) throw error;

          set((s) => ({
            savedResponses: s.savedResponses.map((r) =>
              r.id === tempId
                ? { ...r, id: data.id, savedAt: new Date(data.created_at).getTime(), synced: true }
                : r
            ),
          }));
        } catch (e: any) {
          console.error("[chatSidebarStore] saveResponse error", e);
          // Keep local copy but flag as not synced
          if (e?.code === "23505") {
            // unique violation -> already saved, reload
            await get().loadSavedResponses();
          }
        }
      },

      removeSavedResponse: async (id) => {
        const previous = get().savedResponses;
        set((s) => ({ savedResponses: s.savedResponses.filter((r) => r.id !== id) }));
        const target = previous.find((r) => r.id === id);
        if (!target?.synced) return; // local-only, nothing to do server-side
        try {
          const { error } = await supabase.from("saved_responses").delete().eq("id", id);
          if (error) throw error;
        } catch (e) {
          console.error("[chatSidebarStore] removeSavedResponse error", e);
          // restore on failure
          set({ savedResponses: previous });
        }
      },
    }),
    {
      name: "chat-sidebar-store",
      partialize: (state) => ({
        sizePct: state.sizePct,
        activeTab: state.activeTab,
      }),
    }
  )
);
