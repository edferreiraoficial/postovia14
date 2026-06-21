import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './store/auth';
import { ContentProvider } from './store/content';
import ProtectedRoute from './router/ProtectedRoute';
import PublicLayout from './layouts/PublicLayout';
import AdminLayout from './layouts/AdminLayout';
import { HomePage } from './pages/public/HomePage';
import AboutPage from './pages/public/AboutPage';
import ProductsPage from './pages/public/ProductsPage';
import { ContactPage } from './pages/public/ContactPage';
import NotFoundPage from './pages/public/NotFoundPage';
import LoginPage from './pages/admin/LoginPage';
import DashboardPage from './pages/admin/DashBoardPage';
import SettingsAdminPage from './pages/admin/SettingsAdminPage';
import FinanceiroAdminPage from './pages/admin/FinanceiroAdminPage';
import EstoqueBancoAdminPage from './pages/admin/EstoqueBancoAdminPage';
import AuditoriaAdminPage from './pages/admin/AuditoriaAdminPage';

export default function App() {
  return (
    <AuthProvider>
      <ContentProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<PublicLayout />}>
              <Route index element={<HomePage />} />
              <Route path="sobre" element={<AboutPage />} />
              <Route path="produtos" element={<ProductsPage />} />
              <Route path="contato" element={<ContactPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
            <Route path="/admin/login" element={<LoginPage />} />
            <Route path="/admin" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
              <Route index element={<DashboardPage />} />
              <Route path="financeiro" element={<FinanceiroAdminPage />} />
              <Route path="estoque-banco" element={<EstoqueBancoAdminPage />} />
              <Route path="config" element={<SettingsAdminPage />} />
              <Route path="auditoria" element={<AuditoriaAdminPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ContentProvider>
    </AuthProvider>
  );
}