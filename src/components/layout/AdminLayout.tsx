import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { AdminSidebar } from "./AdminSidebar";

export function AdminLayout() {
  const navigate = useNavigate();

  useEffect(() => {
    const session = localStorage.getItem("douaneai_admin_session");
    if (!session) {
      navigate("/admin/login");
    }
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <AdminSidebar />
      <main className="pl-64 transition-all duration-300">
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
