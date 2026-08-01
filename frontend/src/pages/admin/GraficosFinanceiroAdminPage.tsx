import { useEffect, useMemo, useState } from 'react';

const API_BASE = `${import.meta.env.VITE_API_URL || ''}/api`;

const PRODUTOS = [
  { key: 'prod1', nome: 'GC' },
  { key: 'prod2', nome: 'EH' },
  { key: 'prod3', nome: 'S10' },
  { key: 'prod4', nome: 'GC-A' },
] as const;

type Linha = Record<string, any>;
type Serie = { nome: string; valores: number[] };
type AbaPrincipal = 'saldo' | 'produtos';
type AbaProduto = 'quantidade' | 'valor' | 'resultado';

const iso = (data: Date) => data.toISOString().slice(0, 10);
const inicioMes = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };
const fimMes = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
const dataBr = (valor: string) => { const [a, m, d] = String(valor || '').slice(0, 10).split('-'); return a && m && d ? `${d}/${m}/${a}` : valor; };
const moeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numero = (valor: any) => Number(valor || 0);
const descricao = (linha: Linha) => String(linha.descricao_normalizada || linha.descricao_original || '').toUpperCase();

function niceMax(valor: number) {
  if (!Number.isFinite(valor) || valor <= 0) return 1;
  const potencia = 10 ** Math.floor(Math.log10(valor));
  return Math.ceil(valor / potencia) * potencia;
}

function carregarCaminhoArea(pontos: Array<{ x: number; y: number; valor: number }>, yZero: number, positivo: boolean) {
  if (!pontos.length) return '';
  const partes: string[] = [];
  let atual: Array<{ x: number; y: number; valor: number }> = [];
  const fechar = () => {
    if (!atual.length) return;
    partes.push(`M ${atual[0].x} ${yZero} L ${atual.map((p) => `${p.x} ${p.y}`).join(' L ')} L ${atual[atual.length - 1].x} ${yZero} Z`);
    atual = [];
  };
  for (let i = 0; i < pontos.length; i += 1) {
    const p = pontos[i];
    const dentro = positivo ? p.valor >= 0 : p.valor <= 0;
    if (dentro) atual.push(p);
    if (i < pontos.length - 1) {
      const prox = pontos[i + 1];
      const proxDentro = positivo ? prox.valor >= 0 : prox.valor <= 0;
      if (dentro !== proxDentro) {
        const t = Math.abs(p.valor) / (Math.abs(p.valor) + Math.abs(prox.valor));
        const cruzamento = { x: p.x + (prox.x - p.x) * t, y: yZero, valor: 0 };
        atual.push(cruzamento);
        fechar();
        atual.push(cruzamento);
      } else if (!dentro) fechar();
    }
  }
  fechar();
  return partes.join(' ');
}

