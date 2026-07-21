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

const cardCompacto = { padding: 8, gap: 3 } as const;
const linhaCompacta = { display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center', lineHeight: 1 } as const;

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

  async function limparPeriodo(tipo: 'vendas' | 'compras', descricao: string) {
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
      <section className="admin-tool-hero" style={{ width: '100%', padding: '12px 14px', marginBottom: 6 }}>
        <h1 style={{ marginBottom: 4 }}>Importar PDFs para o Banco de Dados</h1>
        <p style={{ margin: 0 }}>Importação de arquivos PDF (Vendas, Compras e Extratos).</p>
      </section>

      <form onSubmit={importarPdfs} className="admin-tool-form" style={{ width: '100%', gap: 6 }}>
        <section className="admin-tool-card admin-upload-card" style={{ ...cardCompacto, width: '100%', padding: '8px 12px' }}>
          <strong style={{ color: '#1F4F73', fontSize: '1.08rem' }}>PDF Extrato Itaú</strong>
          <div style={linhaCompacta}>
            <span style={{ color: '#64748B' }}>Movimentação bancária Itaú</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 6, alignItems: 'center' }}>
            <div style={{ display: 'grid', gap: 2 }}>
              <input type="file" accept="application/pdf" onChange={(e) => setArquivoItau(e.target.files?.[0] || null)} />
              {arquivoItau && <small style={{ color: '#64748B' }}>{arquivoItau.name}</small>}
            </div>
            <button className="admin-primary-button" type="submit" disabled={importando}>
              {importando ? 'Importando...' : 'Importar Dados'}
            </button>
          </div>
        </section>

        <section className="admin-tool-card admin-upload-card" style={{ ...cardCompacto, width: '100%', padding: '8px 12px' }}>
          <strong style={{ color: '#1F4F73', fontSize: '1.08rem' }}>PDF Extrato SPOT</strong>
          <div style={linhaCompacta}>
            <span style={{ color: '#64748B' }}>Movimentação bancária SPOT</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 6, alignItems: 'center' }}>
            <div style={{ display: 'grid', gap: 2 }}>
              <input type="file" accept="application/pdf" onChange={(e) => setArquivoSpot(e.target.files?.[0] || null)} />
              {arquivoSpot && <small style={{ color: '#64748B' }}>{arquivoSpot.name}</small>}
            </div>
            <button className="admin-primary-button" type="submit" disabled={importando}>
              {importando ? 'Importando...' : 'Importar Dados'}
            </button>
          </div>
        </section>

        <section className="admin-tool-card admin-upload-card" style={{ ...cardCompacto, width: '100%', padding: '8px 12px' }}>
          <strong style={{ color: '#1F4F73', fontSize: '1.08rem' }}>PDF Compras</strong>
          <div style={linhaCompacta}>
            <span style={{ color: '#64748B' }}>Notas e compras de combustível</span>
            <button type="button" className="admin-link-button" onClick={() => limparPeriodo('compras', 'compras')}>limpar compras do período</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 6, alignItems: 'center' }}>
            <div style={{ display: 'grid', gap: 2 }}>
              <input type="file" accept="application/pdf" onChange={(e) => setArquivoCompras(e.target.files?.[0] || null)} />
              {arquivoCompras && <small style={{ color: '#64748B' }}>{arquivoCompras.name}</small>}
            </div>
            <button className="admin-primary-button" type="submit" disabled={importando}>
              {importando ? 'Importando...' : 'Importar Dados'}
            </button>
          </div>
        </section>

        <section className="admin-tool-card admin-upload-card" style={{ ...cardCompacto, width: '100%', padding: '8px 12px' }}>
          <strong style={{ color: '#1F4F73', fontSize: '1.08rem' }}>PDF Vendas</strong>
          <div style={linhaCompacta}>
            <span style={{ color: '#64748B' }}>Livro de Movimentação de Combustíveis</span>
            <button type="button" className="admin-link-button" onClick={() => limparPeriodo('vendas', 'vendas')}>limpar vendas do período</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 6, alignItems: 'center' }}>
            <div style={{ display: 'grid', gap: 2 }}>
              <input type="file" accept="application/pdf" onChange={(e) => setArquivoLmc(e.target.files?.[0] || null)} />
              {arquivoLmc && <small style={{ color: '#64748B' }}>{arquivoLmc.name}</small>}
            </div>
            <button className="admin-primary-button" type="submit" disabled={importando}>
              {importando ? 'Importando...' : 'Importar Dados'}
            </button>
          </div>
        </section>
      </form>

      {mensagem && <p className="admin-tool-message">{mensagem}</p>}
    </div>
  );
}
