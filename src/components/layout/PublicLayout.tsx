import { Outlet, useLocation } from "react-router-dom";
import { PublicHeader } from "./PublicHeader";
import { PublicFooter } from "./PublicFooter";

export function PublicLayout() {
  const location = useLocation();
  const isChat = location.pathname === "/chat";

  return (
    <div className="min-h-screen flex flex-col page-gradient">
      <PublicHeader />
      <main className="flex-1 pt-16">
        <Outlet />
      </main>
      {!isChat && <PublicFooter />}
    </div>
  );
}