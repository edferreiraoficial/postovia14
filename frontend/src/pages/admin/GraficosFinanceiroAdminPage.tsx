import { useEffect, useMemo, useState } from 'react';

const API_BASE = `${import.meta.env.VITE_API_URL || ''}/api`;
const CORES = {
  TOTAL: '#2563EB',
  GC: '#FBBF24',
  EH: '#84CC16',
  S10: '#F97316',
  GCA: '#FBBF24',
};
const PRODUTOS = [
  { key: 'prod1', nome: 'GC', cor: CORES.GC },
  { key: 'prod2', nome: 'EH', cor: CORES.EH },
  { key: 'prod3', nome: 'S-10', cor: CORES.S10 },
  { key: 'prod4', nome: 'GC-A', cor: CORES.GCA },
] as const;

type Linha = Record<string, any>;
type Serie = { nome: string; valores: number[]; cor: string };
type AbaPrincipal = 'saldo' | 'produtos';
type AbaProduto = 'quantidade' | 'resultado';

const isoLocal = (data: Date) => `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
const inicioAno = () => `${new Date().getFullYear()}-01-01`;
const ontem = () => { const d = new Date(); d.setDate(d.getDate() - 1); return isoLocal(d); };
const dataBr = (valor: string) => { const [a, m, d] = String(valor || '').slice(0, 10).split('-'); return a && m && d ? `${d}/${m}/${a}` : valor; };
const moeda = (valor: number, casas = 2) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: casas, maximumFractionDigits: casas });
const numero = (valor: any) => Number(valor || 0);
const descricao = (linha: Linha) => String(linha.descricao_normalizada || linha.descricao_original || '').toUpperCase();
const nomesMes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function escala20Mil(valores: number[]) {
  const maxAbs = Math.max(20000, ...valores.map((v) => Math.abs(v)));
  return Math.ceil(maxAbs / 20000) * 20000;
}

function caminhoSuave(pontos: Array<{ x: number; y: number }>) {
  if (!pontos.length) return '';
  if (pontos.length === 1) return `M ${pontos[0].x} ${pontos[0].y}`;
  let d = `M ${pontos[0].x} ${pontos[0].y}`;
  for (let i = 0; i < pontos.length - 1; i += 1) {
    const p0 = pontos[Math.max(0, i - 1)];
    const p1 = pontos[i];
    const p2 = pontos[i + 1];
    const p3 = pontos[Math.min(pontos.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function caminhoAreaSaldo(pontos: Array<{ x: number; y: number; valor: number }>, yZero: number, positivo: boolean) {
  if (!pontos.length) return '';
  const partes: string[] = []; let atual: Array<{ x: number; y: number; valor: number }> = [];
  const fechar = () => { if (!atual.length) return; partes.push(`${caminhoSuave(atual)} L ${atual[atual.length - 1].x} ${yZero} L ${atual[0].x} ${yZero} Z`); atual = []; };
  for (let i = 0; i < pontos.length; i += 1) {
    const p = pontos[i]; const dentro = positivo ? p.valor >= 0 : p.valor <= 0;
    if (dentro) atual.push(p);
    if (i < pontos.length - 1) {
      const prox = pontos[i + 1]; const proxDentro = positivo ? prox.valor >= 0 : prox.valor <= 0;
      if (dentro !== proxDentro) {
        const t = Math.abs(p.valor) / (Math.abs(p.valor) + Math.abs(prox.valor));
        const cruzamento = { x: p.x + (prox.x - p.x) * t, y: yZero, valor: 0 };
        atual.push(cruzamento); fechar(); atual.push(cruzamento);
      } else if (!dentro) fechar();
    }
  }
  fechar(); return partes.join(' ');
}

function caminhosLinhaSaldo(pontos: Array<{ x: number; y: number; valor: number }>, yZero: number, positivo: boolean) {
  const partes: string[] = []; let atual: Array<{ x: number; y: number; valor: number }> = [];
  const fechar = () => { if (atual.length > 1) partes.push(caminhoSuave(atual)); atual = []; };
  for (let i = 0; i < pontos.length; i += 1) {
    const p = pontos[i]; const dentro = positivo ? p.valor >= 0 : p.valor <= 0;
    if (dentro) atual.push(p);
    if (i < pontos.length - 1) {
      const prox = pontos[i + 1]; const proxDentro = positivo ? prox.valor >= 0 : prox.valor <= 0;
      if (dentro !== proxDentro) {
        const t = Math.abs(p.valor) / (Math.abs(p.valor) + Math.abs(prox.valor));
        const cruzamento = { x: p.x + (prox.x - p.x) * t, y: yZero, valor: 0 };
        if (dentro) { atual.push(cruzamento); fechar(); }
        else atual = [cruzamento];
      } else if (!dentro) fechar();
    }
  }
  fechar(); return partes;
}

function eixosTempo(datas: string[], x: (i: number) => number, yTopo: number, yBase: number) {
  const meses: Array<{ inicio: number; fim: number; mes: number; ano: number }> = [];
  datas.forEach((data, i) => {
    const dt = new Date(`${data}T12:00:00`); const ultimo = meses[meses.length - 1];
    if (!ultimo || ultimo.mes !== dt.getMonth() || ultimo.ano !== dt.getFullYear()) meses.push({ inicio: i, fim: i, mes: dt.getMonth(), ano: dt.getFullYear() });
    else ultimo.fim = i;
  });
  return <>
    {datas.map((data, i) => Number(data.slice(8, 10)) === 1 ? <line key={`mes-${data}`} x1={x(i)} x2={x(i)} y1={yTopo} y2={yBase} stroke="#b8c0ca" strokeWidth="1.15" /> : null)}
    {datas.map((data, i) => { const dia = Number(data.slice(8, 10)); return (i === 0 || i === datas.length - 1 || dia === 1 || dia % 7 === 0) ? <text key={`dia-${data}`} x={x(i)} y={yBase + 20} textAnchor="middle" className="gf-axis-date">{dia}</text> : null; })}
    {meses.map((m) => <text key={`${m.ano}-${m.mes}`} x={(x(m.inicio) + x(m.fim)) / 2} y={yBase + 42} textAnchor="middle" className="gf-axis-month">{nomesMes[m.mes]}{m.ano !== new Date().getFullYear() ? `/${String(m.ano).slice(-2)}` : ''}</text>)}
  </>;
}

function GraficoAreaSaldo({ datas, valores }: { datas: string[]; valores: number[] }) {
  const [indiceAtivo, setIndiceAtivo] = useState(Math.max(0, valores.length - 1));
  useEffect(() => setIndiceAtivo(Math.max(0, valores.length - 1)), [valores.length]);
  const largura = 1320; const altura = 455; const margem = { topo: 28, direita: 22, baixo: 72, esquerda: 92 };
  const w = largura - margem.esquerda - margem.direita; const h = altura - margem.topo - margem.baixo;
  const maxAbs = escala20Mil(valores); const min = -maxAbs; const max = maxAbs;
  const x = (i: number) => margem.esquerda + (valores.length <= 1 ? w / 2 : (i / (valores.length - 1)) * w);
  const y = (v: number) => margem.topo + ((max - v) / (max - min)) * h;
  const pontos = valores.map((v, i) => ({ x: x(i), y: y(v), valor: v })); const yZero = y(0);
  const ticks: number[] = []; for (let t = -maxAbs; t <= maxAbs; t += 20000) ticks.push(t);
  const valorAtivo = valores[indiceAtivo] ?? 0;
  const linhasPositivas = caminhosLinhaSaldo(pontos, yZero, true);
  const linhasNegativas = caminhosLinhaSaldo(pontos, yZero, false);
  return <div className="gf-chart-shell gf-chart-shell-wide">
    <div className="gf-chart-kpi"><span>{datas[indiceAtivo] ? dataBr(datas[indiceAtivo]) : 'Sem dados'}</span><strong className={valorAtivo < 0 ? 'is-negative' : 'is-positive'}>{moeda(valorAtivo)}</strong><small>Saldo total do dia</small></div>
    <svg className="gf-chart" viewBox={`0 0 ${largura} ${altura}`} role="img" aria-label="Evolução do saldo total por dia">
      <defs><linearGradient id="saldoPositivo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3B82F6" stopOpacity=".38"/><stop offset="1" stopColor="#3B82F6" stopOpacity=".04"/></linearGradient><linearGradient id="saldoNegativo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#EF4444" stopOpacity=".04"/><stop offset="1" stopColor="#EF4444" stopOpacity=".42"/></linearGradient></defs>
      <rect width={largura} height={altura} rx="12" fill="#fff" />
      {ticks.map((tick) => <g key={tick}><line x1={margem.esquerda} x2={largura - margem.direita} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? '#9aa6b2' : '#e8ecf1'} strokeWidth={tick === 0 ? 1.4 : 1}/><text x={margem.esquerda - 10} y={y(tick) + 4} textAnchor="end" className="gf-axis-label">{moeda(tick, 0)}</text></g>)}
      {eixosTempo(datas, x, margem.topo, altura - margem.baixo)}
      <path d={caminhoAreaSaldo(pontos, yZero, true)} fill="url(#saldoPositivo)"/><path d={caminhoAreaSaldo(pontos, yZero, false)} fill="url(#saldoNegativo)"/>
      {linhasPositivas.map((d, i) => <path key={`lp-${i}`} d={d} fill="none" stroke="#1D4ED8" strokeWidth="1.55" strokeLinejoin="round" strokeLinecap="round"/>)}{linhasNegativas.map((d, i) => <path key={`ln-${i}`} d={d} fill="none" stroke="#B91C1C" strokeWidth="1.55" strokeLinejoin="round" strokeLinecap="round"/>)}
      {pontos.map((p, i) => <g key={datas[i]} onMouseEnter={() => setIndiceAtivo(i)} tabIndex={0} className="gf-point-hit"><circle cx={p.x} cy={p.y} r={i === indiceAtivo ? 3.6 : 1.8} fill={p.valor < 0 ? '#B91C1C' : '#1D4ED8'} opacity={i === indiceAtivo ? 1 : .62}/><circle cx={p.x} cy={p.y} r="10" fill="transparent"/></g>)}
    </svg>
  </div>;
}

function GraficoAreaProduto({ datas, serie, moedaValores }: { datas: string[]; serie: Serie; moedaValores?: boolean }) {
  const largura = 1240; const altura = 280; const margem = { topo: 30, direita: 22, baixo: 64, esquerda: 96 };
  const w = largura - margem.esquerda - margem.direita; const h = altura - margem.topo - margem.baixo;
  const minimoSerie = Math.min(0, ...serie.valores); const maximoSerie = Math.max(0, ...serie.valores);
  const passo = moedaValores ? Math.max(500, Math.ceil(Math.max(Math.abs(minimoSerie), Math.abs(maximoSerie), 1) / 5 / 500) * 500) : 500;
  const max = Math.max(passo, Math.ceil(maximoSerie / passo) * passo);
  const min = minimoSerie < 0 ? Math.floor(minimoSerie / passo) * passo : 0;
  const x = (i: number) => margem.esquerda + (datas.length <= 1 ? w / 2 : (i / (datas.length - 1)) * w);
  const y = (v: number) => margem.topo + ((max - v) / (max - min || 1)) * h;
  const pontos = serie.valores.map((v, i) => ({ x: x(i), y: y(v), valor: v })); const yZero = y(0);
  const area = pontos.length ? `${caminhoSuave(pontos)} L ${pontos[pontos.length - 1].x} ${yZero} L ${pontos[0].x} ${yZero} Z` : '';
  const ticks: number[] = []; for (let t = min; t <= max; t += passo) ticks.push(t);
  const gradienteId = `area-${serie.nome.replace(/[^a-z0-9]/gi, '')}`;
  return <article className="gf-product-chart gf-product-chart-row"><div className="gf-product-chart-title"><strong style={{ color: serie.cor }}>{serie.nome}</strong><span>{moedaValores ? 'Resultado líquido diário' : 'Quantidade vendida por dia'}</span></div><svg viewBox={`0 0 ${largura} ${altura}`} role="img" aria-label={`${serie.nome} por dia`}>
    <defs><linearGradient id={gradienteId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={serie.cor} stopOpacity=".27"/><stop offset="1" stopColor={serie.cor} stopOpacity=".025"/></linearGradient></defs>
    <rect width={largura} height={altura} rx="10" fill="#fff"/>
    {ticks.map((tick) => <g key={tick}><line x1={margem.esquerda} x2={largura - margem.direita} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? '#9aa6b2' : '#edf0f4'} strokeWidth={tick === 0 ? 1.25 : 1}/><text x={margem.esquerda - 10} y={y(tick) + 4} textAnchor="end" className="gf-axis-label">{moedaValores ? moeda(tick, 0) : `${tick.toLocaleString('pt-BR')} L`}</text></g>)}
    {eixosTempo(datas, x, margem.topo, altura - margem.baixo)}
    <path d={area} fill={`url(#${gradienteId})`}/><path d={caminhoSuave(pontos)} fill="none" stroke={serie.cor} strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"/>
    {pontos.map((p, i) => <circle key={datas[i]} cx={p.x} cy={p.y} r="1.35" fill={serie.cor} opacity=".62"><title>{`${dataBr(datas[i])}: ${moedaValores ? moeda(p.valor) : `${p.valor.toLocaleString('pt-BR')} L`}`}</title></circle>)}
  </svg></article>;
}

