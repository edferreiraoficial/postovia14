import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

const API_BASE = `${import.meta.env.VITE_API_URL || ''}/api`;

const CAMPOS_PADRAO = [
  { key: 'conta01', label: 'SPOT', largura: 'valor12' },
  { key: 'conta02', label: 'Itaú', largura: 'valor12' },
  { key: 'conta03', label: 'SPOT Lucila', largura: 'valor12' },
  { key: 'conta11', label: 'Caixa', largura: 'valor12' },
  { key: 'conta12', label: 'Cartão', largura: 'valor12' },
  { key: 'conta13', label: 'Vendas', largura: 'valor12' },
  { key: 'prod1_quant', label: 'GC Quant', largura: 'valor9' },
  { key: 'prod1_valor', label: 'GC Valor', largura: 'valor9' },
  { key: 'prod1_total', label: 'GC Total', largura: 'valor12' },
  { key: 'prod2_quant', label: 'EH Quant', largura: 'valor9' },
  { key: 'prod2_valor', label: 'EH Valor', largura: 'valor9' },
  { key: 'prod2_total', label: 'EH Total', largura: 'valor12' },
  { key: 'prod3_quant', label: 'S10 Quant', largura: 'valor9' },
  { key: 'prod3_valor', label: 'S10 Valor', largura: 'valor9' },
  { key: 'prod3_total', label: 'S10 Total', largura: 'valor12' },
  { key: 'prod4_quant', label: 'GC-A Quant', largura: 'valor9' },
  { key: 'prod4_valor', label: 'GC-A Valor', largura: 'valor9' },
  { key: 'prod4_total', label: 'GC-A Total', largura: 'valor12' },
  { key: 'conta21', label: 'Investidor Eraldo', largura: 'valor12' },
  { key: 'conta23', label: 'Empréstimos', largura: 'valor12' },
  { key: 'conta24', label: 'Fornecedores', largura: 'valor12' },
  { key: 'total', label: 'Total', largura: 'valor12' },
];

type CampoFinanceiro = { key: string; label: string; largura: string };

type Linha = Record<string, any>;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const inicioMes = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };
const fimMes = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
const dataBr = (v: string) => { const [a, m, d] = String(v || '').slice(0, 10).split('-'); return a && m && d ? `${d}/${m}/${a}` : v; };
const numero2 = (v: any) => { const n = Number(v || 0); return n === 0 ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
const numero6 = (v: any) => { const n = Number(v || 0); return n === 0 ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 6, maximumFractionDigits: 6 }); };
const numeroInteiro = (v: any) => { const n = Number(v || 0); return n === 0 ? '' : Math.round(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); };
const formatarNumeroCampo = (campo: string, valor: any) => {
  if (/^prod[1-4]_valor$/.test(campo)) return numero6(valor);
  if (/^prod[1-4]_quant$/.test(campo)) return numeroInteiro(valor);
  return numero2(valor);
};
const escapar = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ehSaldo = (l: Linha) => String(l.descricao_normalizada || l.descricao_original || '').toUpperCase().startsWith('SALDO');

