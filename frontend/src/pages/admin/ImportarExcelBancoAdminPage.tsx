import { useEffect, useState } from 'react';

const API_BASE = `${import.meta.env.VITE_API_URL || ''}/api`;

type ContaBancaria = {
  id: number;
  nome_conta: string;
  banco: string;
  codigo?: string | null;
};

const cardCompacto = { padding: 8, gap: 5 } as const;
const linhaCompacta = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  alignItems: 'center',
  lineHeight: 1.2,
} as const;

export default function ImportarExcelBancoAdminPage() {
  const [arquivoExtrato, setArquivoExtrato] = useState<File | null>(null);
  const [arquivoLmc, setArquivoLmc] = useState<File | null>(null);
  const [arquivoCompras, setArquivoCompras] = useState<File | null>(null);
  const [arquivoVendasCartao, setArquivoVendasCartao] = useState<File | null>(null);
  const [contas, setContas] = useState<ContaBancaria[]>([]);
  const [contaBancariaId, setContaBancariaId] = useState('');
  const [carregandoContas, setCarregandoContas] = useState(false);
  const [importando, setImportando] = useState(false);
  const [mensagem, setMensagem] = useState('');

  useEffect(() => {
    async function carregarContas() {
      try {
        setCarregandoContas(true);
        const response = await fetch(`${API_BASE}/contas-bancarias`);
        const json = await response.json().catch(() => null);
        if (!response.ok || !json?.ok) {
          throw new Error(json?.erro || 'Erro ao carregar as contas bancárias.');
        }
        const lista = Array.isArray(json.dados) ? json.dados : [];
        setContas(lista);
        if (lista.length === 1) setContaBancariaId(String(lista[0].id));
      } catch (error) {
        setMensagem(error instanceof Error ? error.message : 'Erro ao carregar as contas bancárias.');
      } finally {
        setCarregandoContas(false);
      }
    }

    carregarContas();
  }, []);

  async function importarExcel(e: React.FormEvent) {
    e.preventDefault();
    setMensagem('');

    if (!arquivoExtrato && !arquivoLmc && !arquivoCompras && !arquivoVendasCartao) {
      setMensagem('Selecione pelo menos um arquivo Excel para importar.');
      return;
    }

    if (arquivoExtrato && !contaBancariaId) {
      setMensagem('Selecione a conta bancária que receberá o extrato.');
      return;
    }

    try {
      setImportando(true);
      const formData = new FormData();
      if (arquivoExtrato) {
        formData.append('extrato', arquivoExtrato);
        formData.append('contaBancariaId', contaBancariaId);
      }
      if (arquivoLmc) formData.append('lmc', arquivoLmc);
      if (arquivoCompras) formData.append('compras', arquivoCompras);
      if (arquivoVendasCartao) formData.append('vendasCartao', arquivoVendasCartao);

      const response = await fetch(`${API_BASE}/importar-excel-banco`, {
        method: 'POST',
        body: formData,
      });
      const json = await response.json().catch(() => null);

      if (!response.ok || !json?.ok) {
        throw new Error(json?.erro || json?.message || 'Erro ao importar Excel para o banco.');
      }

      const partes: string[] = [];
      if (json.resultado?.contaBancaria) {
        partes.push(
          `Extrato de ${json.resultado.contaBancaria.nome}: ${json.resultado.extrato || 0} registros importados` +
          ` (${json.resultado.removidos?.extrato || 0} anteriores substituídos).`
        );
      }
      if (arquivoCompras) {
        partes.push(`Compras: ${json.resultado?.compras || 0} registros importados.`);
      }
      if (arquivoLmc) {
        partes.push(`Vendas: ${json.resultado?.lmc || 0} registros importados.`);
      }
      if (arquivoVendasCartao) {
        partes.push(
          `Vendas Cartão: ${json.resultado?.vendasCartao || 0} registros importados` +
          ` (${json.resultado?.removidos?.vendasCartao || 0} anteriores substituídos).`
        );
      }

      setMensagem(`${json.mensagem} ${partes.join(' ')}`.trim());
      setArquivoExtrato(null);
      setArquivoCompras(null);
      setArquivoLmc(null);
      setArquivoVendasCartao(null);

      const inputs = document.querySelectorAll<HTMLInputElement>('.admin-import-excel-input');
      inputs.forEach((input) => { input.value = ''; });
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : 'Erro ao importar Excel para o banco.');
    } finally {
      setImportando(false);
    }
  }

  return (
    <div className="admin-tool-page">
      <section className="admin-tool-hero" style={{ width: '100%', padding: '12px 14px', marginBottom: 6 }}>
        <h1 style={{ marginBottom: 4 }}>Importar Excel para o Banco de Dados</h1>
        <p style={{ margin: 0 }}>Selecione a conta bancária de destino antes de importar o extrato.</p>
      </section>

      <form onSubmit={importarExcel} className="admin-tool-form" style={{ width: '100%', gap: 8 }}>
        <section className="admin-tool-card admin-upload-card" style={{ ...cardCompacto, width: '100%', padding: '10px 12px' }}>
          <strong style={{ color: '#1F4F73', fontSize: '1.08rem' }}>Importação de Extrato Bancário</strong>
          <div style={linhaCompacta}>
            <span style={{ color: '#64748B' }}>Itaú, SPOTBANK, Haden Bank, Caixa e futuras contas cadastradas</span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', width: '100%' }}>
            <label style={{ display: 'grid', gap: 5, color: '#334155', fontWeight: 600, flex: '1 1 240px', minWidth: 0 }}>
              Conta Bancária
              <select
                value={contaBancariaId}
                onChange={(e) => setContaBancariaId(e.target.value)}
                disabled={carregandoContas || importando}
                style={{ minHeight: 40, border: '1px solid #CBD5E1', borderRadius: 7, padding: '0 10px', background: '#fff' }}
              >
                <option value="">{carregandoContas ? 'Carregando contas...' : 'Selecione a conta'}</option>
                {contas.map((conta) => (
                  <option key={conta.id} value={conta.id}>
                    {conta.nome_conta} — {conta.banco}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: 5, color: '#334155', fontWeight: 600, flex: '2 1 320px', minWidth: 0, maxWidth: '100%' }}>
              Arquivo Excel do Extrato
              <input
                className="admin-import-excel-input"
                type="file"
                accept=".xlsx"
                onChange={(e) => setArquivoExtrato(e.target.files?.[0] || null)}
                disabled={importando}
                style={{ width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}
              />
              {arquivoExtrato && <small style={{ color: '#64748B', fontWeight: 400 }}>{arquivoExtrato.name}</small>}
            </label>

            <button className="admin-primary-button" type="submit" disabled={importando || carregandoContas} style={{ flex: '0 0 auto' }}>
              {importando ? 'Importando...' : 'Importar Dados'}
            </button>
          </div>
        </section>

        <section className="admin-tool-card admin-upload-card" style={{ ...cardCompacto, width: '100%', padding: '10px 12px' }}>
          <strong style={{ color: '#1F4F73', fontSize: '1.08rem' }}>Excel Compras</strong>
          <div style={linhaCompacta}>
            <span style={{ color: '#64748B' }}>Notas e compras de combustível</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'grid', gap: 3 }}>
              <input
                className="admin-import-excel-input"
                type="file"
                accept=".xlsx"
                onChange={(e) => setArquivoCompras(e.target.files?.[0] || null)}
                disabled={importando}
              />
              {arquivoCompras && <small style={{ color: '#64748B' }}>{arquivoCompras.name}</small>}
            </div>
            <button className="admin-primary-button" type="submit" disabled={importando}>
              {importando ? 'Importando...' : 'Importar Dados'}
            </button>
          </div>
        </section>

        <section className="admin-tool-card admin-upload-card" style={{ ...cardCompacto, width: '100%', padding: '10px 12px' }}>
          <strong style={{ color: '#1F4F73', fontSize: '1.08rem' }}>Excel Vendas LMC</strong>
          <div style={linhaCompacta}>
            <span style={{ color: '#64748B' }}>Livro de Movimentação de Combustíveis</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'grid', gap: 3 }}>
              <input
                className="admin-import-excel-input"
                type="file"
                accept=".xlsx"
                onChange={(e) => setArquivoLmc(e.target.files?.[0] || null)}
                disabled={importando}
              />
              {arquivoLmc && <small style={{ color: '#64748B' }}>{arquivoLmc.name}</small>}
            </div>
            <button className="admin-primary-button" type="submit" disabled={importando}>
              {importando ? 'Importando...' : 'Importar Dados'}
            </button>
          </div>
        </section>

        <section className="admin-tool-card admin-upload-card" style={{ ...cardCompacto, width: '100%', padding: '10px 12px' }}>
          <strong style={{ color: '#1F4F73', fontSize: '1.08rem' }}>Excel Vendas Cartão</strong>
          <div style={linhaCompacta}>
            <span style={{ color: '#64748B' }}>Vendas brutas, vendas líquidas e taxas de cartão</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'grid', gap: 3 }}>
              <input
                className="admin-import-excel-input"
                type="file"
                accept=".xlsx"
                onChange={(e) => setArquivoVendasCartao(e.target.files?.[0] || null)}
                disabled={importando}
              />
              {arquivoVendasCartao && <small style={{ color: '#64748B' }}>{arquivoVendasCartao.name}</small>}
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
