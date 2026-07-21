import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { hasPermission, type PermissionKey } from '../authPermissions';

type IconName =
  | 'menu'
  | 'dashboard'
  | 'database'
  | 'upload'
  | 'sheet'
  | 'pdf'
  | 'finance'
  | 'audit'
  | 'settings'
  | 'logout'
  | 'chevron';

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 14v5h14v-5" /></>,
    sheet: <><path d="M6 2h8l4 4v16H6z" /><path d="M14 2v5h5" /><path d="M9 12h6M9 16h6" /></>,
    pdf: <><path d="M6 2h8l4 4v16H6z" /><path d="M14 2v5h5" /><path d="M8.5 16h1.2c1.2 0 2-.7 2-1.8s-.8-1.8-2-1.8H8.5V18M13.5 12.4V18h1.2c1.7 0 2.8-1 2.8-2.8s-1.1-2.8-2.8-2.8z" /></>,
    finance: <><path d="M4 19V9M10 19V5M16 19v-7M22 19H2" /><path d="m4 7 6-4 6 5 5-5" /></>,
    audit: <><path d="M9 4h6M9 8h6M6 2h12v20H6z" /><path d="m9 15 2 2 4-5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    logout: <><path d="M10 5H5v14h5" /><path d="M13 8l4 4-4 4M17 12H9" /></>,
    chevron: <><path d="m15 18-6-6 6-6" /></>,
  };

  return (
    <svg className="admin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

const menuItems: Array<{ to: string; label: string; icon: IconName; permission: PermissionKey; end?: boolean }> = [
  { to: '/admin', label: 'Dashboard', icon: 'dashboard', permission: 'dashboard', end: true },
  { to: '/admin/consultas-banco', label: 'Dados Gravados', icon: 'database', permission: 'dados_gravados' },
  { to: '/admin/financeiro-geral', label: 'Financeiro Geral', icon: 'finance', permission: 'dados_gravados' },
  { to: '/admin/estoque-banco', label: 'Importar Dados', icon: 'upload', permission: 'importar_pdf' },
  { to: '/admin/importar-excel', label: 'Importar Excel', icon: 'sheet', permission: 'importar_excel' },
  { to: '/admin/pdf-excel', label: 'PDF para Excel', icon: 'pdf', permission: 'pdf_excel' },
  { to: '/admin/financeiro', label: 'Lançamentos Financeiros', icon: 'finance', permission: 'lancamentos' },
  { to: '/admin/auditoria', label: 'Auditoria', icon: 'audit', permission: 'auditoria' },
  { to: '/admin/cadastros', label: 'Cadastros Diversos', icon: 'database', permission: 'cadastros' },
  { to: '/admin/config', label: 'Configurações', icon: 'settings', permission: 'configuracoes' },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('admin-sidebar-collapsed') === 'true');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('admin-sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate('/admin/login');
  };

  return (
    <div className={`admin-layout${collapsed ? ' is-collapsed' : ''}${mobileOpen ? ' is-mobile-open' : ''}`}>
      <aside className="admin-sidebar" aria-label="Menu administrativo">
        <div className="admin-sidebar__brand">
          <div className="admin-sidebar__logo" aria-hidden="true">V14</div>
          <div className="admin-sidebar__brand-text">
            <strong>Posto Via 14</strong>
            <span>Painel administrativo</span>
          </div>
          <button
            className="admin-sidebar__collapse"
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            <Icon name="chevron" />
          </button>
        </div>

        <nav className="admin-sidebar__nav">
          {menuItems.filter((item) => hasPermission(user, item.permission)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}
              title={collapsed ? item.label : undefined}
            >
              <span className="admin-nav-link__icon"><Icon name={item.icon} /></span>
              <span className="admin-nav-link__label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <button className="admin-sidebar__logout" type="button" onClick={handleLogout} title={collapsed ? 'Sair' : undefined}>
          <span className="admin-nav-link__icon"><Icon name="logout" /></span>
          <span className="admin-nav-link__label">Sair</span>
        </button>
      </aside>

      <button className="admin-mobile-overlay" type="button" aria-label="Fechar menu" onClick={() => setMobileOpen(false)} />

      <section className="admin-main">
        <header className="admin-mobile-header">
          <button type="button" onClick={() => setMobileOpen(true)} aria-label="Abrir menu"><Icon name="menu" /></button>
          <strong>Posto Via 14</strong>
        </header>
        <main className="admin-content"><Outlet /></main>
      </section>
    </div>
  );
}
