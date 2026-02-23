import { Navigate, Route, Routes } from "react-router-dom";
import { AdminLayout } from "./components/AdminLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { DocumentDetailPage } from "./pages/DocumentDetailPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { EntitiesPage } from "./pages/EntitiesPage";
import { LoginPage } from "./pages/LoginPage";
import { PdfViewerPage } from "./pages/PdfViewerPage";
import { PlaygroundPage } from "./pages/PlaygroundPage";
import { useAuthStore } from "./store/authStore";

function RootRedirect() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated());
  return <Navigate to={isAuthenticated ? "/dashboard/documents" : "/login"} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="documents" replace />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="documents/:id" element={<DocumentDetailPage />} />
        <Route path="documents/:id/pdf" element={<PdfViewerPage />} />
        <Route path="entities" element={<EntitiesPage />} />
        <Route path="playground" element={<PlaygroundPage />} />
      </Route>

      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}

export default App;