function GraficoAreaSaldo({ datas, valores }: { datas: string[]; valores: number[] }) {
  const [indiceAtivo, setIndiceAtivo] = useState(Math.max(0, valores.length - 1));
  const largura = 1120; const altura = 470;
  const margem = { topo: 42, direita: 30, baixo: 64, esquerda: 88 };
  const w = largura - margem.esquerda - margem.direita;
  const h = altura - margem.topo - margem.baixo;
  const maxAbs = niceMax(Math.max(1, ...valores.map((v) => Math.abs(v))));
  const min = -maxAbs; const max = maxAbs;
  const x = (i: number) => margem.esquerda + (valores.length <= 1 ? w / 2 : (i / (valores.length - 1)) * w);
  const y = (v: number) => margem.topo + ((max - v) / (max - min)) * h;
  const yZero = y(0);
  const pontos = valores.map((v, i) => ({ x: x(i), y: y(v), valor: v }));
  const linha = pontos.length ? `M ${pontos.map((p) => `${p.x} ${p.y}`).join(' L ')}` : '';
  const segundas = datas.map((data, i) => ({ data, i, dia: new Date(`${data}T12:00:00`).getDay() })).filter((p) => p.dia === 1);
  const ticks = [-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs];
  const valorAtivo = valores[indiceAtivo] ?? 0;

  return (
    <div className="gf-chart-shell">
      <div className="gf-chart-kpi" aria-live="polite">
        <span>{datas[indiceAtivo] ? dataBr(datas[indiceAtivo]) : 'Sem dados'}</span>
        <strong className={valorAtivo < 0 ? 'is-negative' : 'is-positive'}>{moeda(valorAtivo)}</strong>
        <small>Saldo total do dia</small>
      </div>
      <svg className="gf-chart" viewBox={`0 0 ${largura} ${altura}`} role="img" aria-label="Evolução do saldo total por dia">
        <defs>
          <linearGradient id="saldoPositivo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1677ff" stopOpacity=".42"/><stop offset="1" stopColor="#1677ff" stopOpacity=".04"/></linearGradient>
          <linearGradient id="saldoNegativo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ef4444" stopOpacity=".05"/><stop offset="1" stopColor="#ef4444" stopOpacity=".46"/></linearGradient>
        </defs>
        <rect x="0" y="0" width={largura} height={altura} rx="18" fill="#fff" />
        {ticks.map((tick) => <g key={tick}><line x1={margem.esquerda} x2={largura - margem.direita} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? '#9aa5b1' : '#e8edf3'} strokeWidth={tick === 0 ? 1.4 : 1}/><text x={margem.esquerda - 12} y={y(tick) + 4} textAnchor="end" className="gf-axis-label">{moeda(tick)}</text></g>)}
        {segundas.map(({ data, i }) => <line key={data} x1={x(i)} x2={x(i)} y1={margem.topo} y2={altura - margem.baixo} stroke="#cbd3dc" strokeDasharray="4 5" />)}
        <path d={carregarCaminhoArea(pontos, yZero, true)} fill="url(#saldoPositivo)" />
        <path d={carregarCaminhoArea(pontos, yZero, false)} fill="url(#saldoNegativo)" />
        <path d={linha} fill="none" stroke="#263647" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        {pontos.map((p, i) => <g key={datas[i]} onMouseEnter={() => setIndiceAtivo(i)} onFocus={() => setIndiceAtivo(i)} tabIndex={0} className="gf-point-hit"><circle cx={p.x} cy={p.y} r={i === indiceAtivo ? 5.5 : 3} fill={p.valor < 0 ? '#dc2626' : '#1266d6'} stroke="#fff" strokeWidth="2"/><circle cx={p.x} cy={p.y} r="13" fill="transparent" /></g>)}
        {datas.map((data, i) => {
          const mostrar = i === 0 || i === datas.length - 1 || new Date(`${data}T12:00:00`).getDay() === 1;
          return mostrar ? <text key={data} x={x(i)} y={altura - 28} textAnchor="middle" className="gf-axis-date">{dataBr(data).slice(0, 5)}</text> : null;
        })}
      </svg>
      <div className="gf-chart-caption"><span><i className="gf-dot blue"/> Acima de zero</span><span><i className="gf-dot red"/> Abaixo de zero</span><span>Linhas verticais: início semanal (segunda-feira)</span></div>
    </div>
  );
}

