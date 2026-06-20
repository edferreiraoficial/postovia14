const API_BASE =
  import.meta.env.VITE_API_URL || 'https://postovia14.com.br';

export async function getResumo() {
  const res = await fetch(`${API_BASE}/api/dashboard/resumo`);
  return res.json();
}

export async function getMensal() {
  const res = await fetch(`${API_BASE}/api/dashboard/mensal`);
  return res.json();
}

export async function getFinanceiro() {
  const res = await fetch(`${API_BASE}/api/dashboard/financeiro`);
  return res.json();
}

export async function getCompetencias() {
  const res = await fetch(`${API_BASE}/api/competencias`);
  return res.json();
}