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
  const [ImportandoDados, setImportandoDados] = useState(false);
  const [spot, setSpot] = useState<any[]>([]);
  const [itau, setItau] = useState<any[]>([]);
  const [competencia, setCompetencia] = useState('Mar26');

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
      const response = await fetch(`${API_BASE}/gerar-estoque-banco`, { method: 'POST', body: formData });
      if (!response.ok) {
        const erro = await response.json().catch(() => null);
        throw new Error(erro?.message || 'Erro ao importar dados.');
      }

      const json = await response.json();
      setMensagem(json.mensagem || 'PDFs importados para o banco de dados com sucesso.');
      carregarCompras();
      carregarLmc();
      carregarSpot();
      carregarItau();

    } catch (error) {
      setMensagem(error instanceof Error ? error.message : 'Erro ao importar dados.');
    } finally {
      setImportando(false);
    }
  }

  async function carregarCompras() {
    try {
      setImportandoDados(true);

      const response = await fetch(`${API_BASE}/compras?competencia=${competencia}`);
      const json = await response.json();

      setCompras(json.dados || []);
    } catch (error) {
      console.error(error);
    } finally {
      setImportandoDados(false);
    }
  }

  async function carregarLmc() {
    try {
      setImportandoDados(true);

      const response = await fetch(`${API_BASE}/lmc?competencia=${competencia}`);
      const json = await response.json();

      setLmc(json.dados || []);
    } catch (error) {
      console.error(error);
    } finally {
      setImportandoDados(false);
    }
  }

  async function carregarSpot() {
    try {
      setImportandoDados(true); 
      const response = await fetch(`${API_BASE}/spot?competencia=${competencia}`);
      const json = await response.json();
      setSpot(json.dados || []);
    } catch (error) {
      console.error(error); 
    } finally {
      setImportandoDados(false);
    }
  }

  async function carregarItau() {
    try {
      setImportandoDados(true);
      const response = await fetch(`${API_BASE}/itau?competencia=${competencia}`);
      const json = await response.json();
      setItau(json.dados || []);
    } catch (error) {
      console.error(error);
    } finally {
      setImportandoDados(false);
    }
  }

  async function limparCompetencia() {
    const confirmar = window.confirm(
      `Tem certeza que deseja limpar todos os dados da competência ${competencia}? Essa ação não pode ser desfeita.`
    );

    if (!confirmar) return;

    try {
      setImportandoDados(true);
      setMensagem(`Limpando competência ${competencia}...`);

      const response = await fetch(`${API_BASE}/competencia/limpar`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ competencia }),
      });

      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.erro || 'Erro ao limpar competência.');
      }

      setMensagem(
        `${json.mensagem} Removidos: compras ${json.removidos.compras}, LMC ${json.removidos.lmc}, extratos ${json.removidos.extratos}.`
      );

      carregarCompras();
      carregarLmc();
      carregarSpot();
      carregarItau(); 
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : 'Erro ao limpar competência.');
    } finally {
      setImportandoDados(false);
    }
  }

  useEffect(() => {
    carregarCompras();
    carregarLmc();
    carregarSpot();    
    carregarItau();    
  }, [competencia]);  

  return (
    <div className="admin-tool-page">
      <section className="admin-tool-hero">
        <h1>Importar PDFs para o Banco de Dados</h1>
        <p>Importação de arquivos PDF (LMC, Compras e Extratos).</p>
      </section>

      <section className="admin-tool-card">
        <div className="admin-tool-section-title">
          <h2>Competência</h2>
          <span>Filtrar dados gravados no banco por mês.</span>
        </div>

        <div
          style={{
            display: 'grid',
             gridTemplateColumns: '1fr auto',
            gap: 12,
            alignItems: 'end',
          }}
        >
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

          <button
            type="button"
            className="admin-primary-button"
            onClick={limparCompetencia}
            style={{whiteSpace: 'nowrap'}}
          >
            Limpar competência
          </button>
        </div>
      </section>


      <form onSubmit={importarPdfs} className="admin-tool-card admin-tool-form">
        <div className="admin-tool-grid">
          <label className="admin-upload-card">
            <strong>PDF LMC</strong>
            <span>Livro de Movimentação de Combustíveis</span>
            <input type="file" accept="application/pdf" onChange={(e) => setArquivoLmc(e.target.files?.[0] || null)} />
            {arquivoLmc && <small>{arquivoLmc.name}</small>}
          </label>
          <label className="admin-upload-card">
            <strong>PDF Compras</strong>
            <span>Notas e compras de combustível</span>
            <input type="file" accept="application/pdf" onChange={(e) => setArquivoCompras(e.target.files?.[0] || null)} />
            {arquivoCompras && <small>{arquivoCompras.name}</small>}
          </label>
          <label className="admin-upload-card">
            <strong>PDF Extrato SPOT</strong>
            <span>Movimentação bancária SPOT</span>
            <input type="file" accept="application/pdf" onChange={(e) => setArquivoSpot(e.target.files?.[0] || null)} />
            {arquivoSpot && <small>{arquivoSpot.name}</small>}
          </label>
          <label className="admin-upload-card">
            <strong>PDF Extrato Itaú</strong>
            <span>Movimentação bancária Itaú</span>
            <input type="file" accept="application/pdf" onChange={(e) => setArquivoItau(e.target.files?.[0] || null)} />
            {arquivoItau && <small>{arquivoItau.name}</small>}
          </label>
        </div>

        <button className="admin-primary-button" type="submit" disabled={importando}>{importando ? 'Importando Dados dos PDFs...' : 'Importar dados dos PDFs'}</button>
      </form>
            {mensagem && <p className="admin-tool-message">{mensagem}</p>}

      <section className="admin-tool-card" style={{ marginTop: 24 }}>
        <h2>Dados gravados no banco</h2>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button type="button" className="admin-primary-button" onClick={() => setAbaAtiva('compras')}>
            Compras
          </button>

          <button type="button" className="admin-primary-button" onClick={() => setAbaAtiva('lmc')}>
            LMC
          </button>

          <button type="button" className="admin-primary-button" onClick={() => setAbaAtiva('spot')}>
            Spot
          </button>

          <button type="button" className="admin-primary-button" onClick={() => setAbaAtiva('itau')}>
            Itaú
          </button>

          <button type="button" className="admin-primary-button" onClick={() => {
            carregarCompras();
            carregarLmc();
            carregarSpot();
            carregarItau();
          }}>
            Atualizar
          </button>
        </div>

        {ImportandoDados && <p>Importando dados...</p>}

        {abaAtiva === 'compras' && (
          <div style={{ overflowX: 'auto' }}>
            <h3>Compras</h3>

            <table className="admin-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Produto</th>
                  <th>Fornecedor</th>
                  <th>NF</th>
                  <th>Custo</th>
                  <th>Quantidade</th>
                  <th>Valor Total</th>
                </tr>
              </thead>
              <tbody>
                {compras.map((item) => (
                  <tr key={item.id}>
                    <td>{item.data_emissao}</td>
                    <td>{item.produto}</td>
                    <td>{item.fornecedor}</td>
                    <td>{item.numero_nf}</td>
                    <td>{Number(item.custo || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>{Number(item.quantidade || 0).toLocaleString('pt-BR')}</td>
                    <td>{Number(item.valor_total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {abaAtiva === 'lmc' && (
          <div style={{ overflowX: 'auto' }}>
            <h3>LMC</h3>

            <table className="admin-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Produto</th>
                  <th>Abertura</th>
                  <th>Vendas</th>
                  <th>Valor Vendas</th>
                  <th>Ajuste</th>
                  <th>Fechamento</th>
                </tr>
              </thead>
              <tbody>
                {lmc.map((item) => (
                  <tr key={item.id}>
                    <td>{item.data_movimento}</td>
                    <td>{item.produto}</td>
                    <td>{Number(item.estoque_abertura || 0).toLocaleString('pt-BR')}</td>
                    <td>{Number(item.quantidade_vendas || 0).toLocaleString('pt-BR')}</td>
                    <td>{Number(item.valor_vendas || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>{Number(item.ajuste_quantidade || 0).toLocaleString('pt-BR')}</td>
                    <td>{Number(item.estoque_fechamento || 0).toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {abaAtiva === 'spot' && (
          <div style={{ overflowX: 'auto' }}>
           <h3>SPOT</h3>

            <table className="admin-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Valor</th>
                  <th>Saldo</th>
                  <th>Natureza</th>
                </tr>
              </thead>
              <tbody>
                {spot.map((item) => (
                  <tr key={item.id}>
                    <td>{item.data_lancamento}</td>
                    <td>{item.descricao_original}</td>
                    <td>{Number(item.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>{Number(item.saldo || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>{item.natureza}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
         )}

        {abaAtiva === 'itau' && (
          <div style={{ overflowX: 'auto' }}>
            <h3>Itaú</h3>

            <table className="admin-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Valor</th>
                  <th>Saldo</th>
                  <th>Natureza</th>
                </tr>
              </thead>
              <tbody>
                {itau.map((item) => (
                  <tr key={item.id}>
                    <td>{item.data_lancamento}</td>
                    <td>{item.descricao_original}</td>
                    <td>{Number(item.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>{Number(item.saldo || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td>{item.natureza}</td>
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
