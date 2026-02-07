import { useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { PhoneAuthProvider } from "@/hooks/usePhoneAuth";
import { UploadStateProvider } from "@/hooks/useUploadState";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { PhoneProtectedRoute } from "@/components/auth/PhoneProtectedRoute";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { AppLayout } from "@/components/layout/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Public pages
import Landing from "@/pages/Landing";
import PhoneLogin from "@/pages/PhoneLogin";

// App pages (phone auth)
import Chat from "@/pages/Chat";
import ManagerUsers from "@/pages/manager/ManagerUsers";

// Admin pages (email auth - legacy)
import AdminLogin from "@/pages/admin/AdminLogin";
import AdminHSCodes from "@/pages/admin/AdminHSCodes";
import AdminUpload from "@/pages/admin/AdminUpload";
import AdminDocuments from "@/pages/admin/AdminDocuments";
import NotFound from "@/pages/NotFound";

const App = () => {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <PhoneAuthProvider>
            <UploadStateProvider>
              <TooltipProvider>
                <Toaster />
                <Sonner />
                <BrowserRouter>
                  <Routes>
                    {/* Public: Landing & Login */}
                    <Route path="/" element={<Landing />} />
                    <Route path="/login" element={<PhoneLogin />} />

                    {/* Authenticated app routes (phone auth) */}
                    <Route
                      path="/app"
                      element={
                        <PhoneProtectedRoute>
                          <AppLayout />
                        </PhoneProtectedRoute>
                      }
                    >
                      <Route index element={<Navigate to="/app/chat" replace />} />
                      <Route path="chat" element={<Chat />} />
                      <Route
                        path="manage"
                        element={
                          <PhoneProtectedRoute requireManager>
                            <ManagerUsers />
                          </PhoneProtectedRoute>
                        }
                      />
                    </Route>

                    {/* Admin routes (email auth - legacy) */}
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
                      <Route path="hs-codes" element={<AdminHSCodes />} />
                      <Route path="documents" element={<AdminDocuments />} />
                    </Route>

                    {/* Legacy redirect */}
                    <Route path="/chat" element={<Navigate to="/app/chat" replace />} />

                    {/* 404 */}
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </BrowserRouter>
              </TooltipProvider>
            </UploadStateProvider>
          </PhoneAuthProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
