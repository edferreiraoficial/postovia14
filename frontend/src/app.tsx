import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './store/auth';
import { ContentProvider } from './store/content';
import ProtectedRoute from './router/ProtectedRoute';
import PermissionRoute from './router/PermissionRoute';
import PublicLayout from './layouts/PublicLayout';
import AdminLayout from './layouts/AdminLayout';
import { HomePage } from './pages/public/HomePage';
import AboutPage from './pages/public/AboutPage';
import ProductsPage from './pages/public/ProductsPage';
import { ContactPage } from './pages/public/ContactPage';
import NotFoundPage from './pages/public/NotFoundPage';
import LoginPage from './pages/admin/LoginPage';
import DashboardPage from './pages/admin/DashboardPage';
import SettingsAdminPage from './pages/admin/SettingsAdminPage';
import FinanceiroAdminPage from './pages/admin/FinanceiroAdminPage';
import EstoqueBancoAdminPage from './pages/admin/EstoqueBancoAdminPage';
import AuditoriaAdminPage from './pages/admin/AuditoriaAdminPage';
import PdfExcelAdminPage from './pages/admin/PdfExcelAdminPage';
import ConsultaBancoAdminPage from './pages/admin/ConsultaBancoAdminPage';
import ImportarExcelBancoAdminPage from './pages/admin/ImportarExcelBancoAdminPage';
import CadastrosAdminPage from './pages/admin/CadastrosAdminPage';
import FinanceiroGeralAdminPage from './pages/admin/FinanceiroGeralAdminPage';

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
              <Route index element={<PermissionRoute permission="dashboard"><DashboardPage /></PermissionRoute>} />
              <Route path="financeiro" element={<PermissionRoute permission="lancamentos"><FinanceiroAdminPage /></PermissionRoute>} />
              <Route path="estoque-banco" element={<PermissionRoute permission="importar_pdf"><EstoqueBancoAdminPage /></PermissionRoute>} />
              <Route path="importar-excel" element={<PermissionRoute permission="importar_excel"><ImportarExcelBancoAdminPage /></PermissionRoute>} />
              <Route path="cadastros" element={<PermissionRoute permission="cadastros"><CadastrosAdminPage /></PermissionRoute>} />
              <Route path="config" element={<PermissionRoute permission="configuracoes"><SettingsAdminPage /></PermissionRoute>} />
              <Route path="auditoria" element={<PermissionRoute permission="auditoria"><AuditoriaAdminPage /></PermissionRoute>} />
              <Route path="pdf-excel" element={<PermissionRoute permission="pdf_excel"><PdfExcelAdminPage /></PermissionRoute>} />
              <Route path="consultas-banco" element={<PermissionRoute permission="dados_gravados"><ConsultaBancoAdminPage /></PermissionRoute>} />
              <Route path="financeiro-geral" element={<PermissionRoute permission="dados_gravados"><FinanceiroGeralAdminPage /></PermissionRoute>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ContentProvider>
    </AuthProvider>
  );
}