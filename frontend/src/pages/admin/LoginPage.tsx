import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../store/auth';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    const result = await login(username.trim(), password);
    setSubmitting(false);
    if (result.ok) navigate('/admin');
    else setError(result.error);
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleLogin}>
        <h1>Área administrativa</h1>
        <label>
          Usuário
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Senha
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn" disabled={submitting}>{submitting ? 'Entrando...' : 'Entrar'}</button>
      </form>
    </div>
  );
}
