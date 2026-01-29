import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { UploadStateProvider } from "@/hooks/useUploadState";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Public pages
import Chat from "@/pages/Chat";

// Admin pages
import AdminLogin from "@/pages/admin/AdminLogin";

import AdminHSCodes from "@/pages/admin/AdminHSCodes";
import AdminUpload from "@/pages/admin/AdminUpload";
import AdminScraping from "@/pages/admin/AdminScraping";
import AdminVeille from "@/pages/admin/AdminVeille";
import AdminDocuments from "@/pages/admin/AdminDocuments";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <UploadStateProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                {/* Public routes - Chat only */}
                <Route element={<PublicLayout />}>
                  <Route path="/" element={<Navigate to="/chat" replace />} />
                  <Route path="/chat" element={<Chat />} />
                </Route>

                {/* Admin routes */}
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute requireAdmin>
                      <AdminLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<Navigate to="/admin/upload" replace />} />
                  <Route path="upload" element={<AdminUpload />} />
                  <Route path="scraping" element={<AdminScraping />} />
                  <Route path="veille" element={<AdminVeille />} />
                  <Route path="hs-codes" element={<AdminHSCodes />} />
                  <Route path="documents" element={<AdminDocuments />} />
                </Route>

                {/* 404 */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </UploadStateProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
