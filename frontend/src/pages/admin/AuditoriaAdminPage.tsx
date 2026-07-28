import { useEffect, useMemo, useState } from 'react';

const API_BASE = `${import.meta.env.VITE_API_URL || ''}/api`;

const MESES = [
  ['Jan26', 'Janeiro/2026'], ['Fev26', 'Fevereiro/2026'], ['Mar26', 'Março/2026'],
  ['Abr26', 'Abril/2026'], ['Mai26', 'Maio/2026'], ['Jun26', 'Junho/2026'],
  ['Jul26', 'Julho/2026'], ['Ago26', 'Agosto/2026'], ['Set26', 'Setembro/2026'],
  ['Out26', 'Outubro/2026'], ['Nov26', 'Novembro/2026'], ['Dez26', 'Dezembro/2026'],
];

type Nivel = 'CRITICO' | 'ATENCAO' | 'INFO';

type Auditoria = {
  periodo: { inicial: string; final: string; competencia: string };
  resumo: {
    lancamentos: number;
    diasAnalisados: number;
    diasSemFechamento: number;
    criticos: number;
    atencoes: number;
    status: 'APROVADO' | 'ATENCAO' | 'REPROVADO';
  };
  issues: Array<{
    nivel: Nivel;
    categoria: string;
    data: string;
    descricao: string;
    detalhe: string;
    valor: number | null;
    id: number | null;
  }>;
  dias: Array<{
    data: string;
    lancamentos: number;
    entradas: number;
    saidas: number;
    possuiFechamento: boolean;
    alertas: number;
  }>;
};

const moeda = (v: number | null | undefined) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dataBr = (valor: string) => {
  if (!valor) return '—';
  const [ano, mes, dia] = valor.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
};

