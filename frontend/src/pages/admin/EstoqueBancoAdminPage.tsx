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
const dataBR = (dataIsoTexto: string) => {
  if (!dataIsoTexto) return '';
  const [ano, mes, dia] = dataIsoTexto.split('-');
  return `${dia}/${mes}/${ano}`;
};

const moeda = (valor: any) => Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const valorMonetario = (valor: any) => Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const custoDecimal = (valor: any) => Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
const numero = (valor: any) => Number(valor || 0).toLocaleString('pt-BR');

const textoFixo = (valor: any, largura: number) => String(valor ?? '').slice(0, largura).padEnd(largura, ' ');
const textoNumero = (valor: any, largura: number) => String(valor ?? '').slice(0, largura).padStart(largura, ' ');
const valorExtrato = (item: any) => String(item?.natureza || '').toUpperCase() === 'SALDO' ? '' : valorMonetario(item?.valor);
const saldoExtrato = (valor: any) => Number(valor || 0) === 0 ? '' : valorMonetario(valor);

const estilosColunas = {
  esquerda: { textAlign: 'left' as const, fontFamily: 'Consolas, "Courier New", monospace', whiteSpace: 'pre' as const },
  direita: { textAlign: 'right' as const, fontFamily: 'Consolas, "Courier New", monospace', whiteSpace: 'pre' as const },
};

