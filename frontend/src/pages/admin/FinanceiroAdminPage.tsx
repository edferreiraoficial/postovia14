import { useState } from 'react';

const API_BASE = 'http://localhost:3001/api';

const MESES = [
  { aba: 'Set25', nome: 'Setembro/2025', arquivo: 'Financeiro_Geral.xlsx' },
  { aba: 'Out25', nome: 'Outubro/2025', arquivo: 'Financeiro_Geral.xlsx' },
  { aba: 'Nov25', nome: 'Novembro/2025', arquivo: 'Financeiro_Geral.xlsx' },
  { aba: 'Dez25', nome: 'Dezembro/2025', arquivo: 'Financeiro_Geral.xlsx' },  
  { aba: 'Jan26', nome: 'Janeiro/2026', arquivo: 'Financeiro_Geral.xlsx' },
  { aba: 'Fev26', nome: 'Fevereiro/2026', arquivo: 'Financeiro_Geral.xlsx' },
  { aba: 'Mar26', nome: 'Março/2026', arquivo: 'Financeiro_Geral.xlsx' },
  { aba: 'Abr26', nome: 'Abril/2026', arquivo: 'Financeiro_Geral.xlsx' },
  { aba: 'Mai26', nome: 'Maio/2026', arquivo: 'Financeiro_Geral.xlsx' },
  { aba: 'Jun26', nome: 'Junho/2026', arquivo: 'Financeiro_Geral.xlsx' },
  { aba: 'Jul26', nome: 'Julho/2026', arquivo: 'Financeiro_Geral.xlsx' },
  { aba: 'Ago26', nome: 'Agosto/2026', arquivo: 'Financeiro_Geral.xlsx' },
  { aba: 'Set26', nome: 'Setembro/2026', arquivo: 'Financeiro_Geral.xlsx' },
  { aba: 'Out26', nome: 'Outubro/2026', arquivo: 'Financeiro_Geral.xlsx' },
  { aba: 'Nov26', nome: 'Novembro/2026', arquivo: 'Financeiro_Geral.xlsx' },
  { aba: 'Dez26', nome: 'Dezembro/2026', arquivo: 'Financeiro_Geral.xlsx' },
];

function baixarBlob(blob: Blob, nome: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export default function FinanceiroAdminPage() {
  const [principal, setPrincipal] = useState<File | null>(null);
  const [abaMes, setAbaMes] = useState('Mar26');
  const [loading, setLoading] = useState(false);
  const [mensagem, setMensagem] = useState('');

  async function processar() {
    setMensagem('');
    if (!principal) {
      setMensagem('Selecione a planilha principal.');
      return;
    }

    try {
      setLoading(true);
      setMensagem('Enviando arquivos para processamento...');

      const formData = new FormData();
      formData.append('principal', principal);
      formData.append('abaMes', abaMes);

      const response = await fetch(`${API_BASE}/processar-financeiro-banco`, { method: 'POST', body: formData });
      if (!response.ok) {
        const erro = await response.json().catch(() => null);
        throw new Error(erro?.erro || `Erro HTTP ${response.status}`);
      }

      const mes = MESES.find((item) => item.aba === abaMes);
      baixarBlob(await response.blob(), mes?.arquivo || 'Financeiro_Geral.xlsx');
      setMensagem('Arquivo financeiro processado com sucesso. Verifique local do download.');
    } catch (err) {
      setMensagem(err instanceof Error ? err.message : 'Erro ao processar planilhas.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-tool-page">
      <section className="admin-tool-hero">
        <h1>Lançamentos de Controle Financeiro</h1>
        <p>  Selecione a competência e envie apenas a planilha principal.</p>
      </section>

      <section className="admin-tool-card">
        <div className="admin-tool-section-title">
          <h2>Mês a trabalhar na Planilha Principal</h2>
          <span>Somente a aba escolhida será lida e alterada.</span>
        </div>
        <select className="admin-tool-select" value={abaMes} onChange={(e) => setAbaMes(e.target.value)}>
          {MESES.map((mes) => <option key={mes.aba} value={mes.aba}>{mes.nome} — aba {mes.aba}</option>)}
        </select>
      </section>

      <section className="admin-tool-card">
        <label className="admin-upload-card" style={{ width: '100%' }}>
          <strong>Planilha Principal</strong>
          <span>Nome padrão: Financeiro_Geral.xlsx</span>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setPrincipal(e.target.files?.[0] || null)}
          />
          {principal && <small>{principal.name}</small>}
        </label>
      </section>
      
      <section className="admin-flow-card">
        <h3>Fluxo automático</h3>
        <div className="admin-flow-steps">
          <div><span>📂</span><strong>Planilha Principal</strong></div>
          <div><span>📅</span><strong>Competência</strong></div>
          <div><span>🗄️</span><strong>PostgreSQL</strong></div>
          <div><span>📊</span><strong>Gerar Financeiro</strong></div>
        </div>
      </section>

      <button className="admin-primary-button" onClick={processar} disabled={loading}>{loading ? 'Processando...' : 'Processar Planilhas'}</button>
      {mensagem && <p className="admin-tool-message">{mensagem}</p>}
    </div>
  );
}
