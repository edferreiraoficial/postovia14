import { Navigate } from 'react-router-dom';
import { useAuth } from '../store/auth';

export default function ProtectedRoute({ children }: any) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="login-page">
        <div className="login-card"><p>Validando acesso...</p></div>
      </div>
    );
  }

  return user ? children : <Navigate to="/admin/login" replace />;
}
