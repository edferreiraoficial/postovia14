import { useEffect, useMemo, useState } from 'react';

const API_BASE = `${import.meta.env.VITE_API_URL || ''}/api`;
const PRODUTOS = [
  { key: 'prod1', nome: 'GC', cor: '#1266d6' },
  { key: 'prod2', nome: 'EH', cor: '#0f9d76' },
  { key: 'prod3', nome: 'S10', cor: '#f59e0b' },
  { key: 'prod4', nome: 'GC-A', cor: '#7c3aed' },
] as const;

type Linha = Record<string, any>;
type Serie = { nome: string; valores: number[]; cor?: string };
type AbaPrincipal = 'saldo' | 'produtos';
type AbaProduto = 'quantidade' | 'resultado';

const isoLocal = (data: Date) => {
  const a = data.getFullYear(); const m = String(data.getMonth() + 1).padStart(2, '0'); const d = String(data.getDate()).padStart(2, '0');
  return `${a}-${m}-${d}`;
};
const inicioAno = () => `${new Date().getFullYear()}-01-01`;
const ontem = () => { const d = new Date(); d.setDate(d.getDate() - 1); return isoLocal(d); };
const dataBr = (valor: string) => { const [a, m, d] = String(valor || '').slice(0, 10).split('-'); return a && m && d ? `${d}/${m}/${a}` : valor; };
const moeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numero = (valor: any) => Number(valor || 0);
const descricao = (linha: Linha) => String(linha.descricao_normalizada || linha.descricao_original || '').toUpperCase();
const nomesMes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function niceMax(valor: number) {
  if (!Number.isFinite(valor) || valor <= 0) return 1;
  const potencia = 10 ** Math.floor(Math.log10(valor));
  return Math.ceil(valor / potencia) * potencia;
}

