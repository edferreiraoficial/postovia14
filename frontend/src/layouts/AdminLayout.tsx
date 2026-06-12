import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';

export default function AdminLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/admin/login');
  };

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <h2>Posto Via 14</h2>
        <Link to="/admin">Dashboard</Link>
        <Link to="/admin/estoque-banco">Importar Dados</Link>
        <Link to="/admin/financeiro">Lançamentos Financeiros</Link>
        <Link to="/admin/auditoria">Auditoria</Link>
        <Link to="/admin/config">Configurações</Link>
        <button type="button" onClick={handleLogout}>Sair</button>
      </aside>
      <main className="admin-content"><Outlet /></main>
    </div>
  );
}