function GraficoMultiseries({ datas, series, tipo, moedaValores = false }: { datas: string[]; series: Serie[]; tipo: 'barra' | 'linha'; moedaValores?: boolean }) {
  const largura = 1120; const altura = 500;
  const margem = { topo: 38, direita: 30, baixo: 76, esquerda: 88 };
  const w = largura - margem.esquerda - margem.direita;
  const h = altura - margem.topo - margem.baixo;
  const todos = series.flatMap((s) => s.valores);
  const minimoOriginal = Math.min(0, ...todos); const maximoOriginal = Math.max(0, ...todos);
  const limite = niceMax(Math.max(Math.abs(minimoOriginal), Math.abs(maximoOriginal), 1));
  const min = minimoOriginal < 0 ? -limite : 0; const max = limite;
  const y = (v: number) => margem.topo + ((max - v) / (max - min || 1)) * h;
  const yZero = y(0);
  const grupo = datas.length ? w / datas.length : w;
  const cores = ['#1266d6', '#0f9d76', '#f59e0b', '#7c3aed'];
  const ticks = min < 0 ? [min, min / 2, 0, max / 2, max] : [0, max / 4, max / 2, max * .75, max];

  return <div className="gf-chart-shell">
    <svg className="gf-chart" viewBox={`0 0 ${largura} ${altura}`} role="img">
      <rect width={largura} height={altura} rx="18" fill="#fff" />
      {ticks.map((tick) => <g key={tick}><line x1={margem.esquerda} x2={largura - margem.direita} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? '#9aa5b1' : '#e8edf3'} /><text x={margem.esquerda - 12} y={y(tick) + 4} textAnchor="end" className="gf-axis-label">{moedaValores ? moeda(tick) : Math.round(tick).toLocaleString('pt-BR')}</text></g>)}
      {tipo === 'barra' ? series.map((serie, si) => serie.valores.map((valor, i) => {
        const barraW = Math.max(2, Math.min(22, (grupo * .72) / series.length));
        const centro = margem.esquerda + grupo * i + grupo / 2;
        const bx = centro - (barraW * series.length) / 2 + si * barraW;
        const topo = Math.min(y(valor), yZero); const bh = Math.max(1, Math.abs(y(valor) - yZero));
        return <rect key={`${serie.nome}-${i}`} x={bx} y={topo} width={barraW - 1} height={bh} rx="2" fill={valor < 0 ? '#dc2626' : cores[si]}><title>{`${dataBr(datas[i])} — ${serie.nome}: ${moedaValores ? moeda(valor) : valor.toLocaleString('pt-BR')}`}</title></rect>;
      })) : series.map((serie, si) => {
        const pts = serie.valores.map((v, i) => ({ x: margem.esquerda + grupo * i + grupo / 2, y: y(v), v }));
        return <g key={serie.nome}><path d={pts.length ? `M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')}` : ''} fill="none" stroke={cores[si]} strokeWidth="2.6" strokeLinejoin="round"/><g>{pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3.5" fill={cores[si]} stroke="#fff" strokeWidth="1.5"><title>{`${dataBr(datas[i])} — ${serie.nome}: ${moedaValores ? moeda(p.v) : p.v.toLocaleString('pt-BR')}`}</title></circle>)}</g></g>;
      })}
      {datas.map((data, i) => {
        const passo = Math.max(1, Math.ceil(datas.length / 12));
        return (i % passo === 0 || i === datas.length - 1) ? <text key={data} x={margem.esquerda + grupo * i + grupo / 2} y={altura - 32} textAnchor="middle" className="gf-axis-date">{dataBr(data).slice(0, 5)}</text> : null;
      })}
    </svg>
    <div className="gf-chart-caption">{series.map((serie, i) => <span key={serie.nome}><i className="gf-dot" style={{ background: cores[i] }}/>{serie.nome}</span>)}</div>
  </div>;
}