export default function FinanceiroGeralAdminPage() {
  const [dataInicial, setDataInicial] = useState('2025-09-04');
  const [dataFinal, setDataFinal] = useState(fimMes());
  const [descricao, setDescricao] = useState('');
  const [origem, setOrigem] = useState('');
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(200);
  const [campos, setCampos] = useState<CampoFinanceiro[]>(CAMPOS_PADRAO);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [totais, setTotais] = useState<Linha>({});
  const [ultimoSaldo, setUltimoSaldo] = useState<Linha>({});
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [somenteMovimento, setSomenteMovimento] = useState(true);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [rascunho, setRascunho] = useState<Linha>({});
  const [salvando, setSalvando] = useState(false);
  const [dataTravaConsolidacao, setDataTravaConsolidacao] = useState('');
  const salvandoRef = useRef(false);
  const tabelaWrapRef = useRef<HTMLDivElement | null>(null);
  const scrollRodapeRef = useRef<HTMLDivElement | null>(null);
  const scrollRodapeConteudoRef = useRef<HTMLDivElement | null>(null);
  const cabecalhoFlutuanteRef = useRef<HTMLDivElement | null>(null);

  const colunasVisiveis = useMemo(() => campos.filter((campo) => {
    // Vendas é uma coluna operacional permanente e não deve desaparecer quando
    // o filtro de colunas com movimento estiver habilitado.
    if (!somenteMovimento || campo.key === 'total' || campo.key === 'conta12' || campo.key === 'conta13') return true;
    return Math.abs(Number(totais[campo.key] || 0)) > 0 || linhas.some((l) => Math.abs(Number(l[campo.key] || 0)) > 0);
  }), [somenteMovimento, totais, linhas, campos]);
  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / porPagina));


  const parametros = (incluirPaginacao = true) => {
    const p = new URLSearchParams({ empresaId: '1', dataInicial, dataFinal });
    if (descricao.trim()) p.set('descricao', descricao.trim());
    if (origem) p.set('origem', origem);
    if (incluirPaginacao) { p.set('pagina', String(pagina)); p.set('porPagina', String(porPagina)); }
    return p;
  };

  const carregar = async () => {
    setCarregando(true); setMensagem('');
    try {
      const res = await fetch(`${API_BASE}/financeiro-geral/lancamentos?${parametros().toString()}`);
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(dados.erro || 'Erro ao carregar lançamentos.');
      setLinhas(dados.lancamentos || []); setTotais(dados.totais || {}); setUltimoSaldo(dados.ultimoSaldo || {});
      if (Array.isArray(dados.colunas) && dados.colunas.length) {
        // Cartão é uma coluna estrutural e deve existir mesmo que a API não a devolva
        // por ausência momentânea de movimento ou de mapeamento.
        const recebidas = dados.colunas as CampoFinanceiro[];
        const cartaoPadrao = CAMPOS_PADRAO.find((campo) => campo.key === 'conta12')!;
        const semCartao = recebidas.filter((campo) => campo.key !== 'conta12');
        const indiceCaixa = semCartao.findIndex((campo) => campo.key === 'conta11');
        const indiceVendas = semCartao.findIndex((campo) => campo.key === 'conta13');
        const posicaoCartao = indiceCaixa >= 0
          ? indiceCaixa + 1
          : (indiceVendas >= 0 ? indiceVendas : Math.max(0, semCartao.findIndex((campo) => campo.key === 'total')));
        const comCartao = [...semCartao];
        comCartao.splice(posicaoCartao, 0, cartaoPadrao);
        setCampos(comCartao);
      }
      setTotalRegistros(Number(dados.paginacao?.total || 0)); setEditandoId(null);
    } catch (e: any) { setMensagem(e.message || 'Erro ao carregar lançamentos.'); }
    finally { setCarregando(false); }
  };
  useEffect(() => {
    fetch(`${API_BASE}/configuracoes-financeiro?empresaId=1`)
      .then((res) => res.json())
      .then((dados) => setDataTravaConsolidacao(dados.dataTravaConsolidacao || ''))
      .catch(() => setDataTravaConsolidacao(''));
  }, []);
  useEffect(() => { carregar(); }, [pagina, porPagina]);
  useEffect(() => {
    const tabela = tabelaWrapRef.current;
    const barra = scrollRodapeRef.current;
    const conteudo = scrollRodapeConteudoRef.current;
    const cabecalhoFlutuante = cabecalhoFlutuanteRef.current;
    if (!tabela || !barra || !conteudo || !cabecalhoFlutuante) return;
    const areaRolagem = tabela.closest('.admin-content') as HTMLElement | null;

    let sincronizandoTabela = false;
    let sincronizandoBarra = false;
    let arrastando = false;
    let inicioX = 0;
    let inicioY = 0;
    let inicioScroll = 0;
    let inicioScrollVertical = 0;
    let rolagemVerticalNaTabela = false;
    const atualizarCabecalhoFlutuante = () => {
      const tabelaHtml = tabela.querySelector('table') as HTMLTableElement | null;
      if (!tabelaHtml) return;
      const wrapRect = tabela.getBoundingClientRect();
      const tableRect = tabelaHtml.getBoundingClientRect();
      const topoArea = areaRolagem ? Math.max(0, areaRolagem.getBoundingClientRect().top) : 0;
      const alturaCabecalho = (tabelaHtml.tHead?.getBoundingClientRect().height || 34);
      const mostrar = tableRect.top < topoArea && tableRect.bottom > topoArea + alturaCabecalho;
      cabecalhoFlutuante.classList.toggle('is-visible', mostrar);
      cabecalhoFlutuante.style.left = `${wrapRect.left}px`;
      cabecalhoFlutuante.style.top = `${topoArea}px`;
      cabecalhoFlutuante.style.width = `${wrapRect.width}px`;
      const mesa = cabecalhoFlutuante.querySelector('table') as HTMLTableElement | null;
      if (mesa) {
        const origem = Array.from(tabelaHtml.tHead?.rows[0]?.cells || []);
        const destino = Array.from(mesa.tHead?.rows[0]?.cells || []);
        const colunasDestino = Array.from(mesa.querySelectorAll('col')) as HTMLTableColElement[];
        const larguraTabela = tabelaHtml.scrollWidth;

        mesa.style.width = `${larguraTabela}px`;
        mesa.style.minWidth = `${larguraTabela}px`;
        mesa.style.transform = `translateX(${-tabela.scrollLeft}px)`;
        mesa.style.position = 'relative';

        origem.forEach((celula, indice) => {
          const largura = celula.getBoundingClientRect().width;
          const col = colunasDestino[indice];
          const th = destino[indice] as HTMLTableCellElement | undefined;
          if (col) {
            col.style.width = `${largura}px`;
            col.style.minWidth = `${largura}px`;
            col.style.maxWidth = `${largura}px`;
          }
          if (th) {
            th.style.width = `${largura}px`;
            th.style.minWidth = `${largura}px`;
            th.style.maxWidth = `${largura}px`;
            th.style.height = `${alturaCabecalho}px`;
            th.style.boxSizing = 'border-box';
          }
        });
      }
    };
    const atualizarLargura = () => {
      conteudo.style.width = `${tabela.scrollWidth}px`;
      barra.scrollLeft = tabela.scrollLeft;
      atualizarCabecalhoFlutuante();
    };
    const aoRolarTabela = () => {
      if (sincronizandoBarra) return;
      sincronizandoTabela = true;
      barra.scrollLeft = tabela.scrollLeft;
      sincronizandoTabela = false;
      atualizarCabecalhoFlutuante();
    };
    const aoRolarBarra = () => {
      if (sincronizandoTabela) return;
      sincronizandoBarra = true;
      tabela.scrollLeft = barra.scrollLeft;
      sincronizandoBarra = false;
    };
    const iniciarArraste = (evento: MouseEvent) => {
      if (evento.button !== 0 || (evento.target as HTMLElement).closest('input, button, select, a')) return;
      arrastando = true;
      inicioX = evento.clientX;
      inicioY = evento.clientY;
      inicioScroll = tabela.scrollLeft;
      rolagemVerticalNaTabela = tabela.scrollHeight > tabela.clientHeight;
      inicioScrollVertical = rolagemVerticalNaTabela ? tabela.scrollTop : window.scrollY;
      tabela.classList.add('is-dragging');
      evento.preventDefault();
    };
    const moverArraste = (evento: MouseEvent) => {
      if (!arrastando) return;
      tabela.scrollLeft = inicioScroll - (evento.clientX - inicioX);
      const destinoVertical = inicioScrollVertical - (evento.clientY - inicioY);
      if (rolagemVerticalNaTabela) tabela.scrollTop = destinoVertical;
      else window.scrollTo(window.scrollX, destinoVertical);
      evento.preventDefault();
    };
    const finalizarArraste = () => {
      if (!arrastando) return;
      arrastando = false;
      tabela.classList.remove('is-dragging');
    };

    atualizarLargura();
    tabela.addEventListener('scroll', aoRolarTabela, { passive: true });
    barra.addEventListener('scroll', aoRolarBarra, { passive: true });
    tabela.addEventListener('mousedown', iniciarArraste);
    window.addEventListener('mousemove', moverArraste);
    window.addEventListener('mouseup', finalizarArraste);
    const aoRolarPagina = () => atualizarCabecalhoFlutuante();
    areaRolagem?.addEventListener('scroll', aoRolarPagina, { passive: true });
    window.addEventListener('scroll', aoRolarPagina, { passive: true });
    const observer = new ResizeObserver(atualizarLargura);
    observer.observe(tabela);
    const tabelaHtml = tabela.querySelector('table');
    if (tabelaHtml) observer.observe(tabelaHtml);
    window.addEventListener('resize', atualizarLargura);

    return () => {
      tabela.removeEventListener('scroll', aoRolarTabela);
      barra.removeEventListener('scroll', aoRolarBarra);
      tabela.removeEventListener('mousedown', iniciarArraste);
      window.removeEventListener('mousemove', moverArraste);
      window.removeEventListener('mouseup', finalizarArraste);
      areaRolagem?.removeEventListener('scroll', aoRolarPagina);
      window.removeEventListener('scroll', aoRolarPagina);
      observer.disconnect();
      window.removeEventListener('resize', atualizarLargura);
    };
  }, [linhas, colunasVisiveis]);
  const aplicarFiltros = () => { setPagina(1); if (pagina === 1) carregar(); };

  const iniciarEdicao = (linha: Linha) => { setEditandoId(Number(linha.id)); setRascunho({ ...linha, data_lancamento: String(linha.data_lancamento).slice(0, 10) }); setMensagem(''); };
  const cancelarEdicao = () => {
    if (!salvandoRef.current) {
      setEditandoId(null);
      setRascunho({});
    }
  };
  const teclaEdicao = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void salvarEdicao(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelarEdicao(); }
  };
  const formatarCelula = (linha: Linha, campo: string) => formatarNumeroCampo(campo, linha[campo]);
  const alterar = (campo: string, valor: any) => setRascunho((r) => ({ ...r, [campo]: valor }));
  const salvarEdicao = async () => {
    if (!editandoId || salvandoRef.current) return;
    salvandoRef.current = true;
    setSalvando(true); setMensagem('');
    try {
      const res = await fetch(`${API_BASE}/financeiro-geral/lancamentos/${editandoId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rascunho) });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(dados.erro || 'Erro ao salvar lançamento.');
      setEditandoId(null); setMensagem('Lançamento salvo e cálculos posteriores refeitos.'); await carregar();
    } catch (e: any) { setMensagem(e.message || 'Erro ao salvar lançamento.'); }
    finally { salvandoRef.current = false; setSalvando(false); }
  };

  const baixarExcel = async () => {
    try { const p = parametros(false); p.set('colunas', colunasVisiveis.map((c) => c.key).join(',')); const res = await fetch(`${API_BASE}/financeiro-geral/excel?${p}`); if (!res.ok) throw new Error('Erro ao gerar Excel.'); const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `financeiro_geral_${dataInicial}_${dataFinal}.xlsx`; a.click(); URL.revokeObjectURL(url); } catch (e: any) { setMensagem(e.message); }
  };

  const consolidarFinanceiroGeral = async () => {
    const confirmar = window.confirm(
      `Consolidar os lançamentos financeiros no período de ${dataBr(dataInicial)} a ${dataBr(dataFinal)}?\n\n` +
      'Os lançamentos já consolidados serão atualizados sem duplicação.'
    );
    if (!confirmar) return;

    setCarregando(true);
    setMensagem('Consolidando os lançamentos do período...');
    try {
      const res = await fetch(`${API_BASE}/financeiro-geral/consolidar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa_id: 1, dataInicial, dataFinal }),
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok || !dados.ok) throw new Error(dados.erro || 'Erro ao consolidar os lançamentos.');

      const semMapeamento = dados.resultado?.contasSemMapeamento || [];
      const complemento = semMapeamento.length
        ? ` Contas sem vinculação: ${semMapeamento.map((item: any) => item.nome).join(', ')}.`
        : '';
      setPagina(1);
      setMensagem(`${dados.mensagem || 'Financeiro Geral consolidado com sucesso.'}${complemento}`);
      await carregar();
    } catch (e: any) {
      setMensagem(e.message || 'Erro ao consolidar os lançamentos.');
    } finally {
      setCarregando(false);
    }
  };

  const reconsolidarDoZero = async () => {
    const confirmar = window.confirm(
      `ATENÇÃO: todos os lançamentos consolidados serão eliminados e recriados do zero.\n\n` +
      `Período que será recriado: ${dataBr(dataInicial)} a ${dataBr(dataFinal)}.\n\nSomente os dados desse período serão consolidados.\nDeseja continuar?`
    );
    if (!confirmar) return;
    setCarregando(true); setMensagem('Eliminando a consolidação atual e recriando os lançamentos...');
    try {
      const res = await fetch(`${API_BASE}/financeiro-geral/reconsolidar-zero`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa_id: 1, dataInicial, dataFinal }),
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok || !dados.ok) throw new Error(dados.erro || 'Erro ao reconsolidar os lançamentos.');
      setPagina(1); setMensagem(dados.mensagem || 'Financeiro Geral recriado com sucesso.');
      await carregar();
    } catch (e: any) { setMensagem(e.message || 'Erro ao reconsolidar os lançamentos.'); }
    finally { setCarregando(false); }
  };

  const gerarPdf = async (resumido: boolean) => {
    try {
      const p = parametros(false); p.set('colunas', colunasVisiveis.map((c) => c.key).join(','));
      const res = await fetch(`${API_BASE}/financeiro-geral/relatorio?${p}&resumido=${resumido ? '1' : '0'}`); const dados = await res.json(); if (!res.ok) throw new Error(dados.erro);
      const janela = window.open('', '_blank'); if (!janela) throw new Error('Permita pop-ups para gerar o PDF.'); const colunas = dados.colunas || [];
      const corpo = resumido ? `<table><thead><tr><th>Conta / Produto</th><th>Entradas</th><th>Saídas</th><th>Saldo movimentado</th></tr></thead><tbody>${(dados.resumo || []).map((r: any) => `<tr><td>${escapar(r.label)}</td><td class="n">${numero2(r.entradas)}</td><td class="n">${numero2(r.saidas)}</td><td class="n">${numero2(r.saldo)}</td></tr>`).join('')}</tbody></table>` : `<table><thead><tr><th>Data</th><th>Descrição</th><th>Origem</th>${colunas.map((c: any) => `<th>${escapar(c.label)}</th>`).join('')}</tr></thead><tbody>${(dados.lancamentos || []).map((l: any) => `<tr class="${ehSaldo(l) ? 'saldo' : ''}"><td>${dataBr(l.data_lancamento)}</td><td>${escapar(l.descricao_original || l.descricao_normalizada)}</td><td>${escapar(l.origem || '')}</td>${colunas.map((c: any) => `<td class="n">${formatarNumeroCampo(c.key, l[c.key])}</td>`).join('')}</tr>`).join('')}<tr class="tot"><td colspan="3">TOTAIS</td>${colunas.map((c: any) => `<td class="n">${formatarNumeroCampo(c.key, dados.totais?.[c.key])}</td>`).join('')}</tr></tbody></table>`;
      janela.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Financeiro Geral</title><style>@page{size:landscape;margin:7mm}body{font-family:Arial;font-size:8px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:3px}th{background:#dfe7f0}.n{text-align:right;white-space:nowrap}.saldo{font-weight:bold;background:#cbd6e2}.tot{font-weight:bold;background:#e1e8f0}</style></head><body><h1>Financeiro Geral — ${resumido ? 'Resumo' : 'Detalhado'}</h1><p>${dataBr(dataInicial)} a ${dataBr(dataFinal)}</p>${corpo}<script>window.onload=()=>window.print()<\/script></body></html>`); janela.document.close();
    } catch (e: any) { setMensagem(e.message || 'Erro ao gerar PDF.'); }
  };

  return <section className="financeiro-geral-page">
    <header className="admin-page-heading financeiro-geral-heading">
      <div><h1>Financeiro Geral</h1><p>Visualize, edite e exporte os lançamentos consolidados.{dataTravaConsolidacao ? ` Alterações bloqueadas até ${dataBr(dataTravaConsolidacao)}.` : ''}</p></div>
    </header>
    <div className="admin-card financeiro-geral-filtros">
      <label>Data inicial<input type="date" value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} /></label>
      <label>Data final<input type="date" value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} /></label>
      <label className="fg-busca">Descrição<input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Buscar descrição" /></label>
      <label>Origem<select value={origem} onChange={(e) => setOrigem(e.target.value)}><option value="">Todas</option><option>SPOT</option><option>ITAU</option><option>COMPRAS</option><option>LMC</option><option>MANUAL</option><option>PLANILHA</option><option>SISTEMA</option></select></label>
      <button className="admin-primary-button fg-acao" onClick={aplicarFiltros}>Atualizar</button>
      <button className="admin-primary-button fg-acao" onClick={baixarExcel}>Excel</button>
      <button className="admin-primary-button fg-acao" onClick={() => gerarPdf(false)}>PDF detalhado</button>
      <button className="admin-primary-button fg-acao" onClick={() => gerarPdf(true)}>PDF resumido</button>
    </div>
    {mensagem && <div className="admin-message error">{mensagem}</div>}
    <div className="financeiro-geral-paginacao">
      <label className="form-check financeiro-geral-movimento"><input className="form-check-input" type="checkbox" checked={somenteMovimento} onChange={(e) => setSomenteMovimento(e.target.checked)} /><span className="form-check-label">Exibir apenas colunas com movimento</span></label>
      <div className="financeiro-geral-processamento">
        <button type="button" className="admin-primary-button" onClick={consolidarFinanceiroGeral} disabled={carregando}>Consolidar</button>
        <button type="button" className="admin-primary-button" onClick={reconsolidarDoZero} disabled={carregando}>Recriar do zero</button>
      </div>
      <div className="financeiro-geral-paginacao-direita" data-layout="linhas-e-paginas">
        <label className="financeiro-geral-linhas-pagina">Linhas por página<select value={porPagina} onChange={e => { setPorPagina(Number(e.target.value)); setPagina(1); }}><option>25</option><option>50</option><option>100</option><option>200</option><option>500</option></select></label>
        <div className="financeiro-geral-navegacao" aria-label="Navegação de páginas">
          <button type="button" title="Primeira página" aria-label="Primeira página" onClick={() => setPagina(1)} disabled={pagina <= 1}>&lt;&lt;</button>
          <button type="button" title="Página anterior" aria-label="Página anterior" onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pagina <= 1}>&lt;</button>
          <label className="financeiro-geral-pagina-spin">Página<input type="number" min="1" max={totalPaginas} step="1" value={pagina} onChange={(e) => setPagina(Math.min(totalPaginas, Math.max(1, Number(e.target.value) || 1)))} /><span>de {totalPaginas}</span></label>
          <button type="button" title="Próxima página" aria-label="Próxima página" onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={pagina >= totalPaginas}>&gt;</button>
          <button type="button" title="Última página" aria-label="Última página" onClick={() => setPagina(totalPaginas)} disabled={pagina >= totalPaginas}>&gt;&gt;</button>
        </div>
      </div>
    </div>
    <div ref={cabecalhoFlutuanteRef} className="financeiro-geral-cabecalho-flutuante" aria-hidden="true"><table className="financeiro-geral-tabela"><colgroup><col className="fg-col-data" /><col className="fg-col-descricao" /><col className="fg-col-origem" />{colunasVisiveis.map(c => <col key={c.key} className={`fg-col-${c.largura}`} />)}<col className="fg-col-acoes" /></colgroup><thead><tr><th>Data</th><th>Descrição</th><th>Origem</th>{colunasVisiveis.map(c => <th key={c.key} className={c.key === 'total' ? 'fg-total' : ''}>{c.label}</th>)}<th>Ações</th></tr></thead></table></div>
    <div ref={tabelaWrapRef} className="admin-card financeiro-geral-tabela-wrap"><table className="financeiro-geral-tabela"><colgroup><col className="fg-col-data" /><col className="fg-col-descricao" /><col className="fg-col-origem" />{colunasVisiveis.map(c => <col key={c.key} className={`fg-col-${c.largura}`} />)}<col className="fg-col-acoes" /></colgroup>
      <thead><tr><th>Data</th><th>Descrição</th><th>Origem</th>{colunasVisiveis.map(c => <th key={c.key} className={c.key === 'total' ? 'fg-total' : ''}>{c.label}</th>)}<th>Ações</th></tr></thead>
      <tbody>{carregando ? <tr><td colSpan={4 + colunasVisiveis.length}>Carregando...</td></tr> : linhas.map(l => { const editar = editandoId === Number(l.id); return <tr key={l.id} className={ehSaldo(l) ? 'fg-linha-saldo' : ''}>
        <td onDoubleClick={() => !editar && iniciarEdicao(l)}>{editar && !ehSaldo(l) ? <input autoFocus type="date" value={rascunho.data_lancamento || ''} onChange={e => alterar('data_lancamento', e.target.value)} onKeyDown={teclaEdicao} /> : dataBr(l.data_lancamento)}</td>
        <td className="fg-descricao" onDoubleClick={() => !editar && iniciarEdicao(l)}>{editar && !ehSaldo(l) ? <input value={rascunho.descricao_original || ''} onChange={e => alterar('descricao_original', e.target.value)} onKeyDown={teclaEdicao} /> : (l.descricao_original || l.descricao_normalizada)}</td>
        <td onDoubleClick={() => !editar && !ehSaldo(l) && iniciarEdicao(l)}>{ehSaldo(l) ? '' : (editar ? <input value={rascunho.origem || ''} onChange={e => alterar('origem', e.target.value)} onKeyDown={teclaEdicao} /> : l.origem)}</td>
        {colunasVisiveis.map(c => <td key={c.key} onDoubleClick={() => !editar && c.key !== 'total' && iniciarEdicao(l)} className={`${Number(l[c.key] || 0) < 0 ? 'fg-negativo' : ''} ${c.key === 'total' ? 'fg-total' : ''}`.trim()}>{editar && c.key !== 'total' ? <input className="fg-input-numero" type="number" step={/^prod[1-4]_quant$/.test(c.key) ? "1" : (/^prod[1-4]_valor$/.test(c.key) ? "0.000001" : "0.01")} value={rascunho[c.key] ?? ''} onChange={e => alterar(c.key, e.target.value)} onKeyDown={teclaEdicao} /> : formatarCelula(l, c.key)}</td>)}
        <td className="fg-acoes">{editar ? <><button title="Salvar" aria-label="Salvar" onClick={salvarEdicao} disabled={salvando}>✓</button><button title="Cancelar" aria-label="Cancelar" onClick={cancelarEdicao} disabled={salvando}>×</button></> : <button onClick={() => iniciarEdicao(l)}>Editar</button>}</td>
      </tr>; })}</tbody>
      <tfoot className="financeiro-geral-titulos-rodape"><tr><th></th><th></th><th></th>{colunasVisiveis.map(c => <th key={c.key} className={c.key === 'total' ? 'fg-total' : ''}>{c.label}</th>)}<th>Ações</th></tr></tfoot>
    </table></div>
    <footer className="financeiro-geral-rodape-pagina">
      <span className="financeiro-geral-contagem">{totalRegistros.toLocaleString('pt-BR')} lançamento(s)</span>
      <div ref={scrollRodapeRef} className="financeiro-geral-scroll-rodape" aria-label="Rolagem horizontal da planilha"><div ref={scrollRodapeConteudoRef} /></div>
      <div className="financeiro-geral-paginacao-direita financeiro-geral-paginacao-inferior" data-layout="linhas-e-paginas">
        <label className="financeiro-geral-linhas-pagina">Linhas por página<select value={porPagina} onChange={e => { setPorPagina(Number(e.target.value)); setPagina(1); }}><option>25</option><option>50</option><option>100</option><option>200</option><option>500</option></select></label>
        <div className="financeiro-geral-navegacao" aria-label="Navegação inferior de páginas">
          <button type="button" title="Primeira página" aria-label="Primeira página" onClick={() => setPagina(1)} disabled={pagina <= 1}>&lt;&lt;</button>
          <button type="button" title="Página anterior" aria-label="Página anterior" onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pagina <= 1}>&lt;</button>
          <label className="financeiro-geral-pagina-spin">Página<input type="number" min="1" max={totalPaginas} step="1" value={pagina} onChange={(e) => setPagina(Math.min(totalPaginas, Math.max(1, Number(e.target.value) || 1)))} /><span>de {totalPaginas}</span></label>
          <button type="button" title="Próxima página" aria-label="Próxima página" onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={pagina >= totalPaginas}>&gt;</button>
          <button type="button" title="Última página" aria-label="Última página" onClick={() => setPagina(totalPaginas)} disabled={pagina >= totalPaginas}>&gt;&gt;</button>
        </div>
      </div>
    </footer>
  </section>;
}
