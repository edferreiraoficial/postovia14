import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../store/auth';
import { hasPermission } from '../../authPermissions';

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
const diaSeguinte = (valor: string) => { const [a, m, d] = String(valor || '').slice(0, 10).split('-').map(Number); if (!a || !m || !d) return valor; return iso(new Date(a, m - 1, d + 1)); };
const diaAnterior = (valor: string) => { const [a, m, d] = String(valor || '').slice(0, 10).split('-').map(Number); if (!a || !m || !d) return valor; return iso(new Date(a, m - 1, d - 1)); };
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
const ehSaldoAnterior = (l: Linha) => { const d = String(l.descricao_normalizada || l.descricao_original || '').toUpperCase(); return d.startsWith('SALDO ANTERIOR') || d.startsWith('SALDO INICIAL DO DIA'); };
const classeLarguraCampo = (campo: CampoFinanceiro) => {
  if (['conta01', 'conta02', 'conta03', 'conta11', 'conta12', 'conta13', 'conta21', 'conta23', 'conta24'].includes(campo.key)) return 'fg-col-w90';
  if (/^prod[1-4]_(quant|valor)$/.test(campo.key)) return 'fg-col-w60';
  return `fg-col-${campo.largura}`;
};

export default function FinanceiroGeralAdminPage() {
  const { user } = useAuth();
  const podeNumeroLancamento = hasPermission(user, 'numero_lancamento');
  const [dataInicial, setDataInicial] = useState('');
  const [dataFinal, setDataFinal] = useState(fimMes());
  const [descricao, setDescricao] = useState('');
  const [origem, setOrigem] = useState('');
  const [contaFiltro, setContaFiltro] = useState('');
  const [valorExato, setValorExato] = useState('');
  const [valorMinimo, setValorMinimo] = useState('');
  const [valorMaximo, setValorMaximo] = useState('');
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(500);
  const [campos, setCampos] = useState<CampoFinanceiro[]>(CAMPOS_PADRAO);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [totais, setTotais] = useState<Linha>({});
  const [ultimoSaldo, setUltimoSaldo] = useState<Linha>({});
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [detalheDia, setDetalheDia] = useState<any | null>(null);
  const [carregandoDetalheDia, setCarregandoDetalheDia] = useState(false);
  const [somenteMovimento, setSomenteMovimento] = useState(true);
  const [numeroEditando, setNumeroEditando] = useState<number | null>(null);
  const [dataInicialNumero, setDataInicialNumero] = useState('');
  const [modoRenumeracao, setModoRenumeracao] = useState<'ajuste' | 'inicial'>('ajuste');
  const [ajusteNumero, setAjusteNumero] = useState('0');
  const [numeroInicialRenumeracao, setNumeroInicialRenumeracao] = useState('1');
  const [senhaAdministrativa, setSenhaAdministrativa] = useState('');
  const [salvandoNumero, setSalvandoNumero] = useState(false);
  const [dataTravaConsolidacao, setDataTravaConsolidacao] = useState('');
  const [configuracaoFinanceiraCarregada, setConfiguracaoFinanceiraCarregada] = useState(false);
  const [novoLancamentoAberto, setNovoLancamentoAberto] = useState(false);
  const [novoLancamento, setNovoLancamento] = useState<Linha>({ data_lancamento: iso(new Date()), descricao_original: '', origem: 'MANUAL' });
  const [incluindo, setIncluindo] = useState(false);
  const [senhaEdicaoSaldo, setSenhaEdicaoSaldo] = useState('');
  const [lancamentoEditandoId, setLancamentoEditandoId] = useState<number | null>(null);
  const [dataLinhaSelecionada, setDataLinhaSelecionada] = useState('');
  const [excluindoId, setExcluindoId] = useState<number | null>(null);
  const [recriarAberto, setRecriarAberto] = useState(false);
  const [atualizarSaldosAberto, setAtualizarSaldosAberto] = useState(false);
  const [colunasAtualizarSaldo, setColunasAtualizarSaldo] = useState<string[]>([]);
  const [recriarDataInicial, setRecriarDataInicial] = useState('');
  const [recriarDataFinal, setRecriarDataFinal] = useState(fimMes());
  const [recriarColuna, setRecriarColuna] = useState('TODAS');
  const tabelaWrapRef = useRef<HTMLDivElement | null>(null);
  const scrollRodapeRef = useRef<HTMLDivElement | null>(null);
  const scrollRodapeConteudoRef = useRef<HTMLDivElement | null>(null);
  const cabecalhoFlutuanteRef = useRef<HTMLDivElement | null>(null);
  const campoDataLancamentoRef = useRef<HTMLInputElement | null>(null);

  const colunasVisiveis = useMemo(() => campos.filter((campo) => {
    // Vendas é uma coluna operacional permanente e não deve desaparecer quando
    // o filtro de colunas com movimento estiver habilitado.
    if (!somenteMovimento || campo.key === 'total' || campo.key === 'conta12' || campo.key === 'conta13') return true;
    return Math.abs(Number(totais[campo.key] || 0)) > 0 || linhas.some((l) => Math.abs(Number(l[campo.key] || 0)) > 0);
  }), [somenteMovimento, totais, linhas, campos]);
  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / porPagina));


  const abrirDetalheSaldoDia = async (linha: Linha) => {
    const descricaoLinha = String(linha.descricao_normalizada || linha.descricao_original || '').toUpperCase();
    if (!descricaoLinha.startsWith('SALDO DO DIA')) return;
    const data = String(linha.data_lancamento || '').slice(0, 10);
    if (!data) return;
    setCarregandoDetalheDia(true);
    setMensagem('');
    try {
      const res = await fetch(`${API_BASE}/financeiro-geral/detalhe-dia?empresaId=1&data=${encodeURIComponent(data)}`);
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(dados.erro || 'Erro ao carregar os dados do dia.');
      setDetalheDia(dados);
    } catch (e: any) {
      setMensagem(e.message || 'Erro ao carregar os dados do dia.');
    } finally {
      setCarregandoDetalheDia(false);
    }
  };

  const parametros = (incluirPaginacao = true) => {
    const p = new URLSearchParams({ empresaId: '1', dataInicial, dataFinal });
    if (descricao.trim()) p.set('descricao', descricao.trim());
    if (origem) p.set('origem', origem);
    if (contaFiltro) p.set('conta', contaFiltro);
    if (valorExato !== '') p.set('valorExato', valorExato);
    if (valorMinimo !== '') p.set('valorMinimo', valorMinimo);
    if (valorMaximo !== '') p.set('valorMaximo', valorMaximo);
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
      setTotalRegistros(Number(dados.paginacao?.total || 0));
    } catch (e: any) { setMensagem(e.message || 'Erro ao carregar lançamentos.'); }
    finally { setCarregando(false); }
  };
  useEffect(() => {
    fetch(`${API_BASE}/configuracoes-financeiro?empresaId=1`)
      .then((res) => res.json())
      .then((dados) => {
        const dataTrava = String(dados.dataTravaConsolidacao || '').slice(0, 10);
        setDataTravaConsolidacao(dataTrava);
        setDataInicial(dataTrava ? diaSeguinte(dataTrava) : inicioMes());
      })
      .catch(() => {
        setDataTravaConsolidacao('');
        setDataInicial(inicioMes());
      })
      .finally(() => setConfiguracaoFinanceiraCarregada(true));
  }, []);
  useEffect(() => {
    if (configuracaoFinanceiraCarregada && dataInicial) carregar();
  }, [pagina, porPagina, configuracaoFinanceiraCarregada]);
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
      const topoArea = 0;
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
            th.style.transform = '';
          }
        });

        // O cabeçalho flutuante acompanha a rolagem horizontal da tabela.
        // As posições das colunas fixas são calculadas pela largura acumulada,
        // evitando que Data, Descrição, Total e Ações se desloquem.
        const larguras = origem.map((celula) => celula.getBoundingClientRect().width);
        const deslocamentos: number[] = [];
        let acumulado = 0;
        larguras.forEach((largura) => {
          deslocamentos.push(acumulado);
          acumulado += largura;
        });

        const indiceTotal = 3 + colunasVisiveis.findIndex((campo) => campo.key === 'total');
        const scrollX = tabela.scrollLeft;

        // O elemento table inteiro é deslocado para acompanhar o scroll. Estas
        // compensações mantêm Data e Descrição paradas no lado esquerdo.
        [0, 1].forEach((indice) => {
          const th = destino[indice] as HTMLTableCellElement | undefined;
          if (th) th.style.transform = `translate3d(${scrollX}px,0,0)`;
        });

        // Total é a última coluna fixa à direita. Não existe mais coluna Ações.
        const total = indiceTotal >= 3 ? destino[indiceTotal] as HTMLTableCellElement | undefined : undefined;
        if (total) {
          const larguraTotal = larguras[indiceTotal] || 90;
          const deltaTotal = wrapRect.width - larguraTotal - deslocamentos[indiceTotal] + scrollX;
          total.style.transform = `translate3d(${deltaTotal}px,0,0)`;
        }
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
  const limparFiltrosBusca = () => {
    setDescricao(''); setOrigem(''); setContaFiltro(''); setValorExato(''); setValorMinimo(''); setValorMaximo('');
    setPagina(1);
    setTimeout(() => carregar(), 0);
  };

  const travarPeriodoPelaDataInicial = async () => {
    if (!dataInicial) { setMensagem('Informe a data inicial antes de travar o período.'); return; }
    const novaTrava = diaAnterior(dataInicial);
    let senhaAdministrativa = '';
    if (dataTravaConsolidacao && novaTrava < dataTravaConsolidacao) {
      senhaAdministrativa = window.prompt(`A nova trava ${dataBr(novaTrava)} é anterior à trava atual ${dataBr(dataTravaConsolidacao)}. Informe a senha administrativa para autorizar:`) || '';
      if (!senhaAdministrativa) return;
    }
    if (!window.confirm(`Deseja travar o Financeiro Geral até ${dataBr(novaTrava)}?`)) return;
    setMensagem('');
    try {
      const resposta = await fetch(`${API_BASE}/configuracoes-financeiro`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresaId: 1, dataTravaConsolidacao: novaTrava, senhaAdministrativa }),
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível alterar a trava do período.');
      setDataTravaConsolidacao(novaTrava);
      setMensagem(dados.mensagem || `Período travado até ${dataBr(novaTrava)}.`);
    } catch (e: any) { setMensagem(e.message || 'Erro ao travar o período.'); }
  };

  const formatarCelula = (linha: Linha, campo: string) => formatarNumeroCampo(campo, linha[campo]);

  const abrirNovoLancamento = () => {
    setLancamentoEditandoId(null);
    setNovoLancamento({
      data_lancamento: '',
      descricao_original: '',
      origem: 'MANUAL',
      ...Object.fromEntries(campos.filter((c) => c.key !== 'total').map((c) => [c.key, ''])),
    });
    setMensagem('');
    setNovoLancamentoAberto(true);
    window.setTimeout(() => campoDataLancamentoRef.current?.focus(), 0);
  };

  const prepararInclusaoNoModal = () => {
    setLancamentoEditandoId(null);
    setNovoLancamento({
      data_lancamento: '',
      descricao_original: '',
      origem: 'MANUAL',
      ...Object.fromEntries(campos.filter((c) => c.key !== 'total').map((c) => [c.key, ''])),
    });
    setMensagem('Informe a data para incluir o novo lançamento.');
    window.setTimeout(() => campoDataLancamentoRef.current?.focus(), 0);
  };

  const abrirLancamentoParaEdicao = (linha: Linha) => {
    if (ehSaldo(linha) && !ehSaldoAnterior(linha)) {
      setMensagem('Somente o Saldo anterior pode ser alterado. O Saldo do dia é calculado automaticamente.');
      return;
    }
    const dataLinha = String(linha.data_lancamento || '').slice(0, 10);
    if (!ehSaldoAnterior(linha) && dataTravaConsolidacao && dataLinha && dataLinha <= dataTravaConsolidacao) {
      setMensagem(`Este lançamento não pode ser alterado ou excluído porque a data ${dataBr(dataLinha)} é igual ou anterior à data travada ${dataBr(dataTravaConsolidacao)}.`);
      return;
    }
    setDataLinhaSelecionada(dataLinha);
    setLancamentoEditandoId(Number(linha.id));
    setNovoLancamento({
      ...linha,
      data_lancamento: String(linha.data_lancamento || '').slice(0, 10),
      descricao_original: linha.descricao_original || linha.descricao_normalizada || '',
      ...Object.fromEntries(campos.filter((c) => c.key !== 'total').map((c) => [c.key, linha[c.key] ?? ''])),
    });
    setSenhaEdicaoSaldo('');
    setMensagem('');
    setNovoLancamentoAberto(true);
  };

  const fecharModalLancamento = () => {
    if (incluindo || excluindoId !== null) return;
    setNovoLancamentoAberto(false);
    setLancamentoEditandoId(null);
  };

  const salvarNovoLancamento = async () => {
    if (incluindo) return;
    const dataInformada = String(novoLancamento.data_lancamento || '').slice(0, 10);
    if (!dataInformada) {
      setMensagem('Informe a data do lançamento.');
      return;
    }
    const editandoSaldoAnterior = lancamentoEditandoId !== null && ehSaldoAnterior(novoLancamento);
    if (!editandoSaldoAnterior && dataTravaConsolidacao && dataInformada <= dataTravaConsolidacao) {
      setMensagem(`Não é permitido salvar lançamento com data igual ou anterior à data travada ${dataBr(dataTravaConsolidacao)}.`);
      return;
    }
    if (editandoSaldoAnterior && !senhaEdicaoSaldo.trim()) {
      setMensagem('Informe a senha administrativa para alterar o Saldo anterior.');
      return;
    }
    if (!String(novoLancamento.descricao_original || '').trim()) {
      setMensagem('Informe a descrição do lançamento.');
      return;
    }
    setIncluindo(true); setMensagem('');
    try {
      const editando = lancamentoEditandoId !== null;
      const res = await fetch(editando
        ? `${API_BASE}/financeiro-geral/lancamentos/${lancamentoEditandoId}`
        : `${API_BASE}/financeiro-geral/lancamentos`, {
        method: editando ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editando ? { ...novoLancamento, senhaAdministrativa: senhaEdicaoSaldo } : { empresa_id: 1, ...novoLancamento }),
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok || dados.ok === false) throw new Error(dados.erro || (editando ? 'Erro ao alterar lançamento.' : 'Erro ao incluir lançamento.'));
      setNovoLancamentoAberto(false);
      setLancamentoEditandoId(null);
      if (!editando) setPagina(1);
      setMensagem(editando ? 'Lançamento alterado e saldos posteriores recalculados.' : 'Novo lançamento incluído e saldos posteriores recalculados.');
      await carregar();
    } catch (e: any) { setMensagem(e.message || 'Erro ao salvar lançamento.'); }
    finally { setIncluindo(false); }
  };

  const excluirLancamentoEmEdicao = async () => {
    if (lancamentoEditandoId === null || excluindoId !== null) return;
    const confirmar = window.confirm(`Excluir o lançamento "${novoLancamento.descricao_original || ''}"?`);
    if (!confirmar) return;
    const senha = window.prompt('Digite a senha para confirmar a exclusão:');
    if (senha === null) return;
    setExcluindoId(lancamentoEditandoId); setMensagem('');
    try {
      const res = await fetch(`${API_BASE}/financeiro-geral/lancamentos/${lancamentoEditandoId}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha }),
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok || !dados.ok) throw new Error(dados.erro || 'Erro ao excluir lançamento.');
      setNovoLancamentoAberto(false);
      setLancamentoEditandoId(null);
      setMensagem('Lançamento excluído e saldos posteriores recalculados.');
      await carregar();
    } catch (e: any) { setMensagem(e.message || 'Erro ao excluir lançamento.'); }
    finally { setExcluindoId(null); }
  };

  const baixarExcel = async () => {
    try { const p = parametros(false); p.set('colunas', colunasVisiveis.map((c) => c.key).join(',')); const res = await fetch(`${API_BASE}/financeiro-geral/excel?${p}`); if (!res.ok) throw new Error('Erro ao gerar Excel.'); const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `financeiro_geral_${dataInicial}_${dataFinal}.xlsx`; a.click(); URL.revokeObjectURL(url); } catch (e: any) { setMensagem(e.message); }
  };

  const abrirAtualizacaoSaldos = () => {
    setColunasAtualizarSaldo(campos.filter((c) => c.key !== 'total').map((c) => c.key));
    const primeiroSaldoVisivel = linhas.find((linha) => ehSaldoAnterior(linha)) || linhas.find((linha) => ehSaldo(linha));
    if (primeiroSaldoVisivel?.data_lancamento) {
      const dataSaldo = String(primeiroSaldoVisivel.data_lancamento).slice(0, 10);
      const minimoLiberado = dataTravaConsolidacao ? diaSeguinte(dataTravaConsolidacao) : dataSaldo;
      setDataInicial(dataSaldo < minimoLiberado ? minimoLiberado : dataSaldo);
    }
    setAtualizarSaldosAberto(true);
  };

  const alternarColunaSaldo = (campo: string) => {
    setColunasAtualizarSaldo((atuais) => atuais.includes(campo) ? atuais.filter((item) => item !== campo) : [...atuais, campo]);
  };

  const atualizarSaldosFinanceiroGeral = async () => {
    if (!dataInicial || !dataFinal) { setMensagem('Informe o período inicial e final.'); return; }
    if (!colunasAtualizarSaldo.length) { setMensagem('Selecione pelo menos uma coluna para recalcular.'); return; }
    setCarregando(true);
    setMensagem('Atualizando os saldos do período...');
    try {
      const res = await fetch(`${API_BASE}/financeiro-geral/atualizar-saldos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa_id: 1, dataInicial, dataFinal, colunas: colunasAtualizarSaldo, saldoInicialId: Number((linhas.find((linha) => ehSaldoAnterior(linha)) || linhas.find((linha) => ehSaldo(linha)))?.id || 0) || null }),
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok || !dados.ok) throw new Error(dados.erro || 'Erro ao atualizar os saldos.');
      setAtualizarSaldosAberto(false);
      setMensagem(dados.mensagem || 'Saldos atualizados com sucesso.');
      await carregar();
    } catch (e: any) {
      setMensagem(e.message || 'Erro ao atualizar os saldos.');
    } finally {
      setCarregando(false);
    }
  };

  const abrirRecriacao = () => {
    const inicioPermitido = dataTravaConsolidacao ? diaSeguinte(dataTravaConsolidacao) : dataInicial;
    setRecriarDataInicial(inicioPermitido || inicioMes());
    setRecriarDataFinal(dataFinal || fimMes());
    setRecriarColuna('TODAS');
    setRecriarAberto(true);
  };

  const reconsolidarDoZero = async () => {
    const periodoInicial = recriarDataInicial;
    const periodoFinal = recriarDataFinal;
    if (!periodoInicial || !periodoFinal) { setMensagem('Informe o período inicial e final para recriar.'); return; }
    if (periodoInicial > periodoFinal) { setMensagem('A data inicial não pode ser posterior à data final.'); return; }
    const campoSelecionado = recriarColuna === 'TODAS' ? null : campos.find((c) => c.key === recriarColuna);
    const nomeColuna = campoSelecionado?.label || 'Todas as colunas';
    const confirmar = window.confirm(
      `ATENÇÃO: a recriação será executada para ${nomeColuna}.\n\n` +
      `Período: ${dataBr(periodoInicial)} a ${dataBr(periodoFinal)}.\n\nDeseja continuar?`
    );
    if (!confirmar) return;

    setCarregando(true);
    setMensagem(`Recriando ${nomeColuna} no período selecionado...`);
    try {
      const res = await fetch(`${API_BASE}/financeiro-geral/reconsolidar-zero`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa_id: 1, dataInicial: periodoInicial, dataFinal: periodoFinal, coluna: recriarColuna }),
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok || !dados.ok) throw new Error(dados.erro || 'Erro ao recriar os lançamentos.');
      setDataInicial(periodoInicial);
      setDataFinal(periodoFinal);
      setPagina(1);
      setRecriarAberto(false);
      setMensagem(dados.mensagem || 'Financeiro Geral recriado com sucesso.');
      await carregar();
    } catch (e: any) { setMensagem(e.message || 'Erro ao recriar os lançamentos.'); }
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

  const abrirAjusteNumero = (linha: Linha) => {
    if (!podeNumeroLancamento) return;
    const numero = Number(linha.id);
    setNumeroEditando(numero);
    setDataInicialNumero(String(linha.data_lancamento || '').slice(0, 10));
    setModoRenumeracao('ajuste');
    setAjusteNumero('0');
    setNumeroInicialRenumeracao(String(numero));
    setSenhaAdministrativa('');
    setMensagem('');
  };

  const salvarAjusteNumero = async (event: FormEvent) => {
    event.preventDefault();
    if (!numeroEditando || !podeNumeroLancamento) return;
    setSalvandoNumero(true); setMensagem('');
    try {
      const res = await fetch(`${API_BASE}/financeiro-geral/lancamentos/${numeroEditando}/numero`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modo: modoRenumeracao, dataInicial: dataInicialNumero, ajuste: Number(ajusteNumero || 0), numeroInicial: Number(numeroInicialRenumeracao || 0), senhaAdministrativa }),
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(dados.erro || 'Erro ao ajustar o número do lançamento.');
      setNumeroEditando(null); setSenhaAdministrativa('');
      await carregar();
    } catch (e: any) { setMensagem(e.message || 'Erro ao ajustar o número do lançamento.'); }
    finally { setSalvandoNumero(false); }
  };

  return <section className="financeiro-geral-page">
    <header className="admin-page-heading financeiro-geral-heading">
      <div className="financeiro-geral-heading-texto"><h1>Financeiro Geral</h1><p>Visualize, edite e exporte os lançamentos consolidados.{dataTravaConsolidacao ? ` Alterações bloqueadas até ${dataBr(dataTravaConsolidacao)}.` : ''}</p></div>
      <div className="financeiro-geral-heading-exportacoes">
        <button className="admin-primary-button" onClick={baixarExcel}>Excel</button>
        <button className="admin-primary-button" onClick={() => gerarPdf(false)}>PDF detalhado</button>
        <button className="admin-primary-button" onClick={() => gerarPdf(true)}>PDF resumido</button>
      </div>
    </header>
    <div className="admin-card financeiro-geral-filtros">
      <div className="fg-filtros-campos">
        <label>Data inicial<input type="date" value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} /></label>
        <label>Data final<input type="date" value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} /></label>
        <label className="fg-busca">Descrição<input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Parte da descrição" onKeyDown={(e) => { if (e.key === 'Enter') aplicarFiltros(); }} /></label>
        <div className="fg-filtros-direita">
          <label>Origem<select value={origem} onChange={(e) => setOrigem(e.target.value)}><option value="">Todas</option><option>SPOT</option><option>ITAU</option><option>COMPRAS</option><option>LMC</option><option>MANUAL</option><option>PLANILHA</option><option>SISTEMA</option></select></label>
          <label>Conta<select value={contaFiltro} onChange={(e) => setContaFiltro(e.target.value)}><option value="">Todas as contas</option>{campos.filter((c) => c.key !== 'total').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
          <label className="fg-valor">Valor exato<input type="number" step="0.01" value={valorExato} onChange={(e) => setValorExato(e.target.value)} placeholder="0,00" /></label>
          <label className="fg-valor">Valor mínimo<input type="number" step="0.01" value={valorMinimo} onChange={(e) => setValorMinimo(e.target.value)} placeholder="0,00" /></label>
          <label className="fg-valor">Valor máximo<input type="number" step="0.01" value={valorMaximo} onChange={(e) => setValorMaximo(e.target.value)} placeholder="0,00" /></label>
          <div className="fg-limpar-com-trava"><button type="button" className="fg-travar-periodo-texto" onClick={travarPeriodoPelaDataInicial} title="Trava o período até um dia antes da data inicial">Travar período</button><button type="button" className="fg-acao fg-limpar-filtros" onClick={limparFiltrosBusca}>Limpar</button></div>
          <button className="admin-primary-button fg-acao fg-buscar" onClick={aplicarFiltros}>Buscar</button>
        </div>
      </div>
    </div>
    {mensagem && <div className="admin-message error">{mensagem}</div>}
    <div className="financeiro-geral-paginacao">
      <label className="form-check financeiro-geral-movimento"><input className="form-check-input" type="checkbox" checked={somenteMovimento} onChange={(e) => setSomenteMovimento(e.target.checked)} /><span className="form-check-label">Exibir apenas colunas com movimento</span></label>
      <div className="financeiro-geral-processamento">
        <button type="button" className="admin-primary-button" onClick={abrirAtualizacaoSaldos} disabled={carregando}>Atualizar saldos</button>
        <button type="button" className="admin-primary-button" onClick={abrirRecriacao} disabled={carregando}>Recriar</button>
        <button type="button" className="admin-primary-button" onClick={abrirNovoLancamento} disabled={carregando}>Novo Lançamento</button>
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
    <div ref={cabecalhoFlutuanteRef} className="financeiro-geral-cabecalho-flutuante" aria-hidden="true"><table className="financeiro-geral-tabela"><colgroup><col className="fg-col-data" /><col className="fg-col-descricao" />{podeNumeroLancamento && <col className="fg-col-numero" />}<col className="fg-col-origem" />{colunasVisiveis.map(c => <col key={c.key} className={classeLarguraCampo(c)} />)}</colgroup><thead><tr><th>Data</th><th>Descrição</th>{podeNumeroLancamento && <th>Nº Lanc</th>}<th>Origem</th>{colunasVisiveis.map(c => <th key={c.key} className={c.key === 'total' ? 'fg-total' : ''}>{c.label}</th>)}</tr></thead></table></div>
    <div ref={tabelaWrapRef} className="admin-card financeiro-geral-tabela-wrap"><table className="financeiro-geral-tabela"><colgroup><col className="fg-col-data" /><col className="fg-col-descricao" />{podeNumeroLancamento && <col className="fg-col-numero" />}<col className="fg-col-origem" />{colunasVisiveis.map(c => <col key={c.key} className={classeLarguraCampo(c)} />)}</colgroup>
      <thead><tr><th>Data</th><th>Descrição</th>{podeNumeroLancamento && <th>Nº Lanc</th>}<th>Origem</th>{colunasVisiveis.map(c => <th key={c.key} className={c.key === 'total' ? 'fg-total' : ''}>{c.label}</th>)}</tr></thead>
      <tbody>{carregando ? <tr><td colSpan={3 + colunasVisiveis.length + (podeNumeroLancamento ? 1 : 0)}>Carregando...</td></tr> : linhas.map(l => <tr key={l.id} className={`${ehSaldo(l) ? 'fg-linha-saldo' : ''} ${!ehSaldo(l) ? 'fg-linha-editavel' : ''}`.trim()} onDoubleClick={() => abrirLancamentoParaEdicao(l)}>
        <td>{dataBr(l.data_lancamento)}</td>
        <td className="fg-descricao">{l.descricao_original || l.descricao_normalizada}</td>
        {podeNumeroLancamento && <td className="fg-numero-lancamento" title="Duplo clique para ajustar" onDoubleClick={(e) => { e.stopPropagation(); abrirAjusteNumero(l); }}>{l.id}</td>}
        <td>{ehSaldo(l) ? '' : l.origem}</td>
        {colunasVisiveis.map(c => {
          const ehTotalSaldoDia = c.key === 'total' && String(l.descricao_normalizada || l.descricao_original || '').toUpperCase().startsWith('SALDO DO DIA');
          return <td key={c.key}
            className={`${Number(l[c.key] || 0) < 0 ? 'fg-negativo' : ''} ${c.key === 'total' ? 'fg-total' : ''} ${ehTotalSaldoDia ? 'fg-total-saldo-clicavel' : ''}`.trim()}
            title={ehTotalSaldoDia ? 'Clique para ver a composição do dia' : undefined}
            onClick={ehTotalSaldoDia ? (e) => { e.stopPropagation(); abrirDetalheSaldoDia(l); } : undefined}>
            {formatarCelula(l, c.key)}
          </td>;
        })}
      </tr>)}</tbody>
      <tfoot className="financeiro-geral-titulos-rodape"><tr><th></th><th></th>{podeNumeroLancamento && <th></th>}<th></th>{colunasVisiveis.map(c => <th key={c.key} className={c.key === 'total' ? 'fg-total' : ''}>{c.label}</th>)}</tr></tfoot>
    </table></div>
    {(detalheDia || carregandoDetalheDia) && <div className="fg-modal-overlay" role="dialog" aria-modal="true" aria-label="Resumo financeiro do dia">
      <div className="fg-modal fg-modal-detalhe-dia">
        <div className="fg-modal-header"><h2>Resumo do dia {detalheDia?.data ? dataBr(detalheDia.data) : ''}</h2><button type="button" onClick={() => setDetalheDia(null)} aria-label="Fechar">×</button></div>
        {carregandoDetalheDia && !detalheDia ? <div className="fg-detalhe-carregando">Carregando...</div> : detalheDia && (() => {
          const moeda = (valor: any) => Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
          const resultadoLiquidoDia = Number(detalheDia.resultadoLiquido || 0) + Number(detalheDia.ajusteEstoque || 0) + Number(detalheDia.taxasCartao || 0) + Number(detalheDia.tarifaPix || 0);
          const totalDespesasDia = (detalheDia.despesas || []).reduce((acc: number, despesa: any) => acc + Number(despesa.valor || 0), 0);
          const saldoFinalDia = Number(detalheDia.saldoDoDia ?? detalheDia.totalCalculado ?? 0);
          const classeValor = (valor: any) => Number(valor || 0) < 0 ? 'fg-negativo' : '';
          return <div className="fg-detalhe-dia-lista fg-detalhe-dia-grade">
            <div className="fg-detalhe-grade-linha fg-detalhe-grade-saldo-anterior">
              <span>Saldo total do dia anterior</span><span></span><strong className={classeValor(detalheDia.saldoAnterior)}>{moeda(detalheDia.saldoAnterior)}</strong>
            </div>
            <div className="fg-detalhe-separador" />
            <div className="fg-detalhe-grade-linha"><span>Resultado Líquido do Produto</span><strong className={classeValor(detalheDia.resultadoLiquido)}>{moeda(detalheDia.resultadoLiquido)}</strong><span></span></div>
            <div className="fg-detalhe-grade-linha"><span>Ajuste de Saldo Estoque do dia</span><strong className={classeValor(detalheDia.ajusteEstoque)}>{moeda(detalheDia.ajusteEstoque)}</strong><span></span></div>
            <div className="fg-detalhe-grade-linha"><span>Despesa Taxas Cartão</span><strong className={classeValor(detalheDia.taxasCartao)}>{moeda(detalheDia.taxasCartao)}</strong><span></span></div>
            <div className="fg-detalhe-grade-linha"><span>Tarifa Pix Recebido Maquininha</span><strong className={classeValor(detalheDia.tarifaPix)}>{moeda(detalheDia.tarifaPix)}</strong><span></span></div>
            <div className="fg-detalhe-separador" />
            <div className="fg-detalhe-grade-linha fg-detalhe-grade-total"><span>Resultado Líquido do dia</span><span></span><strong className={classeValor(resultadoLiquidoDia)}>{moeda(resultadoLiquidoDia)}</strong></div>
            <div className="fg-detalhe-subtitulo fg-detalhe-subtitulo-grade">Lista das despesas</div>
            <div className="fg-detalhe-separador" />
            {(detalheDia.despesas || []).length === 0 ? <div className="fg-detalhe-vazio fg-detalhe-vazio-grade">Nenhuma outra despesa paga encontrada.</div> : (detalheDia.despesas || []).map((despesa: any) => <div className="fg-detalhe-grade-linha fg-detalhe-despesa" key={despesa.id}><span>{despesa.descricao}</span><strong className={classeValor(despesa.valor)}>{moeda(despesa.valor)}</strong><span></span></div>)}
            <div className="fg-detalhe-separador" />
            <div className="fg-detalhe-grade-linha fg-detalhe-grade-total"><span>Total das despesas do dia</span><span></span><strong className={classeValor(totalDespesasDia)}>{moeda(totalDespesasDia)}</strong></div>
            <div className="fg-detalhe-grade-linha fg-detalhe-grade-saldo-final"><span>Saldo Final do dia</span><span></span><strong className={classeValor(saldoFinalDia)}>{moeda(saldoFinalDia)}</strong></div>
          </div>;
        })()}
      </div>
    </div>}
    {numeroEditando !== null && podeNumeroLancamento && <div className="fg-modal-overlay" role="dialog" aria-modal="true" aria-label="Ajustar número do lançamento">
      <form className="fg-modal fg-modal-recriar" onSubmit={salvarAjusteNumero}>
        <div className="fg-modal-header"><h2>Ajustar Nº do Lançamento</h2><button type="button" onClick={() => setNumeroEditando(null)} aria-label="Fechar">×</button></div>
        <div className="fg-modal-grid">
          <label>Data inicial<input type="date" required value={dataInicialNumero} onChange={(e) => setDataInicialNumero(e.target.value)} /></label>
          <label>Forma de renumerar<select value={modoRenumeracao} onChange={(e) => setModoRenumeracao(e.target.value as 'ajuste' | 'inicial')}><option value="ajuste">Somar/subtrair</option><option value="inicial">Iniciar do número X</option></select></label>
          {modoRenumeracao === 'ajuste' ?
            <label>Somar ou subtrair<input type="number" step="1" required value={ajusteNumero} onChange={(e) => setAjusteNumero(e.target.value)} /><small>Use positivo para somar e negativo para subtrair.</small></label> :
            <label>Número inicial<input type="number" min="1" step="1" required value={numeroInicialRenumeracao} onChange={(e) => setNumeroInicialRenumeracao(e.target.value)} /><small>O primeiro lançamento da data receberá este número; os seguintes continuarão em sequência.</small></label>}
          <label>Senha administrativa<input type="password" required value={senhaAdministrativa} onChange={(e) => setSenhaAdministrativa(e.target.value)} /></label>
        </div>
        <p className="fg-recriar-aviso">A partir de <strong>{dataBr(dataInicialNumero)}</strong>, {modoRenumeracao === 'ajuste' ? 'o valor será somado ou subtraído de cada Nº Lanc' : `a numeração será reiniciada em ${numeroInicialRenumeracao || 'X'}`} seguindo a ordem atual dos lançamentos. Números menores ou iguais a zero e conflitos com lançamentos anteriores serão recusados.</p>
        <div className="fg-modal-actions"><button type="button" className="fg-modal-cancelar" onClick={() => setNumeroEditando(null)} disabled={salvandoNumero}>Cancelar</button><button type="submit" className="admin-primary-button" disabled={salvandoNumero}>{salvandoNumero ? 'Salvando...' : 'Salvar ajuste'}</button></div>
      </form>
    </div>}
    {atualizarSaldosAberto && <div className="fg-modal-overlay" role="dialog" aria-modal="true" aria-label="Atualizar saldos do Financeiro Geral">
      <div className="fg-modal fg-modal-recriar fg-modal-atualizar-saldos">
        <div className="fg-modal-header"><h2>Atualizar saldos</h2><button type="button" onClick={() => setAtualizarSaldosAberto(false)} aria-label="Fechar">×</button></div>
        <div className="fg-modal-grid fg-modal-grid-recriar">
          <label>Data inicial<input type="date" value={dataInicial} min={dataTravaConsolidacao ? diaSeguinte(dataTravaConsolidacao) : undefined} onChange={(e) => setDataInicial(e.target.value)} /></label>
          <label>Data final<input type="date" value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} /></label>
        </div>
        <div className="fg-selecao-colunas-saldo">
          <div className="fg-selecao-colunas-acoes"><strong>Colunas para recalcular</strong><button type="button" onClick={() => setColunasAtualizarSaldo(campos.filter((c) => c.key !== 'total').map((c) => c.key))}>Todas</button><button type="button" onClick={() => setColunasAtualizarSaldo([])}>Limpar</button></div>
          <div className="fg-selecao-colunas-grid">{campos.filter((c) => c.key !== 'total').map((c) => <label key={c.key}><input type="checkbox" checked={colunasAtualizarSaldo.includes(c.key)} onChange={() => alternarColunaSaldo(c.key)} /><span>{c.label}</span></label>)}</div>
        </div>
        <p className="fg-recriar-aviso">O sistema usará o primeiro saldo visível do filtro atual como referência. Se ele estiver antes da data travada, o recálculo começará no primeiro dia liberado. Nenhum lançamento anterior à trava será incluído ou alterado e não serão criados saldos em dias sem lançamentos.</p>
        <div className="fg-modal-actions"><button type="button" className="fg-modal-cancelar" onClick={() => setAtualizarSaldosAberto(false)} disabled={carregando}>Cancelar</button><button type="button" className="admin-primary-button" onClick={atualizarSaldosFinanceiroGeral} disabled={carregando}>{carregando ? 'Atualizando...' : 'Atualizar saldos'}</button></div>
      </div>
    </div>}
    {recriarAberto && <div className="fg-modal-overlay" role="dialog" aria-modal="true" aria-label="Recriar Financeiro Geral">
      <div className="fg-modal fg-modal-recriar">
        <div className="fg-modal-header"><h2>Recriar Financeiro Geral</h2><button type="button" onClick={() => setRecriarAberto(false)} aria-label="Fechar">×</button></div>
        <div className="fg-modal-grid fg-modal-grid-recriar">
          <label>Coluna a recriar<select value={recriarColuna} onChange={(e) => setRecriarColuna(e.target.value)}><option value="TODAS">Todas as colunas</option>{campos.filter((c) => c.key !== 'total').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
          <label>Data inicial<input type="date" value={recriarDataInicial} min={dataTravaConsolidacao ? diaSeguinte(dataTravaConsolidacao) : undefined} onChange={(e) => setRecriarDataInicial(e.target.value)} /></label>
          <label>Data final<input type="date" value={recriarDataFinal} onChange={(e) => setRecriarDataFinal(e.target.value)} /></label>
        </div>
        <p className="fg-recriar-aviso">Ao escolher uma coluna, somente os valores dessa coluna serão zerados e reconstruídos no período. As demais colunas serão preservadas.</p>
        <div className="fg-modal-actions"><button type="button" className="fg-modal-cancelar" onClick={() => setRecriarAberto(false)} disabled={carregando}>Cancelar</button><button type="button" className="admin-primary-button" onClick={reconsolidarDoZero} disabled={carregando}>{carregando ? 'Recriando...' : 'Recriar período'}</button></div>
      </div>
    </div>}
    {novoLancamentoAberto && <div className="fg-modal-overlay" role="dialog" aria-modal="true" aria-label={lancamentoEditandoId === null ? 'Novo lançamento' : 'Alterar lançamento'}>
      <div className="fg-modal">
        <div className="fg-modal-header"><h2>{lancamentoEditandoId === null ? 'Novo Lançamento' : 'Alterar Lançamento'}</h2><button type="button" onClick={fecharModalLancamento} aria-label="Fechar">×</button></div>
        <div className="fg-modal-grid">
          <label>Data<input ref={campoDataLancamentoRef} type="date" value={novoLancamento.data_lancamento || ''} onChange={(e) => setNovoLancamento((r) => ({ ...r, data_lancamento: e.target.value }))} /></label>
          <label className="fg-modal-descricao">Descrição<input value={novoLancamento.descricao_original || ''} onChange={(e) => setNovoLancamento((r) => ({ ...r, descricao_original: e.target.value }))} /></label>
          <label>Origem<input value={novoLancamento.origem || 'MANUAL'} onChange={(e) => setNovoLancamento((r) => ({ ...r, origem: e.target.value }))} /></label>
          {campos.filter((c) => c.key !== 'total').map((c) => <label key={c.key}>{c.label}<input type="number" step={/^prod[1-4]_quant$/.test(c.key) ? '1' : (/^prod[1-4]_valor$/.test(c.key) ? '0.000001' : '0.01')} value={novoLancamento[c.key] ?? ''} onChange={(e) => setNovoLancamento((r) => ({ ...r, [c.key]: e.target.value }))} /></label>)}
        </div>
        {lancamentoEditandoId !== null && ehSaldoAnterior(novoLancamento) && <label className="fg-modal-senha-saldo">Senha administrativa<input type="password" value={senhaEdicaoSaldo} onChange={(e) => setSenhaEdicaoSaldo(e.target.value)} placeholder="Obrigatória para alterar o Saldo anterior" /></label>}
        <div className="fg-modal-actions">{lancamentoEditandoId !== null && !ehSaldo(novoLancamento) && <><button type="button" className="fg-modal-excluir" onClick={excluirLancamentoEmEdicao} disabled={incluindo || excluindoId !== null}>{excluindoId !== null ? 'Excluindo...' : 'Excluir lançamento'}</button><button type="button" className="fg-modal-incluir" onClick={prepararInclusaoNoModal} disabled={incluindo || excluindoId !== null}>Incluir</button></>}<button type="button" className="fg-modal-cancelar" onClick={fecharModalLancamento} disabled={incluindo || excluindoId !== null}>Cancelar</button><button type="button" className="admin-primary-button" onClick={salvarNovoLancamento} disabled={incluindo || excluindoId !== null}>{incluindo ? 'Salvando...' : (lancamentoEditandoId === null ? 'Salvar lançamento' : 'Salvar alterações')}</button></div>
      </div>
    </div>}
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