export default function GraficosFinanceiroAdminPage() {
  const [dataInicial, setDataInicial] = useState(inicioMes());
  const [dataFinal, setDataFinal] = useState(fimMes());
  const [aba, setAba] = useState<AbaPrincipal>('saldo');
  const [abaProduto, setAbaProduto] = useState<AbaProduto>('quantidade');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = async () => {
    setCarregando(true); setErro('');
    try {
      const acumuladas: Linha[] = [];
      let pagina = 1; let total = Infinity;
      while (acumuladas.length < total && pagina <= 100) {
        const p = new URLSearchParams({ empresaId: '1', dataInicial, dataFinal, pagina: String(pagina), porPagina: '500' });
        const resposta = await fetch(`${API_BASE}/financeiro-geral/lancamentos?${p}`);
        const dados = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível carregar os dados financeiros.');
        const lote = Array.isArray(dados.lancamentos) ? dados.lancamentos : [];
        acumuladas.push(...lote.filter((l: Linha) => String(l.data_lancamento || '').slice(0, 10) >= dataInicial));
        total = Number(dados.paginacao?.total || acumuladas.length);
        if (!lote.length || lote.length < 499) break;
        pagina += 1;
      }
      setLinhas(acumuladas);
    } catch (e: any) { setErro(e.message || 'Erro ao carregar os gráficos.'); }
    finally { setCarregando(false); }
  };

  useEffect(() => { carregar(); }, []);

  const dados = useMemo(() => {
    const porData = new Map<string, { saldo?: Linha; vendas: Linha[]; resultado?: Linha }>();
    for (const linha of linhas) {
      const data = String(linha.data_lancamento || '').slice(0, 10);
      if (!data) continue;
      const item = porData.get(data) || { vendas: [] };
      const desc = descricao(linha);
      if (desc.startsWith('SALDO DO DIA')) item.saldo = linha;
      if (String(linha.tipo_lancamento || '').toUpperCase() === 'VENDA' || desc.startsWith('VENDA DE ')) item.vendas.push(linha);
      if (String(linha.tipo_lancamento || '').toUpperCase() === 'RESULTADO' || desc.includes('RESULTADO LIQUIDO DO PRODUTO')) item.resultado = linha;
      porData.set(data, item);
    }
    const datasSaldo = [...porData.entries()].filter(([, v]) => v.saldo).map(([d]) => d).sort();
    const datasProduto = [...porData.entries()].filter(([, v]) => v.vendas.length || v.resultado).map(([d]) => d).sort();
    const saldo = datasSaldo.map((d) => numero(porData.get(d)?.saldo?.total));
    const quantidade: Serie[] = PRODUTOS.map((p) => ({ nome: p.nome, valores: datasProduto.map((d) => Math.abs((porData.get(d)?.vendas || []).reduce((s, l) => s + numero(l[`${p.key}_quant`]), 0))) }));
    const valor: Serie[] = PRODUTOS.map((p) => ({ nome: p.nome, valores: datasProduto.map((d) => Math.abs((porData.get(d)?.vendas || []).reduce((s, l) => s + numero(l[`${p.key}_total`]), 0))) }));
    const resultado: Serie[] = PRODUTOS.map((p) => ({ nome: p.nome, valores: datasProduto.map((d) => numero(porData.get(d)?.resultado?.[`${p.key}_total`])) }));
    return { datasSaldo, saldo, datasProduto, quantidade, valor, resultado };
  }, [linhas]);

  return <section className="gf-page">
    <header className="gf-header"><div><span className="gf-eyebrow">Inteligência financeira</span><h1>Gráficos do Financeiro Geral</h1><p>Acompanhe patrimônio, vendas e rentabilidade dos produtos em uma visão executiva.</p></div><div className="gf-header-badge">Atualização sob demanda</div></header>

    <div className="gf-toolbar">
      <label>Data inicial<input type="date" value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} /></label>
      <label>Data final<input type="date" value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} /></label>
      <button className="admin-primary-button" onClick={carregar} disabled={carregando || !dataInicial || !dataFinal}>{carregando ? 'Atualizando…' : 'Atualizar gráficos'}</button>
    </div>

    {erro && <div className="gf-alert">{erro}</div>}

    <nav className="gf-page-tabs" aria-label="Páginas de gráficos">
      <button className={aba === 'saldo' ? 'active' : ''} onClick={() => setAba('saldo')}><span>01</span><strong>Saldo total</strong><small>Área patrimonial</small></button>
      <button className={aba === 'produtos' ? 'active' : ''} onClick={() => setAba('produtos')}><span>02</span><strong>Vendas e resultados</strong><small>Produtos por dia</small></button>
    </nav>

    <div className="gf-panel">
      {carregando ? <div className="gf-loading"><span/>Processando dados do Financeiro Geral…</div> : aba === 'saldo' ? <>
        <div className="gf-panel-title"><div><h2>Evolução do saldo total</h2><p>Fechamento diário da coluna Total, com destaque visual para valores positivos e negativos.</p></div><strong>{dados.datasSaldo.length} dias</strong></div>
        {dados.datasSaldo.length ? <GraficoAreaSaldo datas={dados.datasSaldo} valores={dados.saldo}/> : <div className="gf-empty">Nenhum “Saldo do dia” encontrado no período.</div>}
      </> : <>
        <div className="gf-panel-title"><div><h2>Vendas e resultado líquido por produto</h2><p>Comparativo diário entre GC, EH, S10 e GC-A.</p></div><strong>{dados.datasProduto.length} dias</strong></div>
        <div className="gf-subtabs">
          <button className={abaProduto === 'quantidade' ? 'active' : ''} onClick={() => setAbaProduto('quantidade')}>Quantidade vendida</button>
          <button className={abaProduto === 'valor' ? 'active' : ''} onClick={() => setAbaProduto('valor')}>Valor das vendas</button>
          <button className={abaProduto === 'resultado' ? 'active' : ''} onClick={() => setAbaProduto('resultado')}>Resultado líquido</button>
        </div>
        {!dados.datasProduto.length ? <div className="gf-empty">Nenhuma venda ou resultado encontrado no período.</div> : abaProduto === 'quantidade' ? <GraficoMultiseries datas={dados.datasProduto} series={dados.quantidade} tipo="barra"/> : abaProduto === 'valor' ? <GraficoMultiseries datas={dados.datasProduto} series={dados.valor} tipo="linha" moedaValores/> : <GraficoMultiseries datas={dados.datasProduto} series={dados.resultado} tipo="barra" moedaValores/>}
      </>}
    </div>
  </section>;
}
