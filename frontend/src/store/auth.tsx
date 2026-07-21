import { createContext, useContext, useEffect, useMemo, useState } from 'react';

type Permissions = Record<string, number | boolean> | null;

type User = {
  id: number;
  nome: string;
  usuario: string;
  email?: string | null;
  perfil: string;
  permissoes: Permissions;
} | null;

type LoginResult = { ok: true } | { ok: false; error: string };

type AuthContextValue = {
  user: User;
  loading: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const TOKEN_KEY = 'posto_via14_token';
const API_BASE = `${import.meta.env.VITE_API_URL || ''}/api`;

const nativeFetch = window.fetch.bind(window);

// Centraliza a inclusão do JWT em todas as chamadas /api já existentes no projeto.
window.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));

  if (token && url.includes('/api/') && !url.includes('/api/auth/login')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return nativeFetch(input, { ...init, headers });
}) as typeof window.fetch;

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  };

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }

    fetch(`${API_BASE}/auth/me`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.usuario) throw new Error(payload?.erro || 'Sessão inválida.');
        setUser(payload.usuario);
      })
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string): Promise<LoginResult> => {
    try {
      const response = await nativeFetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: username, senha: password }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.token || !payload?.usuario) {
        return { ok: false, error: payload?.erro || 'Usuário ou senha inválidos.' };
      }

      localStorage.setItem(TOKEN_KEY, payload.token);
      setUser(payload.usuario);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Não foi possível conectar ao servidor.' };
    }
  };

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
};