export default function AuditoriaAdminPage() {
  const [competencia, setCompetencia] = useState('Mar26');
  const [dados, setDados] = useState<Auditoria | null>(null);
  const [nivel, setNivel] = useState<'TODOS' | Nivel>('TODOS');
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  async function carregarDados() {
    try {
      setCarregando(true);
      setErro('');
      const resposta = await fetch(`${API_BASE}/auditoria/financeiro-geral?competencia=${competencia}`);
      const json = await resposta.json();
      if (!resposta.ok || !json.ok) throw new Error(json.erro || 'Erro ao executar auditoria.');
      setDados(json);
    } catch (error) {
      setDados(null);
      setErro(error instanceof Error ? error.message : 'Erro ao executar auditoria.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregarDados(); }, [competencia]);

  const ocorrencias = useMemo(() => {
    const termo = busca.trim().toLocaleUpperCase('pt-BR');
    return (dados?.issues || []).filter((item) => {
      if (nivel !== 'TODOS' && item.nivel !== nivel) return false;
      if (!termo) return true;
      return [item.categoria, item.descricao, item.detalhe, item.data, item.id]
        .join(' ').toLocaleUpperCase('pt-BR').includes(termo);
    });
  }, [dados, nivel, busca]);

  const statusClass = dados?.resumo.status === 'APROVADO'
    ? 'audit-status audit-status-ok'
    : dados?.resumo.status === 'ATENCAO'
      ? 'audit-status audit-status-warning'
      : 'audit-status audit-status-danger';

  return (
    <div className="admin-tool-page auditoria-financeiro-page">
      <section className="admin-tool-hero audit-hero">
        <div>
          <span className="audit-kicker">Controle administrativo</span>
          <h1>Auditoria do Financeiro Geral</h1>
          <p>Validação automática de saldos, contrapartidas, fechamento diário, estoque e duplicidades.</p>
        </div>
        {dados && <div className={statusClass}>{dados.resumo.status}</div>}
      </section>

      <section className="admin-tool-card audit-toolbar">
        <label>
          <span>Competência</span>
          <select value={competencia} onChange={(e) => setCompetencia(e.target.value)}>
            {MESES.map(([valor, nome]) => <option key={valor} value={valor}>{nome}</option>)}
          </select>
        </label>
        <button type="button" className="admin-primary-button" onClick={carregarDados} disabled={carregando}>
          {carregando ? 'Auditando...' : 'Executar auditoria'}
        </button>
        {dados && <small>Período: {dataBr(dados.periodo.inicial)} a {dataBr(dados.periodo.final)}</small>}
      </section>

      {erro && <section className="admin-tool-card audit-error">{erro}</section>}

      {dados && (
        <>
          <section className="audit-kpi-grid">
            <article><span>Lançamentos lidos</span><strong>{dados.resumo.lancamentos.toLocaleString('pt-BR')}</strong></article>
            <article><span>Dias analisados</span><strong>{dados.resumo.diasAnalisados}</strong></article>
            <article className={dados.resumo.criticos ? 'is-danger' : ''}><span>Falhas críticas</span><strong>{dados.resumo.criticos}</strong></article>
            <article className={dados.resumo.atencoes ? 'is-warning' : ''}><span>Atenções</span><strong>{dados.resumo.atencoes}</strong></article>
            <article className={dados.resumo.diasSemFechamento ? 'is-danger' : ''}><span>Dias sem fechamento</span><strong>{dados.resumo.diasSemFechamento}</strong></article>
          </section>

          <section className="admin-tool-card audit-explanation">
            <h2>O que está sendo conferido</h2>
            <div className="audit-check-grid">
              <div><strong>Continuidade dos saldos</strong><span>Saldo anterior + movimentos = Saldo do dia.</span></div>
              <div><strong>SPOT e Cartão</strong><span>Crédito e PIX maquininha com contrapartida correta.</span></div>
              <div><strong>Itaú e Caixa</strong><span>Depósito ATM entra no Itaú e sai do Caixa.</span></div>
              <div><strong>Fechamento diário</strong><span>Detecta ausência ou duplicidade de Saldo do dia.</span></div>
              <div><strong>Estoque</strong><span>Quantidade × preço médio confere com o total.</span></div>
              <div><strong>Duplicidades</strong><span>Localiza chaves de integração repetidas.</span></div>
            </div>
          </section>

          <section className="admin-tool-card">
            <div className="audit-section-head">
              <div><h2>Ocorrências encontradas</h2><span>{ocorrencias.length} resultado(s) após os filtros.</span></div>
              <div className="audit-filters">
                <select value={nivel} onChange={(e) => setNivel(e.target.value as 'TODOS' | Nivel)}>
                  <option value="TODOS">Todos os níveis</option>
                  <option value="CRITICO">Críticos</option>
                  <option value="ATENCAO">Atenções</option>
                  <option value="INFO">Informações</option>
                </select>
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar categoria, descrição ou detalhe" />
              </div>
            </div>

            <div className="admin-table-wrapper">
              <table className="admin-table audit-table">
                <thead><tr><th>Nível</th><th>Data</th><th>Categoria</th><th>Lançamento</th><th>Diagnóstico</th><th>Valor</th><th>ID</th></tr></thead>
                <tbody>
                  {!ocorrencias.length && (
                    <tr><td colSpan={7} className="audit-empty">Nenhuma ocorrência encontrada com os filtros atuais.</td></tr>
                  )}
                  {ocorrencias.map((item, indice) => (
                    <tr key={`${item.id || 'x'}-${item.categoria}-${indice}`}>
                      <td><span className={`audit-level audit-level-${item.nivel.toLowerCase()}`}>{item.nivel}</span></td>
                      <td>{dataBr(item.data)}</td>
                      <td>{item.categoria}</td>
                      <td>{item.descricao || '—'}</td>
                      <td>{item.detalhe}</td>
                      <td>{item.valor === null ? '—' : moeda(item.valor)}</td>
                      <td>{item.id || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="admin-tool-card" style={{ marginTop: 24 }}>
            <div className="audit-section-head"><div><h2>Controle diário</h2><span>Volume movimentado e situação do fechamento de cada dia.</span></div></div>
            <div className="admin-table-wrapper">
              <table className="admin-table audit-table">
                <thead><tr><th>Data</th><th>Lançamentos</th><th>Entradas</th><th>Saídas</th><th>Fechamento</th><th>Alertas</th></tr></thead>
                <tbody>
                  {dados.dias.map((dia) => (
                    <tr key={dia.data}>
                      <td>{dataBr(dia.data)}</td><td>{dia.lancamentos}</td><td>{moeda(dia.entradas)}</td><td>{moeda(dia.saidas)}</td>
                      <td><span className={dia.possuiFechamento ? 'audit-ok-text' : 'audit-danger-text'}>{dia.possuiFechamento ? 'Conferido' : 'Ausente'}</span></td>
                      <td>{dia.alertas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
