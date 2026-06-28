import { useState } from 'react';

const API_BASE = 'http://localhost:3001/api';

function primeiroDiaMesAtual() {
  const hoje = new Date();
  return new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
}

function ultimoDiaMesAtual() {
  const hoje = new Date();
  return new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().slice(0, 10);
}

function formatarDataBr(dataIso: string) {
  if (!dataIso) return '';
  const [ano, mes, dia] = dataIso.split('-');
  return `${dia}/${mes}/${ano}`;
}

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
  const [dataInicial, setDataInicial] = useState(primeiroDiaMesAtual());
  const [dataFinal, setDataFinal] = useState(ultimoDiaMesAtual());
  const [loading, setLoading] = useState(false);
  const [mensagem, setMensagem] = useState('');

  async function processar() {
    setMensagem('');
    if (!principal) {
      setMensagem('Selecione a planilha principal.');
      return;
    }

    if (!dataInicial || !dataFinal) {
      setMensagem('Informe a data inicial e a data final.');
      return;
    }

    if (dataInicial > dataFinal) {
      setMensagem('A data inicial não pode ser maior que a data final.');
      return;
    }

    try {
      setLoading(true);
      setMensagem('Enviando arquivos para processamento...');

      const formData = new FormData();
      formData.append('principal', principal);
      formData.append('dataInicial', dataInicial);
      formData.append('dataFinal', dataFinal);

      const response = await fetch(`${API_BASE}/processar-financeiro-banco`, { method: 'POST', body: formData });
      if (!response.ok) {
        const erro = await response.json().catch(() => null);
        throw new Error(erro?.erro || `Erro HTTP ${response.status}`);
      }

      baixarBlob(await response.blob(), 'Financeiro_Geral.xlsx');
      setMensagem(`Arquivo financeiro processado com sucesso para o período de ${formatarDataBr(dataInicial)} a ${formatarDataBr(dataFinal)}.`);
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
        <p>Selecione o período e envie a planilha principal Financeiro Geral.</p>
      </section>

      <section className="admin-tool-card">
        <div className="admin-tool-section-title">
          <h2>Período a trabalhar na Planilha Principal</h2>
          <span>Somente os dias dentro do período escolhido serão processados.</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <label>
            Data inicial
            <input
              className="admin-tool-select"
              type="date"
              value={dataInicial}
              onChange={(e) => setDataInicial(e.target.value)}
            />
          </label>
          <label>
            Data final
            <input
              className="admin-tool-select"
              type="date"
              value={dataFinal}
              onChange={(e) => setDataFinal(e.target.value)}
            />
          </label>
        </div>
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
          <div><span>📅</span><strong>Período</strong></div>
          <div><span>🗄️</span><strong>MySQL</strong></div>
          <div><span>📊</span><strong>Gerar Financeiro</strong></div>
        </div>
      </section>

      <button className="admin-primary-button" onClick={processar} disabled={loading}>{loading ? 'Processando...' : 'Processar Planilha Financeiro Geral'}</button>
      {mensagem && <p className="admin-tool-message">{mensagem}</p>}
    </div>
  );
}