export default function GraficosFinanceiroAdminPage() {
  const [dataInicial, setDataInicial] = useState(inicioAno()); const [dataFinal, setDataFinal] = useState(ontem());
  const [aba, setAba] = useState<AbaPrincipal>('saldo'); const [abaProduto, setAbaProduto] = useState<AbaProduto>('quantidade');
  const [linhas, setLinhas] = useState<Linha[]>([]); const [carregando, setCarregando] = useState(false); const [erro, setErro] = useState('');
  const carregar = async () => {
    setCarregando(true); setErro('');
    try {
      const acumuladas: Linha[] = []; let pagina = 1; let total = Infinity;
      while (acumuladas.length < total && pagina <= 100) {
        const p = new URLSearchParams({ empresaId: '1', dataInicial, dataFinal, pagina: String(pagina), porPagina: '500' });
        const resposta = await fetch(`${API_BASE}/financeiro-geral/lancamentos?${p}`); const dados = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível carregar os dados financeiros.');
        const lote = Array.isArray(dados.lancamentos) ? dados.lancamentos : []; acumuladas.push(...lote.filter((l: Linha) => String(l.data_lancamento || '').slice(0, 10) >= dataInicial));
        total = Number(dados.paginacao?.total || acumuladas.length); if (!lote.length || lote.length < 499) break; pagina += 1;
      }
      setLinhas(acumuladas);
    } catch (e: any) { setErro(e.message || 'Erro ao carregar os gráficos.'); } finally { setCarregando(false); }
  };
  useEffect(() => { carregar(); }, []);
  const dados = useMemo(() => {
    const porData = new Map<string, { saldo?: Linha; vendas: Linha[]; resultado?: Linha }>();
    for (const linha of linhas) {
      const data = String(linha.data_lancamento || '').slice(0, 10); if (!data) continue;
      const item = porData.get(data) || { vendas: [] }; const desc = descricao(linha);
      if (desc.startsWith('SALDO DO DIA')) item.saldo = linha;
      if (String(linha.tipo_lancamento || '').toUpperCase() === 'VENDA' || desc.startsWith('VENDA DE ')) item.vendas.push(linha);
      if (String(linha.tipo_lancamento || '').toUpperCase() === 'RESULTADO' || desc.includes('RESULTADO LIQUIDO DO PRODUTO')) item.resultado = linha;
      porData.set(data, item);
    }
    const datasSaldo = [...porData.entries()].filter(([, v]) => v.saldo).map(([d]) => d).sort();
    const datasProduto = [...porData.entries()].filter(([, v]) => v.vendas.length || v.resultado).map(([d]) => d).sort();
    const saldo = datasSaldo.map((d) => numero(porData.get(d)?.saldo?.total));
    const nomesQuantidade: Record<string, string> = { GC: 'Quantidade total vendida de Gasolina C', EH: 'Quantidade total vendida de Etanol Hidratado', 'S-10': 'Quantidade total vendida de Diesel S-10', 'GC-A': 'Quantidade total vendida de Gasolina C Aditivada' };
    const nomesResultado: Record<string, string> = { GC: 'Resultado líquido de Gasolina C', EH: 'Resultado líquido de Etanol Hidratado', 'S-10': 'Resultado líquido de Diesel S-10', 'GC-A': 'Resultado líquido de Gasolina C Aditivada' };
    const porProduto: Serie[] = PRODUTOS.map((p) => ({ nome: nomesQuantidade[p.nome], cor: p.cor, valores: datasProduto.map((d) => Math.abs((porData.get(d)?.vendas || []).reduce((s, l) => s + numero(l[`${p.key}_quant`]), 0))) }));
    const totalQuantidade: Serie = { nome: 'Quantidade total vendida de todos os produtos', cor: CORES.TOTAL, valores: datasProduto.map((_, i) => porProduto.reduce((s, serie) => s + numero(serie.valores[i]), 0)) };
    const resultadoProdutos: Serie[] = PRODUTOS.map((p) => ({ nome: nomesResultado[p.nome], cor: p.cor, valores: datasProduto.map((d) => numero(porData.get(d)?.resultado?.[`${p.key}_total`])) }));
    const resultadoTotal: Serie = { nome: 'Valor total', cor: CORES.TOTAL, valores: datasProduto.map((_, i) => resultadoProdutos.reduce((s, serie) => s + numero(serie.valores[i]), 0)) };
    return { datasSaldo, saldo, datasProduto, quantidade: [totalQuantidade, ...porProduto], resultado: [resultadoTotal, ...resultadoProdutos] };
  }, [linhas]);

  return <section className="gf-page gf-page-expanded gf-page-no-frame">
    {erro && <div className="gf-alert">{erro}</div>}
    <div className="gf-toolbar gf-toolbar-integrated">
      <nav className="gf-inline-tabs"><button className={aba === 'saldo' ? 'active' : ''} onClick={() => setAba('saldo')}>Evolução Financeira</button><button className={aba === 'produtos' ? 'active' : ''} onClick={() => setAba('produtos')}>Vendas e resultados</button></nav>
      <label>Data inicial<input type="date" value={dataInicial} onChange={(e) => setDataInicial(e.target.value)}/></label><label>Data final<input type="date" value={dataFinal} max={ontem()} onChange={(e) => setDataFinal(e.target.value)}/></label>
      <button className="admin-primary-button" onClick={carregar} disabled={carregando || !dataInicial || !dataFinal}>{carregando ? 'Atualizando…' : 'Atualizar'}</button>
    </div>
    {carregando ? <div className="gf-loading"><span/>Processando dados do Financeiro Geral…</div> : aba === 'saldo' ? <>
      <div className="gf-panel-title gf-panel-title-compact"><h2>Evolução Financeira</h2><strong>{dados.datasSaldo.length} dias</strong></div>
      {dados.datasSaldo.length ? <GraficoAreaSaldo datas={dados.datasSaldo} valores={dados.saldo}/> : <div className="gf-empty">Nenhum “Saldo do dia” encontrado no período.</div>}
    </> : <>
      <div className="gf-products-heading"><h2>Vendas Diárias e Resultado Líquido Total e por Produto</h2><div className="gf-subtabs"><button className={abaProduto === 'quantidade' ? 'active' : ''} onClick={() => setAbaProduto('quantidade')}>Quantidade vendida</button><button className={abaProduto === 'resultado' ? 'active' : ''} onClick={() => setAbaProduto('resultado')}>Resultado líquido</button></div><strong>{dados.datasProduto.length} dias</strong></div>
      {!dados.datasProduto.length ? <div className="gf-empty">Nenhuma venda ou resultado encontrado no período.</div> : <div className="gf-product-grid gf-product-grid-single">{(abaProduto === 'quantidade' ? dados.quantidade : dados.resultado).map((serie) => <GraficoAreaProduto key={serie.nome} datas={dados.datasProduto} serie={serie} moedaValores={abaProduto === 'resultado'}/>)}</div>}
    </>}
  </section>;
}