function caminhoArea(pontos: Array<{ x: number; y: number; valor: number }>, yZero: number, positivo: boolean) {
  if (!pontos.length) return '';
  const partes: string[] = []; let atual: Array<{ x: number; y: number; valor: number }> = [];
  const fechar = () => { if (!atual.length) return; partes.push(`M ${atual[0].x} ${yZero} L ${atual.map((p) => `${p.x} ${p.y}`).join(' L ')} L ${atual[atual.length - 1].x} ${yZero} Z`); atual = []; };
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

function eixosTempo(datas: string[], x: (i: number) => number, yTopo: number, yBase: number) {
  const meses: Array<{ inicio: number; fim: number; mes: number; ano: number }> = [];
  datas.forEach((data, i) => {
    const dt = new Date(`${data}T12:00:00`); const chave = `${dt.getFullYear()}-${dt.getMonth()}`;
    const ultimo = meses[meses.length - 1];
    if (!ultimo || `${ultimo.ano}-${ultimo.mes}` !== chave) meses.push({ inicio: i, fim: i, mes: dt.getMonth(), ano: dt.getFullYear() });
    else ultimo.fim = i;
  });
  return <>
    {datas.map((data, i) => {
      const dia = Number(data.slice(8, 10));
      if (dia !== 1) return null;
      return <line key={`mes-${data}`} x1={x(i)} x2={x(i)} y1={yTopo} y2={yBase} stroke="#aeb7c2" strokeWidth="1.2" />;
    })}
    {datas.map((data, i) => {
      const dia = Number(data.slice(8, 10));
      const mostrar = i === 0 || i === datas.length - 1 || dia === 1 || dia % 7 === 0;
      return mostrar ? <text key={`dia-${data}`} x={x(i)} y={yBase + 24} textAnchor="middle" className="gf-axis-date">{dia}</text> : null;
    })}
    {meses.map((m) => <text key={`${m.ano}-${m.mes}`} x={(x(m.inicio) + x(m.fim)) / 2} y={yBase + 48} textAnchor="middle" className="gf-axis-month">{nomesMes[m.mes]}{m.ano !== new Date().getFullYear() ? `/${String(m.ano).slice(-2)}` : ''}</text>)}
  </>;
}

function GraficoAreaSaldo({ datas, valores }: { datas: string[]; valores: number[] }) {
  const [indiceAtivo, setIndiceAtivo] = useState(Math.max(0, valores.length - 1));
  useEffect(() => setIndiceAtivo(Math.max(0, valores.length - 1)), [valores.length]);
  const largura = 1320; const altura = 600; const margem = { topo: 38, direita: 24, baixo: 88, esquerda: 96 };
  const w = largura - margem.esquerda - margem.direita; const h = altura - margem.topo - margem.baixo;
  const maxAbs = niceMax(Math.max(1, ...valores.map((v) => Math.abs(v)))); const min = -maxAbs; const max = maxAbs;
  const x = (i: number) => margem.esquerda + (valores.length <= 1 ? w / 2 : (i / (valores.length - 1)) * w);
  const y = (v: number) => margem.topo + ((max - v) / (max - min)) * h;
  const pontos = valores.map((v, i) => ({ x: x(i), y: y(v), valor: v }));
  const yZero = y(0);
  const linha = pontos.length ? `M ${pontos.map((p) => `${p.x} ${p.y}`).join(' L ')}` : '';
  const ticks = [-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs]; const valorAtivo = valores[indiceAtivo] ?? 0;
  return <div className="gf-chart-shell gf-chart-shell-wide">
    <div className="gf-chart-kpi" aria-live="polite"><span>{datas[indiceAtivo] ? dataBr(datas[indiceAtivo]) : 'Sem dados'}</span><strong className={valorAtivo < 0 ? 'is-negative' : 'is-positive'}>{moeda(valorAtivo)}</strong><small>Saldo total do dia</small></div>
    <svg className="gf-chart" viewBox={`0 0 ${largura} ${altura}`} role="img" aria-label="Evolução do saldo total por dia">
      <defs><linearGradient id="saldoPositivo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1677ff" stopOpacity=".42"/><stop offset="1" stopColor="#1677ff" stopOpacity=".04"/></linearGradient><linearGradient id="saldoNegativo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ef4444" stopOpacity=".05"/><stop offset="1" stopColor="#ef4444" stopOpacity=".46"/></linearGradient></defs>
      <rect width={largura} height={altura} rx="14" fill="#fff" />
      {ticks.map((tick) => <g key={tick}><line x1={margem.esquerda} x2={largura - margem.direita} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? '#7f8a96' : '#e6eaf0'} strokeWidth={tick === 0 ? 1.5 : 1}/><text x={margem.esquerda - 12} y={y(tick) + 4} textAnchor="end" className="gf-axis-label">{moeda(tick)}</text></g>)}
      {eixosTempo(datas, x, margem.topo, altura - margem.baixo)}
      <path d={caminhoArea(pontos, yZero, true)} fill="url(#saldoPositivo)"/><path d={caminhoArea(pontos, yZero, false)} fill="url(#saldoNegativo)"/><path d={linha} fill="none" stroke="#263647" strokeWidth="2.3" strokeLinejoin="round" strokeLinecap="round"/>
      {pontos.map((p, i) => <g key={datas[i]} onMouseEnter={() => setIndiceAtivo(i)} onFocus={() => setIndiceAtivo(i)} tabIndex={0} className="gf-point-hit"><circle cx={p.x} cy={p.y} r={i === indiceAtivo ? 5.5 : 2.7} fill={p.valor < 0 ? '#dc2626' : '#1266d6'} stroke="#fff" strokeWidth="2"/><circle cx={p.x} cy={p.y} r="12" fill="transparent"/></g>)}
    </svg>
    <div className="gf-chart-caption"><span><i className="gf-dot blue"/> Acima de zero</span><span><i className="gf-dot red"/> Abaixo de zero</span><span>Linhas verticais: primeiro dia de cada mês</span></div>
  </div>;
}

