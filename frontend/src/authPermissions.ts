export type PermissionKey =
  | 'dashboard'
  | 'dados_gravados'
  | 'importar_pdf'
  | 'importar_excel'
  | 'pdf_excel'
  | 'lancamentos'
  | 'auditoria'
  | 'cadastros'
  | 'configuracoes'
  | 'incluir'
  | 'editar'
  | 'excluir'
  | 'imprimir';

export type PermissionUser = {
  perfil?: string | null;
  permissoes?: Record<string, number | boolean> | null;
} | null;

export const ADMIN_ROUTES: Array<{ path: string; permission: PermissionKey }> = [
  { path: '/admin', permission: 'dashboard' },
  { path: '/admin/consultas-banco', permission: 'dados_gravados' },
  { path: '/admin/estoque-banco', permission: 'importar_pdf' },
  { path: '/admin/importar-excel', permission: 'importar_excel' },
  { path: '/admin/pdf-excel', permission: 'pdf_excel' },
  { path: '/admin/financeiro', permission: 'lancamentos' },
  { path: '/admin/auditoria', permission: 'auditoria' },
  { path: '/admin/cadastros', permission: 'cadastros' },
  { path: '/admin/config', permission: 'configuracoes' },
];

export function isAdmin(user: PermissionUser) {
  return String(user?.perfil || '').toUpperCase() === 'ADMIN';
}

export function hasPermission(user: PermissionUser, permission: PermissionKey) {
  if (isAdmin(user)) return true;
  return Number(user?.permissoes?.[permission] || 0) === 1;
}

export function firstAllowedAdminPath(user: PermissionUser) {
  return ADMIN_ROUTES.find((item) => hasPermission(user, item.permission))?.path || null;
}
