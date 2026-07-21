import { Navigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { firstAllowedAdminPath, hasPermission, type PermissionKey } from '../authPermissions';

export default function PermissionRoute({ permission, children }: { permission: PermissionKey; children: any }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="login-page">
        <div className="login-card"><p>Validando permissão...</p></div>
      </div>
    );
  }

  if (!user) return <Navigate to="/admin/login" replace />;
  if (hasPermission(user, permission)) return children;

  const destination = firstAllowedAdminPath(user);
  if (destination) return <Navigate to={destination} replace />;

  return (
    <section className="admin-access-denied">
      <h1>Acesso não autorizado</h1>
      <p>Seu usuário não possui permissão para acessar nenhuma página administrativa.</p>
    </section>
  );
}
