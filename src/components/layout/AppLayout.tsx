import { Outlet, useLocation } from "react-router-dom";
import { AppHeader } from "./AppHeader";
import { createContext, useContext, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

interface AppHeaderContextType {
  onHistoryToggle?: () => void;
  isHistoryOpen?: boolean;
  setHistoryControls: (toggle: () => void, isOpen: boolean) => void;
}

const AppHeaderContext = createContext<AppHeaderContextType>({
  setHistoryControls: () => {},
});

export const useAppHeaderContext = () => useContext(AppHeaderContext);

export function AppLayout() {
  const location = useLocation();
  const isChat = location.pathname.includes("/chat");
  const isFullHeight = isChat;
  const [historyToggle, setHistoryToggle] = useState<(() => void) | undefined>();
  const [historyOpen, setHistoryOpen] = useState(false);

  const setHistoryControls = useCallback(
    (toggle: () => void, isOpen: boolean) => {
      setHistoryToggle(() => toggle);
      setHistoryOpen(isOpen);
    },
    []
  );

  return (
    <AppHeaderContext.Provider
      value={{
        onHistoryToggle: historyToggle,
        isHistoryOpen: historyOpen,
        setHistoryControls,
      }}
    >
      <div className="h-[100dvh] flex flex-col page-gradient">
        <AppHeader
          onHistoryToggle={isChat ? historyToggle : undefined}
          isHistoryOpen={isChat ? historyOpen : undefined}
        />
        <main className={cn("flex-1 pt-14 md:pt-16 overflow-hidden", isFullHeight ? "pb-0" : "pb-12 md:pb-0")}>
          <Outlet />
        </main>
      </div>
    </AppHeaderContext.Provider>
  );
}
