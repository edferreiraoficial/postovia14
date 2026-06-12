import { useEffect, useState } from 'react';

const API_BASE = 'http://localhost:3001/api';

const MESES = [
  { aba: 'Jan26', nome: 'Janeiro/2026' },
  { aba: 'Fev26', nome: 'Fevereiro/2026' },
  { aba: 'Mar26', nome: 'Março/2026' },
  { aba: 'Abr26', nome: 'Abril/2026' },
  { aba: 'Mai26', nome: 'Maio/2026' },
  { aba: 'Jun26', nome: 'Junho/2026' },
  { aba: 'Jul26', nome: 'Julho/2026' },
  { aba: 'Ago26', nome: 'Agosto/2026' },
  { aba: 'Set26', nome: 'Setembro/2026' },
  { aba: 'Out26', nome: 'Outubro/2026' },
  { aba: 'Nov26', nome: 'Novembro/2026' },
  { aba: 'Dez26', nome: 'Dezembro/2026' },
];

export default function DashboardPage() {
  const [competencia, setCompetencia] = useState('Mar26');
  const [resumo, setResumo] = useState<any>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const moeda = (valor: number) =>
    Number(valor || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });

  async function carregarResumo() {
    try {
      setCarregando(true);
      setErro('');

      const response = await fetch(
        `${API_BASE}/dashboard/resumo?competencia=${competencia}`
      );

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.erro || 'Erro ao carregar dashboard.');
      }

      setResumo(json);
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Erro ao carregar dashboard.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregarResumo();
  }, [competencia]);

  return (
    <div className="admin-tool-page">
      <section className="admin-tool-hero">
        <h1>Dashboard Executivo</h1>
        <p>Indicadores financeiros gerados diretamente do PostgreSQL.</p>
      </section>

      <section className="admin-tool-card">
        <div className="admin-tool-section-title">
          <h2>Competência</h2>
          <span>Selecione o mês para análise.</span>
        </div>

        <select
          className="admin-tool-select"
          value={competencia}
          onChange={(e) => setCompetencia(e.target.value)}
        >
          {MESES.map((mes) => (
            <option key={mes.aba} value={mes.aba}>
              {mes.nome} — {mes.aba}
            </option>
          ))}
        </select>
      </section>

      {carregando && <p className="admin-tool-message">Carregando dados...</p>}
      {erro && <p className="admin-tool-message">{erro}</p>}

      {resumo && (
        <>
          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 16,
              marginTop: 24,
            }}
          >
            <div className="admin-tool-card">
              <h3>Total Compras</h3>
              <strong>{moeda(resumo.compras)}</strong>
            </div>

            <div className="admin-tool-card">
              <h3>Total Vendas LMC</h3>
              <strong>{moeda(resumo.vendas)}</strong>
            </div>

            <div className="admin-tool-card">
              <h3>Entradas Bancárias</h3>
              <strong>{moeda(resumo.entradas)}</strong>
            </div>

            <div className="admin-tool-card">
              <h3>Saídas Bancárias</h3>
              <strong>{moeda(resumo.saidas)}</strong>
            </div>

            <div className="admin-tool-card">
              <h3>Diferença Vendas x Entradas</h3>
              <strong>{moeda(resumo.diferenca)}</strong>
            </div>
          </section>

          <section className="admin-tool-card" style={{ marginTop: 24 }}>
            <h2>Leitura rápida</h2>

            <p>
              Nesta competência, o sistema encontrou <strong>{moeda(resumo.vendas)}</strong> em
              vendas pelo LMC e <strong>{moeda(resumo.entradas)}</strong> em entradas bancárias.
            </p>

            <p>
              Diferença apurada:{' '}
              <strong>{moeda(resumo.diferenca)}</strong>.
            </p>
          </section>
        </>
      )}
    </div>
  );
}