import { useState, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { AppAuthProvider } from "@/hooks/useAppAuth";
import { UploadStateProvider } from "@/hooks/useUploadState";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AppProtectedRoute } from "@/components/auth/AppProtectedRoute";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { AppLayout } from "@/components/layout/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Landing eagerly loaded (entry page — avoids request chain)
import Landing from "@/pages/Landing";
// Other pages — lazy loaded for code splitting
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const RequestAccess = lazy(() => import("@/pages/RequestAccess"));
const Chat = lazy(() => import("@/pages/Chat"));
const Consultation = lazy(() => import("@/pages/Consultation"));
const ConsultationHistory = lazy(() => import("@/pages/ConsultationHistory"));
const Cases = lazy(() => import("@/pages/Cases"));
const CaseDetail = lazy(() => import("@/pages/CaseDetail"));
const LegalExplorer = lazy(() => import("@/pages/LegalExplorer"));
const HSExplorer = lazy(() => import("@/pages/HSExplorer"));
const Products = lazy(() => import("@/pages/Products"));
const AdminLogin = lazy(() => import("@/pages/admin/AdminLogin"));
const AdminHSCodes = lazy(() => import("@/pages/admin/AdminHSCodes"));
const AdminUpload = lazy(() => import("@/pages/admin/AdminUpload"));
const AdminDocuments = lazy(() => import("@/pages/admin/AdminDocuments"));
const AdminAccessRequests = lazy(() => import("@/pages/admin/AdminAccessRequests"));
const AdminReferences = lazy(() => import("@/pages/admin/AdminReferences"));
const AdminCorpus = lazy(() => import("@/pages/admin/AdminCorpus"));
const AdminBulkImport = lazy(() => import("@/pages/admin/AdminBulkImport"));
const AdminLegalReview = lazy(() => import("@/pages/admin/AdminLegalReview"));
const AdminLegalVersions = lazy(() => import("@/pages/admin/AdminLegalVersions"));
const AdminHSReview = lazy(() => import("@/pages/admin/AdminHSReview"));
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
          <AppAuthProvider>
            <UploadStateProvider>
              <TooltipProvider>
                <Toaster />
                <Sonner />
                <BrowserRouter>
                  {/* Background animations removed */}
                  <Routes>
                    {/* Public: Landing & Login */}
                    <Route path="/" element={<Landing />} />
                    <Route path="/demander-acces" element={<Suspense fallback={<PageFallback />}><RequestAccess /></Suspense>} />
                    <Route path="/login" element={<Suspense fallback={<PageFallback />}><LoginPage /></Suspense>} />

                    {/* App routes — phone auth protected */}
                    <Route
                      path="/app"
                      element={
                        <AppProtectedRoute>
                          <AppLayout />
                        </AppProtectedRoute>
                      }
                    >
                      <Route index element={<Navigate to="/app/chat" replace />} />
                      <Route path="chat" element={<Suspense fallback={<PageFallback />}><Chat /></Suspense>} />
                      <Route path="consultation" element={<Suspense fallback={<PageFallback />}><Consultation /></Suspense>} />
                      <Route path="historique" element={<Suspense fallback={<PageFallback />}><ConsultationHistory /></Suspense>} />
                      <Route path="dossiers" element={<Suspense fallback={<PageFallback />}><Cases /></Suspense>} />
                      <Route path="dossiers/:id" element={<Suspense fallback={<PageFallback />}><CaseDetail /></Suspense>} />
                      <Route path="juridique" element={<Suspense fallback={<PageFallback />}><LegalExplorer /></Suspense>} />
                      <Route path="classement-sh" element={<Suspense fallback={<PageFallback />}><HSExplorer /></Suspense>} />
                      <Route path="produits" element={<Suspense fallback={<PageFallback />}><Products /></Suspense>} />
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
                      <Route path="corpus" element={
                        <Suspense fallback={<PageFallback />}><AdminCorpus /></Suspense>
                      } />
                      <Route path="corpus/import" element={
                        <Suspense fallback={<PageFallback />}><AdminBulkImport /></Suspense>
                      } />
                      <Route path="juridique" element={
                        <Suspense fallback={<PageFallback />}><AdminLegalReview /></Suspense>
                      } />
                      <Route path="versions-juridiques" element={
                        <Suspense fallback={<PageFallback />}><AdminLegalVersions /></Suspense>
                      } />
                      <Route path="revue-sh" element={
                        <Suspense fallback={<PageFallback />}><AdminHSReview /></Suspense>
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
          </AppAuthProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
