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

// All pages — lazy loaded for code splitting
const Landing = lazy(() => import("@/pages/Landing"));
const PhoneLogin = lazy(() => import("@/pages/PhoneLogin"));
const RequestAccess = lazy(() => import("@/pages/RequestAccess"));
const Chat = lazy(() => import("@/pages/Chat"));
const AdminLogin = lazy(() => import("@/pages/admin/AdminLogin"));
const AdminHSCodes = lazy(() => import("@/pages/admin/AdminHSCodes"));
const AdminUpload = lazy(() => import("@/pages/admin/AdminUpload"));
const AdminDocuments = lazy(() => import("@/pages/admin/AdminDocuments"));
const AdminAccessRequests = lazy(() => import("@/pages/admin/AdminAccessRequests"));
const AdminReferences = lazy(() => import("@/pages/admin/AdminReferences"));
const NotFound = lazy(() => import("@/pages/NotFound"));

const PageFallback = () => (
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
                    <Route path="/" element={<Suspense fallback={<PageFallback />}><Landing /></Suspense>} />
                    <Route path="/demander-acces" element={<Suspense fallback={<PageFallback />}><RequestAccess /></Suspense>} />
                    <Route path="/login" element={<Suspense fallback={<PageFallback />}><PhoneLogin /></Suspense>} />

                    {/* App routes — phone auth protected */}
                    <Route
                      path="/app"
                      element={
                        <PhoneProtectedRoute>
                          <AppLayout />
                        </PhoneProtectedRoute>
                      }
                    >
                      <Route index element={<Navigate to="/app/chat" replace />} />
                      <Route path="chat" element={<Suspense fallback={<PageFallback />}><Chat /></Suspense>} />
                    </Route>

                    {/* Admin routes (email auth) */}
                    <Route path="/admin/login" element={
                      <Suspense fallback={<PageFallback />}>
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
                        <Suspense fallback={<PageFallback />}><AdminUpload /></Suspense>
                      } />
                      <Route path="hs-codes" element={
                        <Suspense fallback={<PageFallback />}><AdminHSCodes /></Suspense>
                      } />
                      <Route path="documents" element={
                        <Suspense fallback={<PageFallback />}><AdminDocuments /></Suspense>
                      } />
                      <Route path="references" element={
                        <Suspense fallback={<PageFallback />}><AdminReferences /></Suspense>
                      } />
                      <Route path="access-requests" element={
                        <Suspense fallback={<PageFallback />}><AdminAccessRequests /></Suspense>
                      } />
                    </Route>

                    {/* Legacy redirect */}
                    <Route path="/chat" element={<Navigate to="/app/chat" replace />} />

                    {/* 404 */}
                    <Route path="*" element={<Suspense fallback={<PageFallback />}><NotFound /></Suspense>} />
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