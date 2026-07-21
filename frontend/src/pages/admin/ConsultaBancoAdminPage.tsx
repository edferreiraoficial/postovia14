import { useEffect, useMemo, useState } from 'react';

const API_BASE = `${import.meta.env.VITE_API_URL || ''}/api`;

const dataIso = (data: Date) => data.toISOString().slice(0, 10);
const primeiroDiaMesAtual = () => {
  const agora = new Date();
  return dataIso(new Date(agora.getFullYear(), agora.getMonth(), 1));
};
const ultimoDiaMesAtual = () => {
  const agora = new Date();
  return dataIso(new Date(agora.getFullYear(), agora.getMonth() + 1, 0));
};

const dataBR = (data: string) => {
  const [ano, mes, dia] = String(data || '').split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : data;
};

const moeda = (valor: any) => Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const valorMonetario = (valor: any) => Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const custoDecimal = (valor: any) => Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
const numero = (valor: any) => Number(valor || 0).toLocaleString('pt-BR');

const textoFixo = (valor: any, largura: number) => String(valor ?? '').slice(0, largura).padEnd(largura, ' ');
const textoNumero = (valor: any, largura: number) => String(valor ?? '').slice(0, largura).padStart(largura, ' ');
const valorExtrato = (item: any) => String(item?.natureza || '').toUpperCase() === 'SALDO' ? '' : valorMonetario(item?.valor);
const saldoExtrato = (valor: any) => Number(valor || 0) === 0 ? '' : valorMonetario(valor);
const normalizar = (valor: any) => String(valor ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const numeroFiltro = (valor: any) => {
  const bruto = String(valor ?? '').trim();
  if (!bruto) return null;
  const texto = bruto.replace(/\./g, '').replace(',', '.');
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
};
const escaparHtml = (valor: any) => String(valor ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const estilosColunas = {
  esquerda: { textAlign: 'left' as const, fontFamily: 'Consolas, "Courier New", monospace', whiteSpace: 'pre' as const },
  direita: { textAlign: 'right' as const, fontFamily: 'Consolas, "Courier New", monospace', whiteSpace: 'pre' as const },
};

const cardCompacto = { padding: 10, gap: 1 } as const;

type LinhaRelatorio = Record<string, string | number | null | undefined>;

export default function ConsultaBancoAdminPage() {
  const [abaAtiva, setAbaAtiva] = useState('compras');
  const [compras, setCompras] = useState<any[]>([]);
  const [lmc, setLmc] = useState<any[]>([]);
  const [vendasCartao, setVendasCartao] = useState<any[]>([]);
  const [extratos, setExtratos] = useState<any[]>([]);
  const [contasBancarias, setContasBancarias] = useState<any[]>([]);
  const [importandoDados, setImportandoDados] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [dataInicial, setDataInicial] = useState(primeiroDiaMesAtual());
  const [dataFinal, setDataFinal] = useState(ultimoDiaMesAtual());
  const [dadosGravados, setDadosGravados] = useState<any>(null);
  const [editando, setEditando] = useState<{ tipo: string; id: number; dados: any } | null>(null);
  const [produtosCadastrados, setProdutosCadastrados] = useState<any[]>([]);
  const [fornecedoresCadastrados, setFornecedoresCadastrados] = useState<any[]>([]);
  const [novoRegistro, setNovoRegistro] = useState<{ tipo: string; dados: any } | null>(null);
  const filtrosVazios = { busca: '', produto: '', fornecedor: '', numeroNf: '', natureza: 'TODAS', valorMinimo: '', valorMaximo: '' };
  const [filtrosEdicao, setFiltrosEdicao] = useState(filtrosVazios);
  const [filtrosAplicados, setFiltrosAplicados] = useState(filtrosVazios);
  const [mostrarFiltros, setMostrarFiltros] = useState(false);

  const periodoSelecionado = useMemo(() => {
    return `dataInicial=${encodeURIComponent(dataInicial)}&dataFinal=${encodeURIComponent(dataFinal)}`;
  }, [dataInicial, dataFinal]);

  const periodoTexto = `${dataBR(dataInicial)} até ${dataBR(dataFinal)}`;

  const contaSelecionadaId = abaAtiva.startsWith('conta:') ? Number(abaAtiva.split(':')[1]) : null;
  const contaSelecionada = contasBancarias.find((conta) => Number(conta.id) === contaSelecionadaId) || null;
  const visualizandoExtrato = contaSelecionadaId !== null;

  const tipoVisualizado = useMemo(() => {
    if (abaAtiva === 'lmc') return { tipo: 'vendas', titulo: 'Vendas LMC', contaBancariaId: null };
    if (abaAtiva === 'vendas-cartao') return { tipo: 'vendas-cartao', titulo: 'Vendas no Cartão', contaBancariaId: null };
    if (abaAtiva.startsWith('conta:')) {
      const id = Number(abaAtiva.split(':')[1]);
      const conta = contasBancarias.find((item) => Number(item.id) === id);
      return { tipo: 'extrato', titulo: conta?.nome_conta || conta?.banco || 'Conta bancária', contaBancariaId: id };
    }
    return { tipo: 'compras', titulo: 'Compras', contaBancariaId: null };
  }, [abaAtiva, contasBancarias]);

  const dadosVisiveis = useMemo(() => {
    if (abaAtiva === 'lmc') return lmc;
    if (abaAtiva === 'vendas-cartao') {
      return [...vendasCartao].sort((a, b) => {
        const dataA = String(a.data_iso || '').slice(0, 10);
        const dataB = String(b.data_iso || '').slice(0, 10);
        return dataA.localeCompare(dataB) || Number(a.id || 0) - Number(b.id || 0);
      });
    }
    if (abaAtiva.startsWith('conta:')) return extratos;
    return compras;
  }, [abaAtiva, compras, lmc, vendasCartao, extratos]);

  const dadosFiltrados = useMemo(() => {
    const busca = normalizar(filtrosAplicados.busca);
    const produto = normalizar(filtrosAplicados.produto);
    const fornecedor = normalizar(filtrosAplicados.fornecedor);
    const numeroNf = normalizar(filtrosAplicados.numeroNf);
    const minimo = numeroFiltro(filtrosAplicados.valorMinimo);
    const maximo = numeroFiltro(filtrosAplicados.valorMaximo);

    return dadosVisiveis.filter((item) => {
      const textoGeral = normalizar([
        item.descricao_original, item.produto, item.fornecedor, item.numero_nf,
        item.natureza, item.data_lancamento, item.data_movimento, item.data_emissao,
      ].join(' '));
      if (busca && !textoGeral.includes(busca)) return false;
      if (produto && !normalizar(item.produto).includes(produto)) return false;
      if (fornecedor && !normalizar(item.fornecedor).includes(fornecedor)) return false;
      if (numeroNf && !normalizar(item.numero_nf).includes(numeroNf)) return false;
      if (filtrosAplicados.natureza !== 'TODAS' && normalizar(item.natureza) !== normalizar(filtrosAplicados.natureza)) return false;

      const valorComparacao = abaAtiva === 'compras'
        ? Number(item.valor_pag || 0)
        : abaAtiva === 'lmc'
          ? Number(item.valor_vendas || 0)
          : abaAtiva === 'vendas-cartao'
            ? Number(item.vendas_bruta || 0)
            : Number(item.valor || 0);
      if (minimo !== null && valorComparacao < minimo) return false;
      if (maximo !== null && valorComparacao > maximo) return false;
      return true;
    });
  }, [dadosVisiveis, filtrosAplicados, abaAtiva]);

  const resumoFiltrado = useMemo(() => {
    if (abaAtiva === 'compras') return {
      principal: dadosFiltrados.reduce((s, i) => s + Number(i.valor_pag || 0), 0),
      secundario: dadosFiltrados.reduce((s, i) => s + Number(i.quant_rec || 0), 0),
      rotuloPrincipal: 'Valor pago', rotuloSecundario: 'Quantidade recebida', unidade: ' litros',
    };
    if (abaAtiva === 'lmc') return {
      principal: dadosFiltrados.reduce((s, i) => s + Number(i.valor_vendas || 0), 0),
      secundario: dadosFiltrados.reduce((s, i) => s + Number(i.quantidade_vendas || 0), 0),
      rotuloPrincipal: 'Valor das vendas', rotuloSecundario: 'Quantidade vendida', unidade: ' litros',
    };
    if (abaAtiva === 'vendas-cartao') return {
      principal: dadosFiltrados.reduce((s, i) => s + Number(i.vendas_bruta || 0), 0),
      secundario: dadosFiltrados.reduce((s, i) => s + Number(i.taxa || 0), 0),
      rotuloPrincipal: 'Venda bruta', rotuloSecundario: 'Taxas', unidade: '',
    };
    const entradas = dadosFiltrados.filter(i => normalizar(i.natureza) === 'ENTRADA').reduce((s, i) => s + Math.abs(Number(i.valor || 0)), 0);
    const saidas = dadosFiltrados.filter(i => normalizar(i.natureza).includes('SAIDA')).reduce((s, i) => s + Math.abs(Number(i.valor || 0)), 0);
    return { principal: entradas, secundario: saidas, rotuloPrincipal: 'Entradas', rotuloSecundario: 'Saídas', unidade: '' };
  }, [dadosFiltrados, abaAtiva]);

  const linhasRelatorio = useMemo<LinhaRelatorio[]>(() => {
    if (abaAtiva === 'compras') {
      return dadosFiltrados.map((item) => ({
        Data: item.data_emissao, Produto: item.produto, Fornecedor: item.fornecedor, NF: item.numero_nf,
        Quantidade: numero(item.quantidade), Custo: custoDecimal(item.custo), 'Valor Total': valorMonetario(item.valor_total),
        'Quant. Recebida': numero(item.quant_rec), 'Preço Pago': custoDecimal(item.preco_pag), 'Valor Pago': valorMonetario(item.valor_pag),
      }));
    }
    if (abaAtiva === 'lmc') {
      return dadosFiltrados.map((item) => ({
        Data: item.data_movimento, Produto: item.produto, Abertura: numero(item.estoque_abertura),
        'Vendas (qt)': numero(item.quantidade_vendas), 'Vendas (R$)': valorMonetario(item.valor_vendas),
        'Ajuste (qt)': numero(item.ajuste_quantidade), Fechamento: numero(item.estoque_fechamento),
      }));
    }
    if (abaAtiva === 'vendas-cartao') {
      return dadosFiltrados.map((item) => ({
        Data: item.data_lancamento, Descrição: item.descricao_original,
        'Venda Bruta': valorMonetario(item.vendas_bruta), 'Venda Líquida': valorMonetario(item.venda_liquida),
        Taxas: valorMonetario(item.taxa),
      }));
    }
    return dadosFiltrados.map((item) => ({
      Data: item.data_lancamento, Descrição: item.descricao_original, Natureza: item.natureza,
      Valor: valorExtrato(item), Saldo: saldoExtrato(item.saldo),
    }));
  }, [abaAtiva, dadosFiltrados]);

  function aplicarFiltros() {
    setFiltrosAplicados({ ...filtrosEdicao });
    setMensagem('Filtros aplicados aos lançamentos e ao relatório.');
  }

  function limparFiltros() {
    setFiltrosEdicao(filtrosVazios);
    setFiltrosAplicados(filtrosVazios);
    setMensagem('Filtros removidos.');
  }

  function ajustarDataInicial(valor: string) {
    setDataInicial(valor);
  }

  function ajustarDataFinal(valor: string) {
    setDataFinal(valor);
  }

  async function carregarDadosGravados() {
    const response = await fetch(`${API_BASE}/dados-gravados?${periodoSelecionado}`);
    const json = await response.json();
    setDadosGravados(json.resumo || null);
  }


  async function carregarCompras() {
    const response = await fetch(`${API_BASE}/compras?${periodoSelecionado}`);
    const json = await response.json();
    setCompras(json.dados || []);
  }

  async function carregarLmc() {
    const response = await fetch(`${API_BASE}/lmc?${periodoSelecionado}`);
    const json = await response.json();
    setLmc(json.dados || []);
  }

  async function carregarVendasCartao() {
    const response = await fetch(`${API_BASE}/vendas-cartao?${periodoSelecionado}`);
    const json = await response.json();
    if (!response.ok || !json.ok) throw new Error(json.erro || 'Erro ao carregar vendas no cartão.');
    setVendasCartao(json.dados || []);
  }

  async function carregarContasBancarias() {
    const response = await fetch(`${API_BASE}/contas-bancarias`);
    const json = await response.json();
    if (!response.ok || !json.ok) throw new Error(json.erro || 'Erro ao carregar contas bancárias.');
    setContasBancarias(json.dados || []);
  }

  async function carregarExtratos() {
    if (!contaSelecionadaId) {
      setExtratos([]);
      return;
    }
    const response = await fetch(`${API_BASE}/extratos-conta?${periodoSelecionado}&contaBancariaId=${contaSelecionadaId}`);
    const json = await response.json();
    if (!response.ok || !json.ok) throw new Error(json.erro || 'Erro ao carregar lançamentos da conta.');
    setExtratos(json.dados || []);
  }

  async function carregarCadastrosEdicao() {
    const response = await fetch(`${API_BASE}/cadastros-edicao`);
    const json = await response.json();
    if (response.ok && json.ok) {
      setProdutosCadastrados(json.produtos || []);
      setFornecedoresCadastrados(json.fornecedores || []);
    }
  }

  async function carregarTodosDados() {
    try {
      setImportandoDados(true);
      await Promise.all([carregarDadosGravados(), carregarCompras(), carregarLmc(), carregarVendasCartao(), carregarContasBancarias(), carregarExtratos(), carregarCadastrosEdicao()]);
    } catch (error) {
      console.error(error);
      setMensagem(error instanceof Error ? error.message : 'Erro ao carregar dados gravados no banco.');
    } finally {
      setImportandoDados(false);
    }
  }

  function iniciarEdicao(tipo: string, item: any) {
    if (typeof item.id !== 'number') return;
    setEditando({
      tipo,
      id: item.id,
      dados: {
        ...item,
        data: item.data_iso || '',
        saldo: item.saldo ?? '',
      },
    });
    setMensagem('');
  }

  function alterarCampo(campo: string, valor: any) {
    setEditando((atual) => {
      if (!atual) return atual;
      const dados = { ...atual.dados, [campo]: valor };
      if (atual.tipo === 'compras' && (campo === 'quant_rec' || campo === 'preco_pag')) {
        dados.valor_pag = (Number(dados.quant_rec || 0) * Number(dados.preco_pag || 0)).toFixed(2);
      }
      return { ...atual, dados };
    });
  }

  async function salvarEdicao() {
    if (!editando) return;
    try {
      setImportandoDados(true);
      const response = await fetch(`${API_BASE}/dados-gravados/${editando.tipo}/${editando.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editando.dados, contaBancariaId: tipoVisualizado.contaBancariaId }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.erro || 'Erro ao atualizar o registro.');
      setEditando(null);
      setMensagem(json.mensagem);
      await carregarTodosDados();
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : 'Erro ao atualizar o registro.');
    } finally {
      setImportandoDados(false);
    }
  }

  async function excluirRegistro(tipo: string, item: any) {
    if (typeof item.id !== 'number') return;
    if (!window.confirm('Confirma a exclusão definitiva deste registro?')) return;
    const senha = window.prompt('Digite a senha para confirmar a exclusão:');
    if (!senha) return;
    try {
      setImportandoDados(true);
      const response = await fetch(`${API_BASE}/dados-gravados/${tipo}/${item.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.erro || 'Erro ao excluir o registro.');
      if (editando?.id === item.id && editando?.tipo === tipo) setEditando(null);
      setMensagem(json.mensagem);
      await carregarTodosDados();
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : 'Erro ao excluir o registro.');
    } finally {
      setImportandoDados(false);
    }
  }

  const campoEdicao = (campo: string, tipo = 'text', largura = '100%') => (
    <input
      type={tipo}
      value={editando?.dados?.[campo] ?? ''}
      list={campo === 'produto' ? 'lista-produtos-edicao' : campo === 'fornecedor' ? 'lista-fornecedores-edicao' : undefined}
      step={tipo === 'number' ? 'any' : undefined}
      onChange={(e) => alterarCampo(campo, e.target.value)}
      style={{ width: largura, minWidth: tipo === 'date' ? 128 : 90, padding: '5px 6px', border: '1px solid #94a3b8', borderRadius: 6, boxSizing: 'border-box' }}
    />
  );

  const acoesLinha = (tipo: string, item: any) => {
    if (typeof item.id !== 'number') return <span style={{ color: '#64748b' }}>—</span>;
    const estaEditando = editando?.tipo === tipo && editando?.id === item.id;
    return estaEditando ? (
      <div style={{ display: 'flex', gap: 5, whiteSpace: 'nowrap' }}>
        <button type="button" className="admin-primary-button" style={{ padding: '5px 9px' }} onClick={salvarEdicao}>Salvar</button>
        <button type="button" className="admin-link-button" onClick={() => setEditando(null)}>Cancelar</button>
      </div>
    ) : (
      <div style={{ display: 'flex', gap: 8, whiteSpace: 'nowrap' }}>
        <button type="button" className="admin-link-button" onClick={() => iniciarEdicao(tipo, item)}>Editar</button>
        <button type="button" className="admin-link-button" style={{ color: '#b91c1c' }} onClick={() => excluirRegistro(tipo, item)}>Excluir</button>
      </div>
    );
  };


  function iniciarInclusao() {
    const tipo = tipoVisualizado.tipo;
    const comuns = { data: dataInicial };
    const dados = tipo === 'compras'
      ? { ...comuns, produto: '', fornecedor: '', numero_nf: '', quantidade: '', custo: '', valor_total: '', quant_rec: '', preco_pag: '', valor_pag: '' }
      : tipo === 'vendas'
        ? { ...comuns, produto: '', estoque_abertura: '', quantidade_vendas: '', valor_vendas: '', ajuste_quantidade: '0', estoque_fechamento: '' }
        : { ...comuns, descricao_original: '', natureza: 'ENTRADA', valor: '', saldo: '' };
    setEditando(null);
    setNovoRegistro({ tipo, dados });
    setMensagem('');
  }

  function alterarCampoNovo(campo: string, valor: any) {
    setNovoRegistro((atual) => {
      if (!atual) return atual;
      const dados = { ...atual.dados, [campo]: valor };
      if (atual.tipo === 'compras') {
        if (campo === 'quantidade' && !dados.quant_rec) dados.quant_rec = valor;
        if (campo === 'custo' && !dados.preco_pag) dados.preco_pag = valor;
        if (campo === 'valor_total' && !dados.valor_pag) dados.valor_pag = valor;
        if (campo === 'quant_rec' || campo === 'preco_pag') dados.valor_pag = (Number(dados.quant_rec || 0) * Number(dados.preco_pag || 0)).toFixed(2);
      }
      return { ...atual, dados };
    });
  }

  async function salvarNovoRegistro() {
    if (!novoRegistro) return;
    try {
      setImportandoDados(true);
      const response = await fetch(`${API_BASE}/dados-gravados/${novoRegistro.tipo}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...novoRegistro.dados, contaBancariaId: tipoVisualizado.contaBancariaId }),
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.erro || 'Erro ao incluir o registro.');
      setNovoRegistro(null);
      setMensagem(json.mensagem);
      await carregarTodosDados();
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : 'Erro ao incluir o registro.');
    } finally {
      setImportandoDados(false);
    }
  }

  const campoNovo = (campo: string, tipo = 'text') => (
    <input
      type={tipo}
      value={novoRegistro?.dados?.[campo] ?? ''}
      list={campo === 'produto' ? 'lista-produtos-edicao' : campo === 'fornecedor' ? 'lista-fornecedores-edicao' : undefined}
      step={tipo === 'number' ? 'any' : undefined}
      onChange={(e) => alterarCampoNovo(campo, e.target.value)}
      style={{ width: '100%', minWidth: tipo === 'date' ? 128 : 90, padding: '7px 8px', border: '1px solid #94a3b8', borderRadius: 6, boxSizing: 'border-box' }}
    />
  );

  async function excluirDadosVisualizados() {
    const quantidade = dadosVisiveis.length;
    if (quantidade === 0) {
      setMensagem('Não há dados visíveis para excluir no período escolhido.');
      return;
    }

    const confirmar = window.confirm(
      `Confirma exclusão dos dados visualizados?\n\n` +
      `Item: ${tipoVisualizado.titulo}\n` +
      `Período: ${periodoTexto}\n` +
      `Quantidade visível: ${quantidade} registros\n\n` +
      'Essa ação não pode ser desfeita.'
    );

    if (!confirmar) return;

    const senha = window.prompt('Digite a senha para confirmar a exclusão dos dados visualizados:');
    if (!senha) {
      setMensagem('Exclusão cancelada. A senha não foi informada.');
      return;
    }

    try {
      setImportandoDados(true);
      setMensagem(`Excluindo dados visualizados de ${tipoVisualizado.titulo} no período ${periodoTexto}...`);

      const response = await fetch(`${API_BASE}/periodo/limpar`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: tipoVisualizado.tipo, contaBancariaId: tipoVisualizado.contaBancariaId, dataInicial, dataFinal, senha }),
      });

      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.erro || 'Erro ao excluir dados visualizados.');
      }

      setMensagem(`${json.mensagem} Removidos: ${json.removidos || 0} registros.`);
      await carregarTodosDados();
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : 'Erro ao excluir dados visualizados.');
    } finally {
      setImportandoDados(false);
    }
  }

  function gerarHtmlRelatorio() {
    const colunas = Object.keys(linhasRelatorio[0] || {});
    const linhas = linhasRelatorio.map((linha) => `
      <tr>${colunas.map((coluna) => `<td>${escaparHtml(linha[coluna])}</td>`).join('')}</tr>
    `).join('');

    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Relatório ${escaparHtml(tipoVisualizado.titulo)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #0f172a; margin: 24px; }
    h1 { font-size: 18px; margin: 0 0 6px; }
    h2 { font-size: 14px; margin: 0 0 16px; color: #334155; font-weight: 600; }
    .meta { font-size: 12px; margin-bottom: 14px; color: #475569; display: grid; gap: 3px; }
    table { border-collapse: collapse; width: 100%; font-size: 10px; }
    th, td { border: 1px solid #cbd5e1; padding: 5px 6px; vertical-align: top; }
    th { background: #eaf4fb; color: #1f4f73; text-align: left; }
    td { white-space: pre-wrap; }
    .rodape { margin-top: 14px; font-size: 11px; color: #475569; }
    @media print { body { margin: 12mm; } button { display: none; } }
  </style>
</head>
<body>
  <h1>POSTO VIA 14</h1>
  <h2>Relatório de Dados Gravados - ${escaparHtml(tipoVisualizado.titulo)}</h2>
  <div class="meta">
    <span><strong>Período:</strong> ${escaparHtml(periodoTexto)}</span>
    <span><strong>Total de registros filtrados:</strong> ${linhasRelatorio.length}</span>
    <span><strong>${escaparHtml(resumoFiltrado.rotuloPrincipal)}:</strong> ${escaparHtml(moeda(resumoFiltrado.principal))}</span>
    <span><strong>${escaparHtml(resumoFiltrado.rotuloSecundario)}:</strong> ${escaparHtml(visualizandoExtrato ? moeda(resumoFiltrado.secundario) : numero(resumoFiltrado.secundario) + resumoFiltrado.unidade)}</span>
    <span><strong>Emitido em:</strong> ${new Date().toLocaleString('pt-BR')}</span>
  </div>
  <table>
    <thead><tr>${colunas.map((coluna) => `<th>${escaparHtml(coluna)}</th>`).join('')}</tr></thead>
    <tbody>${linhas}</tbody>
  </table>
  <div class="rodape">Relatório gerado a partir dos dados visíveis na tela Dados Gravados.</div>
</body>
</html>`;
  }

  function imprimirDadosVisiveis() {
    if (linhasRelatorio.length === 0) {
      setMensagem('Não há dados visíveis para imprimir ou exportar.');
      return;
    }

    const escolha = window.prompt(
      'Escolha o formato do relatório:\n\n' +
      '1 - Imprimir / salvar em PDF\n' +
      '2 - Gerar Excel\n\n' +
      'Digite 1 ou 2:'
    );

    if (!escolha) return;

    if (escolha.trim() === '1') {
      const janela = window.open('', '_blank', 'width=1200,height=800');
      if (!janela) {
        setMensagem('Não foi possível abrir a janela de impressão. Verifique o bloqueador de pop-ups.');
        return;
      }
      janela.document.open();
      janela.document.write(gerarHtmlRelatorio());
      janela.document.close();
      janela.focus();
      setTimeout(() => janela.print(), 400);
      return;
    }

    if (escolha.trim() === '2') {
      const htmlExcel = gerarHtmlRelatorio();
      const blob = new Blob([htmlExcel], { type: 'application/vnd.ms-excel;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const nome = `dados_gravados_${tipoVisualizado.titulo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_')}_${dataInicial}_${dataFinal}.xls`;
      link.href = url;
      link.download = nome;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setMensagem(`Arquivo Excel gerado com ${linhasRelatorio.length} registros visíveis.`);
      return;
    }

    setMensagem('Opção inválida. Digite 1 para imprimir/PDF ou 2 para Excel.');
  }

  useEffect(() => {
    // Ao trocar o período, a consulta volta ao estado inicial: somente o intervalo de datas.
    setFiltrosEdicao({ ...filtrosVazios });
    setFiltrosAplicados({ ...filtrosVazios });
    carregarTodosDados();
  }, [periodoSelecionado, contaSelecionadaId]);

  return (
    <div className="admin-tool-page admin-consulta-page">
      <datalist id="lista-produtos-edicao">{produtosCadastrados.map((item) => <option key={item.id} value={item.nome} />)}</datalist>
      <datalist id="lista-fornecedores-edicao">{fornecedoresCadastrados.map((item) => <option key={item.id} value={item.nome} />)}</datalist>
      <section className="admin-tool-card" style={{ maxWidth: '100%', overflow: 'hidden', padding: 14 }}>
        <div style={{ marginBottom: 0 }}>
          <h1 style={{ margin: 0 }}>Dados gravados no banco</h1>
          <p style={{ margin: '2px 0 0', color: '#64748B' }}>Consulta dos dados importados por período.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, margin: '3px 0 4px' }}>
          <div className="admin-upload-card" style={{ ...cardCompacto, padding: 10, gap: 1 }}>
            <strong>Compras</strong>
            <span>{numero(dadosGravados?.compras?.registros)} registros</span>
            <small>{moeda(dadosGravados?.compras?.valorTotal)} | {numero(dadosGravados?.compras?.quantidade)} litros</small>
          </div>
          <div className="admin-upload-card" style={{ ...cardCompacto, padding: 10, gap: 1 }}>
            <strong>Vendas</strong>
            <span>{numero(dadosGravados?.lmc?.registros)} registros</span>
            <small>{moeda(dadosGravados?.lmc?.valorVendas)} | {numero(dadosGravados?.lmc?.quantidadeVendas)} litros</small>
          </div>
          <div className="admin-upload-card" style={{ ...cardCompacto, padding: 10, gap: 1 }}>
            <strong>Vendas no Cartão</strong>
            <span>{numero(dadosGravados?.vendasCartao?.registros)} registros</span>
            <small>Bruta {moeda(dadosGravados?.vendasCartao?.vendaBruta)} | Taxas {moeda(dadosGravados?.vendasCartao?.taxas)}</small>
          </div>
          <div className="admin-upload-card" style={{ ...cardCompacto, padding: 10, gap: 1 }}>
            <strong>Extratos</strong>
            <span>{numero(dadosGravados?.extratos?.registros)} registros</span>
            <small>Entradas {moeda(dadosGravados?.extratos?.entradas)} | Saídas {moeda(dadosGravados?.extratos?.saidas)}</small>
          </div>
        </div>

        <div className="admin-consulta-toolbar">
          <div className="admin-consulta-filtros">
            <label className="admin-consulta-conta">
              <strong>Selecionar conta</strong>
              <select
                className="admin-tool-select"
                value={abaAtiva}
                onChange={(e) => {
                  setAbaAtiva(e.target.value);
                  setNovoRegistro(null);
                  setEditando(null);
                  setFiltrosEdicao(filtrosVazios);
                  setFiltrosAplicados(filtrosVazios);
                }}
              >
                <option value="compras">Compras</option>
                <option value="lmc">Vendas LMC</option>
                <option value="vendas-cartao">Vendas no Cartão</option>
                {contasBancarias.map((conta) => (
                  <option key={conta.id} value={`conta:${conta.id}`}>
                    {conta.nome_conta || conta.banco}
                  </option>
                ))}
              </select>
            </label>

            <div className="admin-consulta-periodo">
              <label>
                <strong>Data inicial</strong>
                <input className="admin-tool-select" type="date" value={dataInicial} onChange={(e) => ajustarDataInicial(e.target.value)} />
              </label>

              <label>
                <strong>Data final</strong>
                <input className="admin-tool-select" type="date" value={dataFinal} onChange={(e) => ajustarDataFinal(e.target.value)} />
              </label>
            </div>
          </div>

          <div className="admin-consulta-acoes">
            <button type="button" className="admin-primary-button" onClick={carregarTodosDados}>Atualizar</button>
            <button type="button" className="admin-primary-button" onClick={iniciarInclusao}>Incluir</button>
            <button type="button" className="admin-primary-button" onClick={imprimirDadosVisiveis}>Imprimir</button>
          </div>
        </div>

        <div className="admin-relatorio-bar">
          <div className="admin-relatorio-left">
            <button type="button" className="admin-filter-toggle" onClick={() => setMostrarFiltros((v) => !v)}>
              {mostrarFiltros ? 'Ocultar filtros' : 'Filtros de lançamentos'}
            </button>
            <div className="admin-filter-status">
              <strong>{dadosFiltrados.length}</strong> de {dadosVisiveis.length} registros
            </div>
          </div>
          <div className="admin-filter-summary">
            <span><small>{resumoFiltrado.rotuloPrincipal}</small><strong>{moeda(resumoFiltrado.principal)}</strong></span>
            <span><small>{resumoFiltrado.rotuloSecundario}</small><strong>{visualizandoExtrato ? moeda(resumoFiltrado.secundario) : `${numero(resumoFiltrado.secundario)}${resumoFiltrado.unidade}`}</strong></span>
          </div>
          <button
            type="button"
            className="admin-link-button admin-delete-visible"
            onClick={excluirDadosVisualizados}
          >
            Excluir Dados Visíveis
          </button>
        </div>

        {mostrarFiltros && (
          <div className="admin-advanced-filters">
            <label className="admin-filter-wide"><span>Busca geral</span><input value={filtrosEdicao.busca} onChange={(e) => setFiltrosEdicao({ ...filtrosEdicao, busca: e.target.value })} placeholder="Descrição, produto, fornecedor, NF..." /></label>
            {(abaAtiva === 'compras' || abaAtiva === 'lmc') && <label><span>Produto</span><input list="lista-produtos-edicao" value={filtrosEdicao.produto} onChange={(e) => setFiltrosEdicao({ ...filtrosEdicao, produto: e.target.value })} /></label>}
            {abaAtiva === 'compras' && <label><span>Fornecedor</span><input list="lista-fornecedores-edicao" value={filtrosEdicao.fornecedor} onChange={(e) => setFiltrosEdicao({ ...filtrosEdicao, fornecedor: e.target.value })} /></label>}
            {abaAtiva === 'compras' && <label><span>Número da NF</span><input value={filtrosEdicao.numeroNf} onChange={(e) => setFiltrosEdicao({ ...filtrosEdicao, numeroNf: e.target.value })} /></label>}
            {(visualizandoExtrato) && <label><span>Tipo</span><select value={filtrosEdicao.natureza} onChange={(e) => setFiltrosEdicao({ ...filtrosEdicao, natureza: e.target.value })}><option value="TODAS">Todos</option><option value="ENTRADA">Entradas</option><option value="SAIDA">Saídas</option><option value="SALDO">Saldos</option></select></label>}
            <label><span>Valor mínimo</span><input inputMode="decimal" value={filtrosEdicao.valorMinimo} onChange={(e) => setFiltrosEdicao({ ...filtrosEdicao, valorMinimo: e.target.value })} placeholder="0,00" /></label>
            <label><span>Valor máximo</span><input inputMode="decimal" value={filtrosEdicao.valorMaximo} onChange={(e) => setFiltrosEdicao({ ...filtrosEdicao, valorMaximo: e.target.value })} placeholder="0,00" /></label>
            <div className="admin-filter-actions"><button type="button" className="admin-link-button" onClick={limparFiltros}>Limpar Filtros</button><button type="button" className="admin-primary-button" onClick={aplicarFiltros}>Aplicar Filtros</button><button type="button" className="admin-primary-button" onClick={imprimirDadosVisiveis}>Gerar Relatório</button></div>
          </div>
        )}

        {novoRegistro && (
          <div className="admin-upload-card" style={{ padding: 12, marginBottom: 12, display: 'grid', gap: 9 }}>
            <strong style={{ color: '#1F4F73' }}>Incluir Novo Registro em {tipoVisualizado.titulo}</strong>
            {novoRegistro.tipo === 'compras' && (
              <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 2fr 130px repeat(6, 135px)', gap: 7 }}>
                {campoNovo('data', 'date')}{campoNovo('produto')}{campoNovo('fornecedor')}{campoNovo('numero_nf')}
                {campoNovo('quantidade', 'number')}{campoNovo('custo', 'number')}{campoNovo('valor_total', 'number')}
                {campoNovo('quant_rec', 'number')}{campoNovo('preco_pag', 'number')}{campoNovo('valor_pag', 'number')}
              </div>
            )}
            {novoRegistro.tipo === 'vendas' && (
              <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr repeat(5, 145px)', gap: 7 }}>
                {campoNovo('data', 'date')}{campoNovo('produto')}{campoNovo('estoque_abertura', 'number')}
                {campoNovo('quantidade_vendas', 'number')}{campoNovo('valor_vendas', 'number')}{campoNovo('ajuste_quantidade', 'number')}{campoNovo('estoque_fechamento', 'number')}
              </div>
            )}
            {novoRegistro.tipo === 'vendas-cartao' && (
              <div style={{ display: 'grid', gridTemplateColumns: '130px 2fr repeat(3, 150px)', gap: 7 }}>
                {campoNovo('data', 'date')}{campoNovo('descricao_original')}{campoNovo('vendas_bruta', 'number')}
                {campoNovo('venda_liquida', 'number')}{campoNovo('taxa', 'number')}
              </div>
            )}
            {novoRegistro.tipo === 'extrato' && (
              <div style={{ display: 'grid', gridTemplateColumns: '130px 2fr 160px 150px 150px', gap: 7 }}>
                {campoNovo('data', 'date')}{campoNovo('descricao_original')}
                <select value={novoRegistro.dados.natureza} onChange={(e) => alterarCampoNovo('natureza', e.target.value)} style={{ padding: '7px 8px', border: '1px solid #94a3b8', borderRadius: 6 }}>
                  <option value="ENTRADA">ENTRADA</option><option value="SAIDA">SAÍDA</option><option value="SALDO">SALDO</option>
                </select>
                {campoNovo('valor', 'number')}{campoNovo('saldo', 'number')}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="admin-primary-button" onClick={salvarNovoRegistro}>Salvar inclusão</button>
              <button type="button" className="admin-link-button" onClick={() => setNovoRegistro(null)}>Cancelar</button>
            </div>
          </div>
        )}

        {mensagem && <p style={{ margin: '4px 0 8px', color: mensagem.toLowerCase().includes('erro') || mensagem.toLowerCase().includes('inválida') ? '#B91C1C' : '#1F4F73' }}>{mensagem}</p>}
        {importandoDados && <p>Carregando dados...</p>}

        {abaAtiva === 'compras' && (
          <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <table className="admin-table admin-fixed-table">
              <thead>
                <tr>
                  <th style={{ ...estilosColunas.esquerda, width: '11ch' }}>Data</th>
                  <th style={{ ...estilosColunas.esquerda, width: '13ch' }}>Produto</th>
                  <th style={{ ...estilosColunas.esquerda, width: '54ch' }}>Fornecedor</th>
                  <th style={{ ...estilosColunas.esquerda, width: '11ch' }}>NF</th>
                  <th style={{ ...estilosColunas.direita, width: '13ch' }}>Quantidade</th>
                  <th style={{ ...estilosColunas.direita, width: '11ch' }}>Custo</th>
                  <th style={{ ...estilosColunas.direita }}>Valor Total</th>
                  <th style={{ ...estilosColunas.direita, width: '13ch' }}>Quant. Recebida</th>
                  <th style={{ ...estilosColunas.direita, width: '11ch' }}>Preço Pago</th>
                  <th style={{ ...estilosColunas.direita }}>Valor Pago</th>
                  <th style={{ minWidth: 132 }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {dadosFiltrados.map((item) => (
                  <tr key={item.id}>
                    {editando?.tipo === 'compras' && editando.id === item.id ? <>
                      <td>{campoEdicao('data', 'date')}</td><td>{campoEdicao('produto')}</td><td>{campoEdicao('fornecedor')}</td>
                      <td>{campoEdicao('numero_nf')}</td><td>{campoEdicao('quantidade', 'number')}</td><td>{campoEdicao('custo', 'number')}</td><td>{campoEdicao('valor_total', 'number')}</td>
                      <td>{campoEdicao('quant_rec', 'number')}</td><td>{campoEdicao('preco_pag', 'number')}</td><td>{campoEdicao('valor_pag', 'number')}</td>
                    </> : <>
                      <td style={estilosColunas.esquerda}>{textoFixo(item.data_emissao, 11)}</td><td style={estilosColunas.esquerda}>{textoFixo(item.produto, 13)}</td>
                      <td style={estilosColunas.esquerda}>{textoFixo(item.fornecedor, 54)}</td><td style={estilosColunas.esquerda}>{textoFixo(item.numero_nf, 11)}</td>
                      <td style={estilosColunas.direita}>{textoNumero(numero(item.quantidade), 13)}</td><td style={estilosColunas.direita}>{textoNumero(custoDecimal(item.custo), 11)}</td>
                      <td style={estilosColunas.direita}>{valorMonetario(item.valor_total)}</td>
                      <td style={estilosColunas.direita}>{textoNumero(numero(item.quant_rec), 13)}</td><td style={estilosColunas.direita}>{textoNumero(custoDecimal(item.preco_pag), 11)}</td>
                      <td style={estilosColunas.direita}>{valorMonetario(item.valor_pag)}</td>
                    </>}
                    <td>{acoesLinha('compras', item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {abaAtiva === 'lmc' && (
          <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <table className="admin-table admin-fixed-table">
              <thead>
                <tr>
                  <th style={{ ...estilosColunas.esquerda, width: '11ch' }}>Data</th>
                  <th style={{ ...estilosColunas.esquerda, width: '13ch' }}>Produto</th>
                  <th style={{ ...estilosColunas.direita, width: '16ch' }}>Abertura</th>
                  <th style={{ ...estilosColunas.direita, width: '13ch' }}>Vendas (qt)</th>
                  <th style={{ ...estilosColunas.direita, width: '13ch' }}>Vendas (R$)</th>
                  <th style={{ ...estilosColunas.direita, width: '13ch' }}>Ajuste (qt)</th>
                  <th style={{ ...estilosColunas.direita, width: '13ch' }}>Fechamento</th>
                  <th style={{ minWidth: 132 }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {dadosFiltrados.map((item) => (
                  <tr key={item.id}>
                    {editando?.tipo === 'vendas' && editando.id === item.id ? <>
                      <td>{campoEdicao('data', 'date')}</td><td>{campoEdicao('produto')}</td><td>{campoEdicao('estoque_abertura', 'number')}</td>
                      <td>{campoEdicao('quantidade_vendas', 'number')}</td><td>{campoEdicao('valor_vendas', 'number')}</td><td>{campoEdicao('ajuste_quantidade', 'number')}</td><td>{campoEdicao('estoque_fechamento', 'number')}</td>
                    </> : <>
                      <td style={estilosColunas.esquerda}>{textoFixo(item.data_movimento, 11)}</td><td style={estilosColunas.esquerda}>{textoFixo(item.produto, 13)}</td>
                      <td style={estilosColunas.direita}>{textoNumero(numero(item.estoque_abertura), 16)}</td><td style={estilosColunas.direita}>{textoNumero(numero(item.quantidade_vendas), 13)}</td>
                      <td style={estilosColunas.direita}>{textoNumero(valorMonetario(item.valor_vendas), 13)}</td><td style={estilosColunas.direita}>{textoNumero(numero(item.ajuste_quantidade), 13)}</td>
                      <td style={estilosColunas.direita}>{textoNumero(numero(item.estoque_fechamento), 13)}</td>
                    </>}
                    <td>{acoesLinha('vendas', item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {abaAtiva === 'vendas-cartao' && (
          <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <table className="admin-table admin-fixed-table">
              <thead><tr>
                <th style={{ ...estilosColunas.esquerda, width: '11ch' }}>Data</th>
                <th style={{ ...estilosColunas.esquerda, width: '42ch' }}>Descrição</th>
                <th style={{ ...estilosColunas.direita, width: '15ch' }}>Venda Bruta</th>
                <th style={{ ...estilosColunas.direita, width: '15ch' }}>Venda Líquida</th>
                <th style={{ ...estilosColunas.direita, width: '14ch' }}>Taxas</th>
                <th style={{ minWidth: 132 }}>Ações</th>
              </tr></thead>
              <tbody>{dadosFiltrados.map((item) => (
                <tr key={item.id}>
                  {editando?.tipo === 'vendas-cartao' && editando.id === item.id ? <>
                    <td>{campoEdicao('data', 'date')}</td><td>{campoEdicao('descricao_original')}</td>
                    <td>{campoEdicao('vendas_bruta', 'number')}</td><td>{campoEdicao('venda_liquida', 'number')}</td><td>{campoEdicao('taxa', 'number')}</td>
                  </> : <>
                    <td style={estilosColunas.esquerda}>{textoFixo(item.data_lancamento, 11)}</td>
                    <td style={estilosColunas.esquerda}>{textoFixo(item.descricao_original, 42)}</td>
                    <td style={estilosColunas.direita}>{textoNumero(valorMonetario(item.vendas_bruta), 15)}</td>
                    <td style={estilosColunas.direita}>{textoNumero(valorMonetario(item.venda_liquida), 15)}</td>
                    <td style={estilosColunas.direita}>{textoNumero(valorMonetario(item.taxa), 14)}</td>
                  </>}
                  <td>{acoesLinha('vendas-cartao', item)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}

        {visualizandoExtrato && (
          <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <table className="admin-table admin-fixed-table">
              <thead>
                <tr>
                  <th style={{ ...estilosColunas.esquerda, width: '11ch' }}>Data</th>
                  <th style={{ ...estilosColunas.esquerda, width: '61ch' }}>Descrição</th>
                  <th style={{ ...estilosColunas.direita, width: '15ch' }}>Natureza</th>
                  <th style={{ ...estilosColunas.direita, width: '14ch' }}>Valor</th>
                  <th style={{ ...estilosColunas.direita, width: '14ch' }}>Saldo</th>
                  <th style={{ minWidth: 132 }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {dadosFiltrados.map((item) => (
                  <tr key={item.id}>
                    {editando?.tipo === 'extrato' && editando.id === item.id ? <>
                      <td>{campoEdicao('data', 'date')}</td><td>{campoEdicao('descricao_original')}</td><td>{campoEdicao('natureza')}</td>
                      <td>{campoEdicao('valor', 'number')}</td><td>{campoEdicao('saldo', 'number')}</td>
                    </> : <>
                      <td style={estilosColunas.esquerda}>{textoFixo(item.data_lancamento, 11)}</td><td style={estilosColunas.esquerda}>{textoFixo(item.descricao_original, 61)}</td>
                      <td style={estilosColunas.direita}>{textoNumero(item.natureza, 13) + '  '}</td><td style={estilosColunas.direita}>{textoNumero(valorExtrato(item), 14)}</td>
                      <td style={estilosColunas.direita}>{textoNumero(saldoExtrato(item.saldo), 14)}</td>
                    </>}
                    <td>{acoesLinha('extrato', item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
