import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

const API_BASE = 'http://localhost:3001/api';

const MESES = [
  { aba: 'Set25', nome: 'Setembro/2025' },
  { aba: 'Out25', nome: 'Outubro/2025' },
  { aba: 'Nov25', nome: 'Novembro/2025' },
  { aba: 'Dez25', nome: 'Dezembro/2025' },  
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

type ProductName = 'Gasolina' | 'Etanol' | 'Díesel';
type ProductStats = { revenue: number; qty: number; ticket: number; margin: number | null; nps: number | null; days: number };
type MonthRow = { label: string; Gasolina: number; Etanol: number; Díesel: number };
type DashboardData = { stats: Record<ProductName, ProductStats>; monthly: MonthRow[]; baseRevenue: number; rows: number; source: string; updatedAt: string };

const PRODUCTS: ProductName[] = ['Gasolina', 'Etanol', 'Díesel'];
const COLORS: Record<ProductName, string> = { Gasolina: '#FBBF24', Etanol: '#84CC16', Díesel: '#F97316' };

const fmtBRL = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (value: number) => Math.round(value).toLocaleString('pt-BR');
const fmtPct = (value: number | null) => value === null || !Number.isFinite(value) ? 'N/D' : `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

function MonthlyChart({ monthly }: { monthly: MonthRow[] }) {
  const width = 900, height = 360, padL = 56, padR = 18, padT = 20, padB = 58;
  const chartW = width - padL - padR, chartH = height - padT - padB;
  const max = Math.max(...monthly.flatMap((month) => PRODUCTS.map((product) => month[product] || 0)), 1) * 1.15;
  const groupW = chartW / Math.max(monthly.length, 1), barW = Math.min(24, groupW / 5);

  return <svg className="db-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Receita mensal por produto">
    {[0, .25, .5, .75, 1].map((tick) => {
      const y = padT + chartH * (1 - tick);
      return <g key={tick}><line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#E5E7EB" strokeWidth="1" /><text x="8" y={y + 4} fill="#64748B" fontSize="11">{fmtBRL(max * tick).replace(',00', '')}</text></g>;
    })}
    {monthly.map((month, index) => {
      const gx = padL + index * groupW + groupW / 2;
      return <g key={`${month.label}-${index}`}>{PRODUCTS.map((product, productIndex) => {
        const value = month[product] || 0, barH = chartH * (value / max), x = gx + (productIndex - 1) * barW * 1.2 - barW / 2, y = padT + chartH - barH;
        return <rect key={product} x={x} y={y} width={barW} height={barH} rx="6" fill={COLORS[product]} />;
      })}<text x={gx} y={height - 28} fill="#64748B" fontSize="11" textAnchor="middle">{month.label}</text></g>;
    })}
  </svg>;
}

function DonutChart({ data }: { data: DashboardData }) {
  const total = PRODUCTS.reduce((sum, product) => sum + data.stats[product].revenue, 0) || 1;
  let start = -90;
  const cx = 180, cy = 165, radius = 100, strokeWidth = 46;
  return <svg className="db-chart db-donut" viewBox="0 0 360 360" role="img" aria-label="Breakdown por produto">
    {PRODUCTS.map((product) => {
      const value = data.stats[product].revenue;
      if (!value) return null;
      const percentage = value / total, end = start + percentage * 360, largeArc = end - start > 180 ? 1 : 0;
      const sr = Math.PI * start / 180, er = Math.PI * end / 180;
      const path = `M ${cx + radius * Math.cos(sr)} ${cy + radius * Math.sin(sr)} A ${radius} ${radius} 0 ${largeArc} 1 ${cx + radius * Math.cos(er)} ${cy + radius * Math.sin(er)}`;
      start = end;
      return <path key={product} d={path} fill="none" stroke={COLORS[product]} strokeWidth={strokeWidth} strokeLinecap="butt" />;
    })}
    <circle cx={cx} cy={cy} r="55" fill="#fff" /><text x={cx} y={cy - 4} textAnchor="middle" fontSize="18" fontWeight="800" fill="#111827">{fmtBRL(total).replace(',00', '')}</text><text x={cx} y={cy + 18} textAnchor="middle" fontSize="12" fill="#64748B">Receita total</text>
  </svg>;
}

function ProjectionChart({ values }: { values: { label: string; total: number }[] }) {
  const width = 900, height = 300, padL = 42, padR = 16, padT = 18, padB = 38;
  const chartW = width - padL - padR, chartH = height - padT - padB, max = Math.max(...values.map((i) => i.total), 1) * 1.1;
  return <svg className="db-chart db-projection-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Projeção de receita">
    {values.map((item, index) => {
      const x = padL + (index * chartW) / Math.max(values.length - 1, 1), y = padT + chartH - (item.total / max) * chartH;
      const previous = values[index - 1], px = previous ? padL + ((index - 1) * chartW) / Math.max(values.length - 1, 1) : x, py = previous ? padT + chartH - (previous.total / max) * chartH : y;
      return <g key={item.label}>{previous && <line x1={px} y1={py} x2={x} y2={y} stroke="#4682B4" strokeWidth="4" strokeLinecap="round" />}<circle cx={x} cy={y} r="6" fill="#4682B4" /><text x={x} y={height - 12} fill="#64748B" fontSize="12" textAnchor="middle">{item.label}</text></g>;
    })}
  </svg>;
}

export default function DashboardPage() {
  const [growth, setGrowth] = useState(5);
  const [gasMix, setGasMix] = useState(48);
  const [etaMix, setEtaMix] = useState(52);
  const [dieselMix, setDieselMix] = useState(0);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [inicio, setInicio] = useState('Set25');
  const [fim, setFim] = useState('Dez26');

  useEffect(() => {
    fetch(`${API_BASE}/dashboard/completo?inicio=${inicio}&fim=${fim}`)
      .then((response) => {
        if (!response.ok) throw new Error('Erro ao carregar dados do dashboard.');
        return response.json();
      })
      .then((json) => {
        if (!json.ok) throw new Error(json.erro || 'Erro ao carregar dashboard.');
        setData(json);
        setError('');
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Erro ao carregar dashboard.')
      );
  }, [inicio, fim]);

  const totalRevenue = data ? PRODUCTS.reduce((sum, product) => sum + data.stats[product].revenue, 0) : 0;
  const totalMix = gasMix + etaMix + dieselMix || 1;
  const normalizedMix = { gas: (gasMix / totalMix) * 100, eta: (etaMix / totalMix) * 100, diesel: (dieselMix / totalMix) * 100 };
  const projection = useMemo(() => ['Mês 1', 'Mês 2', 'Mês 3', 'Mês 4', 'Mês 5', 'Mês 6'].map((label, index) => ({ label, total: (data?.baseRevenue || 0) * Math.pow(1 + growth / 100, index + 1) })), [growth, data]);
  const projectionTotal = projection.reduce((sum, item) => sum + item.total, 0);

  if (error) return <div className="db-dashboard"><section className="db-hero-card"><div><span className="db-kicker">Área Administrativa</span><h1>Dashboard de Vendas 2026</h1><p>{error}</p><p>Confira se o backend e o PostgreSQL estão ativos.</p></div></section></div>;
  if (!data) return <div className="db-dashboard"><section className="db-hero-card"><div><span className="db-kicker">Área Administrativa</span><h1>Carregando dashboard...</h1><p>Carregando dados do PostgreSQL.</p></div></section></div>;

  return <div className="db-dashboard">
    <section className="db-hero-card">
      <div><span className="db-kicker">Área Administrativa</span><h1>Dashboard de Vendas 2026</h1></div>
      <div className="db-hero-badge">{data.rows} registros analisados</div>
    </section>

    <section className="admin-tool-card" style={{ marginBottom: 24 }}>
      <div className="admin-tool-section-title">
        <h2>Período</h2>
        <span>Selecione o intervalo de análise.</span>
      </div>
   
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <label>
          <strong>Início</strong>
          <select
            className="admin-tool-select"
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
          >
            {MESES.map((mes) => (
              <option key={mes.aba} value={mes.aba}>
                {mes.nome} — {mes.aba}
              </option>
            ))}
          </select>
        </label>

        <label>
          <strong>Fim</strong>
          <select
            className="admin-tool-select"
            value={fim}
            onChange={(e) => setFim(e.target.value)}
          >
            {MESES.map((mes) => (
              <option key={mes.aba} value={mes.aba}>
                {mes.nome} — {mes.aba}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <button type="button" className="admin-primary-button" onClick={() => {
          setInicio('Set25');
          setFim('Dez26');
        }}>
          Total Geral
        </button>

        <button type="button" className="admin-primary-button" onClick={() => {
          setInicio('Set25');
          setFim('Dez25');
        }}>
          Ano 2025
        </button>

        <button type="button" className="admin-primary-button" onClick={() => {
          setInicio('Jan26');
          setFim('Dez26');
        }}>
          Ano 2026
        </button>
      </div>
    </section>

    <section id="visao" className="db-section">
      <div className="db-section-title"><h2>Visão Geral</h2><span>KPIs por produto</span></div>
      <div className="db-kpi-grid">{PRODUCTS.map((product) => {
        const stats = data.stats[product];
        return <article className="db-product-card" style={{ '--product-color': COLORS[product] } as CSSProperties} key={product}><div className="db-product-head"><strong>{product}</strong><span /></div><div className="db-kpi-list"><div className="db-kpi db-kpi-full"><label>Receita Total</label><strong>{fmtBRL(stats.revenue)}</strong><small>{stats.days} dias com movimento</small></div><div className="db-kpi"><label>Total de Vendas</label><strong>{fmtNum(stats.qty)}</strong><small>litros/unidades</small></div><div className="db-kpi"><label>Ticket Médio</label><strong>{fmtBRL(stats.ticket)}</strong><small>receita ÷ vendas</small></div><div className="db-kpi"><label>Margem Média</label><strong>{fmtPct(stats.margin)}</strong><small>resultado ÷ receita</small></div><div className="db-kpi"><label>NPS Médio</label><strong>{stats.nps ?? 'N/D'}</strong><small>{stats.nps ? 'média da planilha' : 'sem coluna NPS'}</small></div></div></article>;
      })}</div>
    </section>

    <section id="analises" className="db-section"><div className="db-section-title"><h2>Análises de Vendas</h2><span>Receita por mês e por produto</span></div><div className="db-grid-2"><article className="db-panel"><h3>Gráfico de receita por mês</h3><p>Colunas comparativas de Gasolina, Etanol e Díesel.</p><MonthlyChart monthly={data.monthly} /><div className="db-legend">{PRODUCTS.map((product) => <span key={product}><i style={{ background: COLORS[product] }} />{product}</span>)}</div></article><article className="db-panel"><h3>Breakdown por produto</h3><p>Participação de cada produto na receita total.</p><DonutChart data={data} /><table className="db-table"><thead><tr><th>Produto</th><th>Part.</th><th>Receita</th></tr></thead><tbody>{PRODUCTS.map((product) => { const revenue = data.stats[product].revenue; return <tr key={product}><td><i style={{ background: COLORS[product] }} />{product}</td><td>{fmtPct((revenue / (totalRevenue || 1)) * 100)}</td><td>{fmtBRL(revenue)}</td></tr>; })}</tbody></table></article></div><div className="db-grid-3">{PRODUCTS.map((product) => { const stats = data.stats[product]; const share = (stats.revenue / (totalRevenue || 1)) * 100; return <article className="db-panel" key={product}><h3>{product}</h3><p>Indicadores consolidados por produto.</p><div className="db-share"><span style={{ width: `${share}%`, background: COLORS[product] }} /></div><table className="db-table db-simple-table"><tbody><tr><td>Receita</td><td>{fmtBRL(stats.revenue)}</td></tr><tr><td>Volume vendido</td><td>{fmtNum(stats.qty)}</td></tr><tr><td>Ticket médio</td><td>{fmtBRL(stats.ticket)}</td></tr><tr><td>Margem</td><td>{fmtPct(stats.margin)}</td></tr></tbody></table></article>; })}</div></section>

    <section id="simulador" className="db-section"><div className="db-section-title"><h2>Simulador de Previsão</h2><span>Próximos 6 meses</span></div><div className="db-simulator"><article className="db-panel"><h3>Parâmetros de Crescimento</h3><p>Ajuste crescimento e mix de produtos para projetar receita.</p><label className="db-control"><span>Crescimento mensal esperado <b>{growth}%</b></span><input type="range" min="-10" max="30" value={growth} onChange={(e) => setGrowth(Number(e.target.value))} /></label><label className="db-control"><span>Mix Gasolina <b>{Math.round(normalizedMix.gas)}%</b></span><input type="range" min="0" max="100" value={gasMix} onChange={(e) => setGasMix(Number(e.target.value))} /></label><label className="db-control"><span>Mix Etanol <b>{Math.round(normalizedMix.eta)}%</b></span><input type="range" min="0" max="100" value={etaMix} onChange={(e) => setEtaMix(Number(e.target.value))} /></label><label className="db-control"><span>Mix Díesel <b>{Math.round(normalizedMix.diesel)}%</b></span><input type="range" min="0" max="100" value={dieselMix} onChange={(e) => setDieselMix(Number(e.target.value))} /></label><div className="db-mixbar"><span style={{ width: `${normalizedMix.gas}%`, background: COLORS.Gasolina }} /><span style={{ width: `${normalizedMix.eta}%`, background: COLORS.Etanol }} /><span style={{ width: `${normalizedMix.diesel}%`, background: COLORS.Díesel }} /></div><ProjectionChart values={projection} /></article><article className="db-panel db-dark-panel"><h3>Projeção de Receita</h3><p>Base usada: receita do último mês com dados na planilha.</p>{projection.map((item) => <div className="db-projection-row" key={item.label}><span>{item.label}</span><strong>{fmtBRL(item.total)}</strong></div>)}<div className="db-total-proj">{fmtBRL(projectionTotal)}</div><small>A projeção é uma simulação simples: receita base × crescimento composto mensal × mix definido nos sliders.</small></article></div></section>
  </div>;
}