function GraficoProduto({ datas, serie, moedaValores }: { datas: string[]; serie: Serie; moedaValores?: boolean }) {
  const largura = 640; const altura = 300; const margem = { topo: 34, direita: 18, baixo: 66, esquerda: 76 };
  const w = largura - margem.esquerda - margem.direita; const h = altura - margem.topo - margem.baixo;
  const limite = niceMax(Math.max(1, ...serie.valores.map((v) => Math.abs(v)))); const min = Math.min(0, ...serie.valores) < 0 ? -limite : 0; const max = limite;
  const x = (i: number) => margem.esquerda + (datas.length <= 1 ? w / 2 : (i / (datas.length - 1)) * w);
  const y = (v: number) => margem.topo + ((max - v) / (max - min || 1)) * h;
  const pontos = serie.valores.map((v, i) => ({ x: x(i), y: y(v), v }));
  const ticks = min < 0 ? [min, 0, max] : [0, max / 2, max];
  return <article className="gf-product-chart"><div className="gf-product-chart-title"><strong>{serie.nome}</strong><span>{moedaValores ? 'Resultado líquido diário' : 'Quantidade vendida por dia'}</span></div><svg viewBox={`0 0 ${largura} ${altura}`} role="img" aria-label={`${serie.nome} por dia`}>
    <rect width={largura} height={altura} rx="12" fill="#fff"/>
    {ticks.map((tick) => <g key={tick}><line x1={margem.esquerda} x2={largura - margem.direita} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? '#7f8a96' : '#e6eaf0'} strokeWidth={tick === 0 ? 1.5 : 1}/><text x={margem.esquerda - 8} y={y(tick) + 4} textAnchor="end" className="gf-axis-label">{moedaValores ? moeda(tick) : Math.round(tick).toLocaleString('pt-BR')}</text></g>)}
    {eixosTempo(datas, x, margem.topo, altura - margem.baixo)}
    <path d={pontos.length ? `M ${pontos.map((p) => `${p.x} ${p.y}`).join(' L ')}` : ''} fill="none" stroke={serie.cor || '#1266d6'} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
    {pontos.map((p, i) => <circle key={datas[i]} cx={p.x} cy={p.y} r="3" fill={serie.cor || '#1266d6'} stroke="#fff" strokeWidth="1.4"><title>{`${dataBr(datas[i])}: ${moedaValores ? moeda(p.v) : p.v.toLocaleString('pt-BR')}`}</title></circle>)}
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
    const quantidade: Serie[] = PRODUTOS.map((p) => ({ nome: p.nome, cor: p.cor, valores: datasProduto.map((d) => Math.abs((porData.get(d)?.vendas || []).reduce((s, l) => s + numero(l[`${p.key}_quant`]), 0))) }));
    const resultado: Serie[] = PRODUTOS.map((p) => ({ nome: p.nome, cor: p.cor, valores: datasProduto.map((d) => numero(porData.get(d)?.resultado?.[`${p.key}_total`])) }));
    return { datasSaldo, saldo, datasProduto, quantidade, resultado };
  }, [linhas]);

  return <section className="gf-page gf-page-expanded">
    {erro && <div className="gf-alert">{erro}</div>}
    <div className="gf-panel gf-panel-main">
      <div className="gf-toolbar gf-toolbar-integrated">
        <nav className="gf-inline-tabs" aria-label="Páginas de gráficos"><button className={aba === 'saldo' ? 'active' : ''} onClick={() => setAba('saldo')}>Saldo total</button><button className={aba === 'produtos' ? 'active' : ''} onClick={() => setAba('produtos')}>Vendas e resultados</button></nav>
        <label>Data inicial<input type="date" value={dataInicial} onChange={(e) => setDataInicial(e.target.value)}/></label><label>Data final<input type="date" value={dataFinal} max={ontem()} onChange={(e) => setDataFinal(e.target.value)}/></label>
        <button className="admin-primary-button" onClick={carregar} disabled={carregando || !dataInicial || !dataFinal}>{carregando ? 'Atualizando…' : 'Atualizar'}</button>
      </div>
      {carregando ? <div className="gf-loading"><span/>Processando dados do Financeiro Geral…</div> : aba === 'saldo' ? <>
        <div className="gf-panel-title gf-panel-title-compact"><div><h2>Evolução do saldo total</h2></div><strong>{dados.datasSaldo.length} dias</strong></div>
        {dados.datasSaldo.length ? <GraficoAreaSaldo datas={dados.datasSaldo} valores={dados.saldo}/> : <div className="gf-empty">Nenhum “Saldo do dia” encontrado no período.</div>}
      </> : <>
        <div className="gf-products-heading"><div><h2>Vendas e resultado líquido por produto</h2></div><div className="gf-subtabs"><button className={abaProduto === 'quantidade' ? 'active' : ''} onClick={() => setAbaProduto('quantidade')}>Quantidade vendida</button><button className={abaProduto === 'resultado' ? 'active' : ''} onClick={() => setAbaProduto('resultado')}>Resultado líquido</button></div><strong>{dados.datasProduto.length} dias</strong></div>
        {!dados.datasProduto.length ? <div className="gf-empty">Nenhuma venda ou resultado encontrado no período.</div> : <div className="gf-product-grid">{(abaProduto === 'quantidade' ? dados.quantidade : dados.resultado).map((serie) => <GraficoProduto key={serie.nome} datas={dados.datasProduto} serie={serie} moedaValores={abaProduto === 'resultado'}/>)}</div>}
      </>}
    </div>
  </section>;
}
