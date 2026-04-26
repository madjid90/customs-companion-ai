import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SidebarCitation {
  id: string; // unique ID (e.g. messageId-index)
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
  id: string;
  conversationId?: string;
  question: string;
  response: string;
  sessionId?: string;
  savedAt: number;
}

type SidebarTab = "citations" | "saved";

interface ChatSidebarState {
  // UI state
  isOpen: boolean;
  activeTab: SidebarTab;
  sizePct: number; // sidebar width percentage when open
  // Data
  citations: SidebarCitation[];
  savedResponses: SavedResponse[];
  // Actions
  toggle: () => void;
  setOpen: (open: boolean) => void;
  setActiveTab: (tab: SidebarTab) => void;
  setSizePct: (pct: number) => void;
  addCitations: (items: SidebarCitation[]) => void;
  removeCitation: (id: string) => void;
  clearCitations: () => void;
  addSavedResponse: (response: SavedResponse) => void;
  removeSavedResponse: (id: string) => void;
}

export const useChatSidebarStore = create<ChatSidebarState>()(
  persist(
    (set) => ({
      isOpen: false,
      activeTab: "citations",
      sizePct: 32,
      citations: [],
      savedResponses: [],
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
      addSavedResponse: (response) =>
        set((s) => {
          if (s.savedResponses.some((r) => r.id === response.id)) return s;
          return { savedResponses: [response, ...s.savedResponses] };
        }),
      removeSavedResponse: (id) =>
        set((s) => ({ savedResponses: s.savedResponses.filter((r) => r.id !== id) })),
    }),
    {
      name: "chat-sidebar-store",
      partialize: (state) => ({
        sizePct: state.sizePct,
        activeTab: state.activeTab,
        savedResponses: state.savedResponses,
      }),
    }
  )
);
