import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { AdminLayout } from "@/components/layout/AdminLayout";

// Public pages
import Home from "@/pages/Home";
import Chat from "@/pages/Chat";
import Search from "@/pages/Search";
import Calculate from "@/pages/Calculate";

// Admin pages
import AdminLogin from "@/pages/admin/AdminLogin";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminPlaceholder from "@/pages/admin/AdminPlaceholder";

import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/search" element={<Search />} />
            <Route path="/calculate" element={<Calculate />} />
          </Route>

          {/* Admin routes */}
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="upload" element={<AdminPlaceholder />} />
            <Route path="library" element={<AdminPlaceholder />} />
            <Route path="scraping" element={<AdminPlaceholder />} />
            <Route path="veille" element={<AdminPlaceholder />} />
            <Route path="hs-codes" element={<AdminPlaceholder />} />
            <Route path="tariffs" element={<AdminPlaceholder />} />
            <Route path="controlled" element={<AdminPlaceholder />} />
            <Route path="documents" element={<AdminPlaceholder />} />
            <Route path="conversations" element={<AdminPlaceholder />} />
            <Route path="settings" element={<AdminPlaceholder />} />
          </Route>

          {/* 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
