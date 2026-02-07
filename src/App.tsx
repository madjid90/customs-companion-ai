import { useState, lazy, Suspense } from "react";
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
import RequestAccess from "@/pages/RequestAccess";

// App pages (phone auth)
import Chat from "@/pages/Chat";
import ManagerUsers from "@/pages/manager/ManagerUsers";

// Admin pages — lazy loaded
const AdminLogin = lazy(() => import("@/pages/admin/AdminLogin"));
const AdminHSCodes = lazy(() => import("@/pages/admin/AdminHSCodes"));
const AdminUpload = lazy(() => import("@/pages/admin/AdminUpload"));
const AdminDocuments = lazy(() => import("@/pages/admin/AdminDocuments"));
const AdminAccessRequests = lazy(() => import("@/pages/admin/AdminAccessRequests"));
import NotFound from "@/pages/NotFound";

const AdminFallback = () => (
  <div className="min-h-screen flex items-center justify-center page-gradient">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  </div>
);

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
                    <Route path="/demander-acces" element={<RequestAccess />} />
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
                    <Route path="/admin/login" element={
                      <Suspense fallback={<AdminFallback />}>
                        <AdminLogin />
                      </Suspense>
                    } />
                    <Route
                      path="/admin"
                      element={
                        <ProtectedRoute requireAdmin>
                          <AdminLayout />
                        </ProtectedRoute>
                      }
                    >
                      <Route index element={<Navigate to="/admin/upload" replace />} />
                      <Route path="upload" element={
                        <Suspense fallback={<AdminFallback />}><AdminUpload /></Suspense>
                      } />
                      <Route path="hs-codes" element={
                        <Suspense fallback={<AdminFallback />}><AdminHSCodes /></Suspense>
                      } />
                      <Route path="documents" element={
                        <Suspense fallback={<AdminFallback />}><AdminDocuments /></Suspense>
                      } />
                      <Route path="access-requests" element={
                        <Suspense fallback={<AdminFallback />}><AdminAccessRequests /></Suspense>
                      } />
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