import { Outlet, useLocation } from "react-router-dom";
import { PublicHeader } from "./PublicHeader";
import { PublicFooter } from "./PublicFooter";
import { createContext, useContext, useState, useCallback } from "react";

interface HeaderContextType {
  onHistoryToggle?: () => void;
  isHistoryOpen?: boolean;
  setHistoryControls: (toggle: () => void, isOpen: boolean) => void;
}

const HeaderContext = createContext<HeaderContextType>({
  setHistoryControls: () => {},
});

export const useHeaderContext = () => useContext(HeaderContext);

export function PublicLayout() {
  const location = useLocation();
  const isChat = location.pathname === "/chat";
  const [historyToggle, setHistoryToggle] = useState<(() => void) | undefined>();
  const [historyOpen, setHistoryOpen] = useState(false);

  const setHistoryControls = useCallback((toggle: () => void, isOpen: boolean) => {
    setHistoryToggle(() => toggle);
    setHistoryOpen(isOpen);
  }, []);

  return (
    <HeaderContext.Provider value={{ onHistoryToggle: historyToggle, isHistoryOpen: historyOpen, setHistoryControls }}>
      <div className="min-h-screen flex flex-col page-gradient">
        <PublicHeader onHistoryToggle={historyToggle} isHistoryOpen={historyOpen} />
        <main className="flex-1 pt-14 md:pt-16">
          <Outlet />
        </main>
        {!isChat && <PublicFooter />}
      </div>
    </HeaderContext.Provider>
  );
}