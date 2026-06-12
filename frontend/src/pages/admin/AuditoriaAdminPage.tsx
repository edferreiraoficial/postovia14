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

export default function AuditoriaAdminPage() {
  const [resumo, setResumo] = useState<any>(null);
  const [comprasLmc, setComprasLmc] = useState<any[]>([]);
  const [vendasBancos, setVendasBancos] = useState<any[]>([]);
  const [competencia, setCompetencia] = useState('Mar26');  

  async function carregarDados() {
    try {
      const [resumoResp, comprasResp, vendasBancosResp] = await Promise.all([
        fetch(`${API_BASE}/auditoria/resumo?competencia=${competencia}`),
        fetch(`${API_BASE}/auditoria/compras-lmc?competencia=${competencia}`),
        fetch(`${API_BASE}/auditoria/vendas-bancos?competencia=${competencia}`)
      ]);

      const resumoJson = await resumoResp.json();
      const comprasJson = await comprasResp.json();
      const vendasBancosJson = await vendasBancosResp.json();      

      setResumo(resumoJson);
      setComprasLmc(comprasJson.dados || []);
      setVendasBancos(vendasBancosJson.dados || []);
    } catch (error) {
      console.error(error);
    }
  }

  useEffect(() => {
    carregarDados();
  }, [competencia]);

  const moeda = (v: number) =>
    Number(v || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });

  return (
    <div className="admin-tool-page">

      <section className="admin-tool-hero">
        <h1>Auditoria Financeira</h1>
        <p>Cruzamento automático de compras, vendas e bancos por competência.</p>
      </section>

      <section className="admin-tool-card">
        <div className="admin-tool-section-title">
          <h2>Competência</h2>
          <span>Analisar dados de um mês específico.</span>
        </div>
   
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
      </section>

      {resumo && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))',
            gap: '16px',
            marginBottom: '24px'
          }}
        >
          <div className="admin-tool-card">
            <h3>Total Compras</h3>
            <strong>{moeda(resumo.compras)}</strong>
          </div>

          <div className="admin-tool-card">
            <h3>Total Vendas</h3>
            <strong>{moeda(resumo.vendas)}</strong>
          </div>

          <div className="admin-tool-card">
            <h3>Entradas Bancárias</h3>
            <strong>{moeda(resumo.entradasBanco)}</strong>
          </div>

          <div className="admin-tool-card">
            <h3>Diferença</h3>
            <strong>
              {moeda(resumo.diferenca)}
            </strong>
          </div>
        </div>
      )}

      <section className="admin-tool-card">
        <h2>Compras x LMC</h2>

        <table className="admin-table">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Comprado</th>
              <th>Recebido LMC</th>
              <th>Diferença</th>
            </tr>
          </thead>

          <tbody>
            {comprasLmc.map((item) => (
              <tr key={item.produto}>
                <td>{item.produto}</td>
                <td>{Number(item.comprado).toLocaleString('pt-BR')}</td>
                <td>{Number(item.recebido_lmc).toLocaleString('pt-BR')}</td>
                <td>
                  {Number(item.diferenca).toLocaleString('pt-BR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="admin-tool-card" style={{ marginTop: 24 }}>
        <h2>Vendas LMC x Entradas Bancárias</h2>

         <table className="admin-table">
           <thead>
             <tr>
               <th>Data</th>
               <th>Vendas LMC</th>
               <th>Entradas Banco</th>
               <th>Diferença</th>
             </tr>
           </thead>

           <tbody>
             {vendasBancos.map((item) => (
               <tr key={item.data_movimento}>
                 <td>{item.data_movimento}</td>
                 <td>{moeda(item.vendas_lmc)}</td>
                 <td>{moeda(item.entradas_banco)}</td>
                 <td>{moeda(item.diferenca)}</td>
               </tr>
             ))}
           </tbody>
         </table>
      </section>
    </div>
  );
}