export default function EstoqueBancoAdminPage() {
  const [arquivoLmc, setArquivoLmc] = useState<File | null>(null);
  const [arquivoCompras, setArquivoCompras] = useState<File | null>(null);
  const [arquivoSpot, setArquivoSpot] = useState<File | null>(null);
  const [arquivoItau, setArquivoItau] = useState<File | null>(null);
  const [importando, setImportando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [abaAtiva, setAbaAtiva] = useState('compras');
  const [compras, setCompras] = useState<any[]>([]);
  const [lmc, setLmc] = useState<any[]>([]);
  const [importandoDados, setImportandoDados] = useState(false);
  const [spot, setSpot] = useState<any[]>([]);
  const [itau, setItau] = useState<any[]>([]);
  const [dataInicial, setDataInicial] = useState(primeiroDiaMesAtual());
  const [dataFinal, setDataFinal] = useState(ultimoDiaMesAtual());
  const [dadosGravados, setDadosGravados] = useState<any>(null);

  const periodoSelecionado = useMemo(() => {
    return `dataInicial=${encodeURIComponent(dataInicial)}&dataFinal=${encodeURIComponent(dataFinal)}`;
  }, [dataInicial, dataFinal]);

  function ajustarDataInicial(valor: string) {
    setDataInicial(valor);
    if (valor > dataFinal) {
      setDataFinal(valor);
    }
  }

  function ajustarDataFinal(valor: string) {
    setDataFinal(valor);
    if (valor < dataInicial) {
      setDataInicial(valor);
    }
  }

  async function importarPdfs(e: React.FormEvent) {
    e.preventDefault();
    setMensagem('');

    if (!arquivoLmc && !arquivoCompras && !arquivoSpot && !arquivoItau) {
      return setMensagem('Selecione pelo menos um PDF para importar.');
    }

    try {
      setImportando(true);
      const formData = new FormData();
      if (arquivoLmc) formData.append('lmc', arquivoLmc);
      if (arquivoCompras) formData.append('compras', arquivoCompras);
      if (arquivoSpot) formData.append('spot', arquivoSpot);
      if (arquivoItau) formData.append('itau', arquivoItau);

      const response = await fetch(`${API_BASE}/importar-pdfs`, { method: 'POST', body: formData });
      const json = await response.json().catch(() => null);

      if (!response.ok || !json?.ok) {
        throw new Error(json?.erro || json?.message || 'Erro ao importar dados.');
      }

      setMensagem(
        `${json.mensagem} ` +
        `Recebidos: Vendas ${json.recebidos?.lmc || 0}, ` +
        `Compras ${json.recebidos?.compras || 0}, ` +
        `SPOT ${json.recebidos?.spot || 0}, ` +
        `ITAÚ ${json.recebidos?.itau || 0}. ` +
        `Importados: Vendas ${json.resultado?.lmc || 0}, ` +
        `Compras ${json.resultado?.compras || 0}, ` +
        `SPOT ${json.resultado?.spot || 0}, ` +
        `ITAÚ ${json.resultado?.itau || 0}.`
      );

      carregarTodosDados();
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : 'Erro ao importar dados.');
    } finally {
      setImportando(false);
    }
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

  async function carregarSpot() {
    const response = await fetch(`${API_BASE}/spot?${periodoSelecionado}`);
    const json = await response.json();
    setSpot(json.dados || []);
  }

  async function carregarItau() {
    const response = await fetch(`${API_BASE}/itau?${periodoSelecionado}`);
    const json = await response.json();
    setItau(json.dados || []);
  }

  async function carregarTodosDados() {
    try {
      setImportandoDados(true);
      await Promise.all([
        carregarDadosGravados(),
        carregarCompras(),
        carregarLmc(),
        carregarSpot(),
        carregarItau(),
      ]);
    } catch (error) {
      console.error(error);
      setMensagem(error instanceof Error ? error.message : 'Erro ao carregar dados gravados no banco.');
    } finally {
      setImportandoDados(false);
    }
  }

  async function limparPeriodo(tipo: 'vendas' | 'compras' | 'spot' | 'itau', descricao: string) {
    const periodoTexto = `${dataBR(dataInicial)} até ${dataBR(dataFinal)}`;
    const confirmar = window.confirm(
      `Tem certeza que deseja limpar ${descricao} do período ${periodoTexto}? Essa ação não pode ser desfeita.`
    );

    if (!confirmar) return;

    const senha = window.prompt('Digite a senha para confirmar a exclusão dos dados do período selecionado:');
    if (!senha) {
      setMensagem('Exclusão cancelada. A senha não foi informada.');
      return;
    }

    try {
      setImportandoDados(true);
      setMensagem(`Limpando ${descricao} do período ${periodoTexto}...`);

      const response = await fetch(`${API_BASE}/periodo/limpar`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, dataInicial, dataFinal, senha }),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.erro || 'Erro ao limpar período.');
      }

      setMensagem(`${json.mensagem} Removidos: ${json.removidos || 0} registros.`);
      carregarTodosDados();
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : 'Erro ao limpar período.');
    } finally {
      setImportandoDados(false);
    }
  }

  useEffect(() => {
    carregarTodosDados();
  }, [periodoSelecionado]);

  return (
    <div className="admin-tool-page">
      <section className="admin-tool-hero">
        <h1>Importar PDFs para o Banco de Dados</h1>
        <p>Importação de arquivos PDF (Vendas, Compras e Extratos).</p>
      </section>

      <section className="admin-tool-card">
        <div className="admin-tool-section-title">
          <h2>Período por data</h2>
          <span>Filtrar dados gravados no banco por data inicial e data final.</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'end' }}>
          <label>
            <strong>Data inicial</strong>
            <input className="admin-tool-select" type="date" value={dataInicial} onChange={(e) => ajustarDataInicial(e.target.value)} />
          </label>

          <label>
            <strong>Data final</strong>
            <input className="admin-tool-select" type="date" value={dataFinal} onChange={(e) => ajustarDataFinal(e.target.value)} />
          </label>
        </div>
      </section>

      <form onSubmit={importarPdfs} className="admin-tool-card admin-tool-form">
        <div className="admin-tool-grid">
          <div className="admin-upload-card">
            <strong>PDF Vendas</strong>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <span>Livro de Movimentação de Combustíveis</span>
              <button type="button" className="admin-link-button" onClick={() => limparPeriodo('vendas', 'vendas')}>limpar vendas do período</button>
            </div>
            <input type="file" accept="application/pdf" onChange={(e) => setArquivoLmc(e.target.files?.[0] || null)} />
            {arquivoLmc && <small>{arquivoLmc.name}</small>}
          </div>
          <div className="admin-upload-card">
            <strong>PDF Compras</strong>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <span>Notas e compras de combustível</span>
              <button type="button" className="admin-link-button" onClick={() => limparPeriodo('compras', 'compras')}>limpar compras do período</button>
            </div>
            <input type="file" accept="application/pdf" onChange={(e) => setArquivoCompras(e.target.files?.[0] || null)} />
            {arquivoCompras && <small>{arquivoCompras.name}</small>}
          </div>
          <div className="admin-upload-card">
            <strong>PDF Extrato SPOT</strong>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <span>Movimentação bancária SPOT</span>
              <button type="button" className="admin-link-button" onClick={() => limparPeriodo('spot', 'extrato SPOT')}>limpar extrato do período</button>
            </div>
            <input type="file" accept="application/pdf" onChange={(e) => setArquivoSpot(e.target.files?.[0] || null)} />
            {arquivoSpot && <small>{arquivoSpot.name}</small>}
          </div>
          <div className="admin-upload-card">
            <strong>PDF Extrato Itaú</strong>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <span>Movimentação bancária Itaú</span>
              <button type="button" className="admin-link-button" onClick={() => limparPeriodo('itau', 'extrato Itaú')}>limpar extrato do período</button>
            </div>
            <input type="file" accept="application/pdf" onChange={(e) => setArquivoItau(e.target.files?.[0] || null)} />
            {arquivoItau && <small>{arquivoItau.name}</small>}
          </div>
        </div>

        <button className="admin-primary-button" type="submit" disabled={importando}>
          {importando ? 'Importando Dados dos PDFs...' : 'Importar dados dos PDFs'}
        </button>
      </form>

      {mensagem && <p className="admin-tool-message">{mensagem}</p>}

      <section className="admin-tool-card" style={{ marginTop: 24, maxWidth: '100%', overflow: 'hidden' }}>
        <h2>Dados gravados no banco</h2>
        <p style={{ marginTop: -6 }}>Período selecionado: <strong>{dataBR(dataInicial)}</strong> até <strong>{dataBR(dataFinal)}</strong></p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, margin: '16px 0' }}>
          <div className="admin-upload-card">
            <strong>Compras</strong>
            <span>{numero(dadosGravados?.compras?.registros)} registros</span>
            <small>{moeda(dadosGravados?.compras?.valorTotal)} | {numero(dadosGravados?.compras?.quantidade)} litros</small>
          </div>
          <div className="admin-upload-card">
            <strong>Vendas</strong>
            <span>{numero(dadosGravados?.lmc?.registros)} registros</span>
            <small>{moeda(dadosGravados?.lmc?.valorVendas)} | {numero(dadosGravados?.lmc?.quantidadeVendas)} litros</small>
          </div>
          <div className="admin-upload-card">
            <strong>Extratos</strong>
            <span>{numero(dadosGravados?.extratos?.registros)} registros</span>
            <small>Entradas {moeda(dadosGravados?.extratos?.entradas)} | Saídas {moeda(dadosGravados?.extratos?.saidas)}</small>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button type="button" className="admin-primary-button" onClick={() => setAbaAtiva('compras')}>Compras</button>
          <button type="button" className="admin-primary-button" onClick={() => setAbaAtiva('lmc')}>Vendas</button>
          <button type="button" className="admin-primary-button" onClick={() => setAbaAtiva('spot')}>Spot</button>
          <button type="button" className="admin-primary-button" onClick={() => setAbaAtiva('itau')}>Itaú</button>
          <button type="button" className="admin-primary-button" onClick={carregarTodosDados}>Atualizar</button>
        </div>

        {importandoDados && <p>Carregando dados...</p>}

        {abaAtiva === 'compras' && (
          <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <h3>Compras</h3>
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
                </tr>
              </thead>
              <tbody>
                {compras.map((item) => (
                  <tr key={item.id}>
                    <td style={estilosColunas.esquerda}>{textoFixo(item.data_emissao, 11)}</td>
                    <td style={estilosColunas.esquerda}>{textoFixo(item.produto, 13)}</td>
                    <td style={estilosColunas.esquerda}>{textoFixo(item.fornecedor, 54)}</td>
                    <td style={estilosColunas.esquerda}>{textoFixo(item.numero_nf, 11)}</td>
                    <td style={estilosColunas.direita}>{textoNumero(numero(item.quantidade), 13)}</td>
                    <td style={estilosColunas.direita}>{textoNumero(custoDecimal(item.custo), 11)}</td>
                    <td style={estilosColunas.direita}>{valorMonetario(item.valor_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {abaAtiva === 'lmc' && (
          <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <h3>Vendas</h3>
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
                </tr>
              </thead>
              <tbody>
                {lmc.map((item) => (
                  <tr key={item.id}>
                    <td style={estilosColunas.esquerda}>{textoFixo(item.data_movimento, 11)}</td>
                    <td style={estilosColunas.esquerda}>{textoFixo(item.produto, 13)}</td>
                    <td style={estilosColunas.direita}>{textoNumero(numero(item.estoque_abertura), 16)}</td>
                    <td style={estilosColunas.direita}>{textoNumero(numero(item.quantidade_vendas), 13)}</td>
                    <td style={estilosColunas.direita}>{textoNumero(valorMonetario(item.valor_vendas), 13)}</td>
                    <td style={estilosColunas.direita}>{textoNumero(numero(item.ajuste_quantidade), 13)}</td>
                    <td style={estilosColunas.direita}>{textoNumero(numero(item.estoque_fechamento), 13)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {abaAtiva === 'spot' && (
          <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <h3>SPOT</h3>
            <table className="admin-table admin-fixed-table">
              <thead>
                <tr>
                  <th style={{ ...estilosColunas.esquerda, width: '11ch' }}>Data</th>
                  <th style={{ ...estilosColunas.esquerda, width: '61ch' }}>Descrição</th>
                  <th style={{ ...estilosColunas.direita, width: '15ch' }}>Natureza</th>
                  <th style={{ ...estilosColunas.direita, width: '14ch' }}>Valor</th>
                  <th style={{ ...estilosColunas.direita, width: '14ch' }}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {spot.map((item) => (
                  <tr key={item.id}>
                    <td style={estilosColunas.esquerda}>{textoFixo(item.data_lancamento, 11)}</td>
                    <td style={estilosColunas.esquerda}>{textoFixo(item.descricao_original, 61)}</td>
                    <td style={estilosColunas.direita}>{textoNumero(item.natureza, 13) + '  '}</td>
                    <td style={estilosColunas.direita}>{textoNumero(valorExtrato(item), 14)}</td>
                    <td style={estilosColunas.direita}>{textoNumero(saldoExtrato(item.saldo), 14)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {abaAtiva === 'itau' && (
          <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <h3>Itaú</h3>
            <table className="admin-table admin-fixed-table">
              <thead>
                <tr>
                  <th style={{ ...estilosColunas.esquerda, width: '11ch' }}>Data</th>
                  <th style={{ ...estilosColunas.esquerda, width: '61ch' }}>Descrição</th>
                  <th style={{ ...estilosColunas.direita, width: '15ch' }}>Natureza</th>
                  <th style={{ ...estilosColunas.direita, width: '14ch' }}>Valor</th>
                  <th style={{ ...estilosColunas.direita, width: '14ch' }}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {itau.map((item) => (
                  <tr key={item.id}>
                    <td style={estilosColunas.esquerda}>{textoFixo(item.data_lancamento, 11)}</td>
                    <td style={estilosColunas.esquerda}>{textoFixo(item.descricao_original, 61)}</td>
                    <td style={estilosColunas.direita}>{textoNumero(item.natureza, 13) + '  '}</td>
                    <td style={estilosColunas.direita}>{textoNumero(valorExtrato(item), 14)}</td>
                    <td style={estilosColunas.direita}>{textoNumero(saldoExtrato(item.saldo), 14)}</td>
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
