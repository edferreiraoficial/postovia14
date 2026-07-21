import { useState } from 'react';

const API_BASE = `${import.meta.env.VITE_API_URL || ''}/api`;
type Banco = 'itau' | 'spot' | 'compras' | 'lmc';

export default function PdfExcelAdminPage() {
  const [arquivoItau, setArquivoItau] = useState<File | null>(null);
  const [arquivoSpot, setArquivoSpot] = useState<File | null>(null);
  const [arquivoCompras, setArquivoCompras] = useState<File | null>(null);
  const [arquivoLmc, setArquivoLmc] = useState<File | null>(null);
  const [processando, setProcessando] = useState<Banco | null>(null);
  const [mensagem, setMensagem] = useState('');

  async function converterPdf(e: React.FormEvent, banco: Banco) {
    e.preventDefault();
    setMensagem('');

    const arquivo = banco === 'itau' ? arquivoItau : banco === 'spot' ? arquivoSpot : banco === 'compras' ? arquivoCompras : arquivoLmc;

    if (!arquivo) {
      setMensagem('Selecione um arquivo PDF para converter.');
      return;
    }

    try {
      setProcessando(banco);
      setMensagem('Lendo PDF e gerando planilha Excel consolidada...');

      const formData = new FormData();
      formData.append('pdf', arquivo);
      formData.append('banco', banco);

      const response = await fetch(`${API_BASE}/pdf-extrato-excel`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const erro = await response.json().catch(() => null);
        throw new Error(erro?.erro || 'Erro ao converter PDF em Excel.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const nomeBase = arquivo.name.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '_');
      link.href = url;
      link.download = `${nomeBase || 'extrato'}_consolidado.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setMensagem('Planilha Excel gerada com sucesso.');
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : 'Erro ao converter PDF em Excel.');
    } finally {
      setProcessando(null);
    }
  }

  return (
    <div className="admin-tool-page admin-pdf-excel-page">
      <section className="admin-tool-hero admin-pdf-excel-hero">
        <h1>PDF para Excel</h1>
        <p>Extraia extratos bancários em PDF para uma planilha Excel</p>
      </section>

      <form className="admin-tool-card admin-tool-form admin-pdf-excel-card" onSubmit={(e) => converterPdf(e, 'itau')}>
        <div className="admin-tool-section-title admin-pdf-excel-title-row">
          <div>
            <h2>Converter extrato banco Itaú</h2>
            <p>Extraia extratos bancários em PDF para uma planilha Excel</p>
          </div>
        </div>

        <div className="admin-pdf-excel-file-action">
          <label className="admin-file-picker">
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setArquivoItau(e.target.files?.[0] || null)}
            />
            <span>Escolher arquivo PDF</span>
            <small>{arquivoItau?.name || 'Nenhum arquivo escolhido'}</small>
          </label>
          <button className="admin-primary-button" type="submit" disabled={processando === 'itau'}>
            {processando === 'itau' ? 'Gerando Excel...' : 'Gerar Excel'}
          </button>
        </div>
      </form>

      <form className="admin-tool-card admin-tool-form admin-pdf-excel-card" onSubmit={(e) => converterPdf(e, 'spot')}>
        <div className="admin-tool-section-title admin-pdf-excel-title-row">
          <div>
            <h2>Converter extrato banco Spot</h2>
            <p>Extraia extratos bancários em PDF para uma planilha Excel</p>
          </div>
        </div>

        <div className="admin-pdf-excel-file-action">
          <label className="admin-file-picker">
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setArquivoSpot(e.target.files?.[0] || null)}
            />
            <span>Escolher arquivo PDF</span>
            <small>{arquivoSpot?.name || 'Nenhum arquivo escolhido'}</small>
          </label>
          <button className="admin-primary-button" type="submit" disabled={processando === 'spot'}>
            {processando === 'spot' ? 'Gerando Excel...' : 'Gerar Excel'}
          </button>
        </div>
      </form>

      <form className="admin-tool-card admin-tool-form admin-pdf-excel-card" onSubmit={(e) => converterPdf(e, 'compras')}>
        <div className="admin-tool-section-title admin-pdf-excel-title-row">
          <div>
            <h2>Converter Compras de Combustível</h2>
            <p>Extraia compras em PDF para uma planilha Excel</p>
          </div>
        </div>

        <div className="admin-pdf-excel-file-action">
          <label className="admin-file-picker">
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setArquivoCompras(e.target.files?.[0] || null)}
            />
            <span>Escolher arquivo PDF</span>
            <small>{arquivoCompras?.name || 'Nenhum arquivo escolhido'}</small>
          </label>
          <button className="admin-primary-button" type="submit" disabled={processando === 'compras'}>
            {processando === 'compras' ? 'Gerando Excel...' : 'Gerar Excel'}
          </button>
        </div>
      </form>

      <form className="admin-tool-card admin-tool-form admin-pdf-excel-card" onSubmit={(e) => converterPdf(e, 'lmc')}>
        <div className="admin-tool-section-title admin-pdf-excel-title-row">
          <div>
            <h2>Converter LMC</h2>
            <p>Extraia Livro de Movimentação de Combustíveis em PDF para uma planilha Excel</p>
          </div>
        </div>

        <div className="admin-pdf-excel-file-action">
          <label className="admin-file-picker">
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setArquivoLmc(e.target.files?.[0] || null)}
            />
            <span>Escolher arquivo PDF</span>
            <small>{arquivoLmc?.name || 'Nenhum arquivo escolhido'}</small>
          </label>
          <button className="admin-primary-button" type="submit" disabled={processando === 'lmc'}>
            {processando === 'lmc' ? 'Gerando Excel...' : 'Gerar Excel'}
          </button>
        </div>
      </form>


      {mensagem && <div className="admin-tool-message">{mensagem}</div>}
    </div>
  );
}
