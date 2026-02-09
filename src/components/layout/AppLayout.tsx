import { Outlet, useLocation } from "react-router-dom";
import { AppHeader } from "./AppHeader";
import { createContext, useContext, useState, useCallback } from "react";

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
        <main className="flex-1 pt-14 md:pt-16 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </AppHeaderContext.Provider>
  );
}
