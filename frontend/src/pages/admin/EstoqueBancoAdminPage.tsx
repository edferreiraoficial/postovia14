import { useEffect, useState } from 'react';

const API_BASE = `${import.meta.env.VITE_API_URL || ''}/api`;
const dataIso = (data: Date) => data.toISOString().slice(0, 10);
const primeiroDiaMesAtual = () => { const a = new Date(); return dataIso(new Date(a.getFullYear(), a.getMonth(), 1)); };
const ultimoDiaMesAtual = () => { const a = new Date(); return dataIso(new Date(a.getFullYear(), a.getMonth() + 1, 0)); };

type Conta = { id:number; nome_conta:string; banco:string };
type TipoDados = 'extrato' | 'compras' | 'lmc' | 'vendasCartao';

export default function EstoqueBancoAdminPage() {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [tipoDados, setTipoDados] = useState<TipoDados>('extrato');
  const [contas, setContas] = useState<Conta[]>([]);
  const [contaBancariaId, setContaBancariaId] = useState('');
  const [dataInicial, setDataInicial] = useState(primeiroDiaMesAtual());
  const [dataFinal, setDataFinal] = useState(ultimoDiaMesAtual());
  const [importando, setImportando] = useState(false);
  const [carregandoContas, setCarregandoContas] = useState(false);
  const [mensagem, setMensagem] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setCarregandoContas(true);
        const r = await fetch(`${API_BASE}/contas-bancarias`);
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.erro || 'Erro ao carregar contas bancárias.');
        const lista = Array.isArray(j.dados) ? j.dados : [];
        setContas(lista);
        if (lista.length === 1) setContaBancariaId(String(lista[0].id));
      } catch (e) { setMensagem(e instanceof Error ? e.message : 'Erro ao carregar contas bancárias.'); }
      finally { setCarregandoContas(false); }
    })();
  }, []);

  const extensao = arquivo?.name.split('.').pop()?.toLowerCase() || '';
  const formato = extensao === 'pdf' ? 'PDF' : extensao === 'xls' ? 'XLS' : extensao === 'xlsx' ? 'XLSX' : '';
  const conta = contas.find((c) => String(c.id) === contaBancariaId);

  async function importar(e: React.FormEvent) {
    e.preventDefault(); setMensagem('');
    if (!arquivo) return setMensagem('Selecione um arquivo PDF, XLS ou XLSX.');
    if (!['pdf','xls','xlsx'].includes(extensao)) return setMensagem('Formato não suportado. Use PDF, XLS ou XLSX.');
    if (!dataInicial || !dataFinal || dataInicial > dataFinal) return setMensagem('Informe um período inicial e final válido.');
    if (tipoDados === 'extrato' && !contaBancariaId) return setMensagem('Selecione a conta bancária de destino.');
    if (tipoDados === 'vendasCartao' && extensao === 'pdf') return setMensagem('Vendas de cartão ainda exigem XLS/XLSX; PDF não possui parser configurado para esse tipo.');

    try {
      setImportando(true);
      const fd = new FormData();
      fd.append('arquivo', arquivo);
      fd.append('tipoDados', tipoDados);
      fd.append('dataInicial', dataInicial);
      fd.append('dataFinal', dataFinal);
      if (contaBancariaId) fd.append('contaBancariaId', contaBancariaId);
      const r = await fetch(`${API_BASE}/importar-dados-financeiros`, { method:'POST', body:fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.erro || 'Erro ao importar arquivo.');
      const x = j.resultado || {};
      const qtd = tipoDados === 'extrato' ? x.extrato : tipoDados === 'compras' ? x.compras : tipoDados === 'lmc' ? x.lmc : x.vendasCartao;
      setMensagem(`${j.mensagem} ${Number(qtd || 0)} registro(s) importado(s).`);
      setArquivo(null);
      const input = document.getElementById('arquivo-financeiro') as HTMLInputElement | null;
      if (input) input.value = '';
    } catch (e) { setMensagem(e instanceof Error ? e.message : 'Erro ao importar arquivo.'); }
    finally { setImportando(false); }
  }

  return <div className="admin-tool-page">
    <section className="admin-tool-hero" style={{width:'100%',padding:'12px 14px',marginBottom:6}}>
      <h1 style={{marginBottom:4}}>Importar Dados Financeiros</h1>
      <p style={{margin:0}}>Selecione o destino e o arquivo. O sistema reconhece automaticamente PDF, XLS ou XLSX e importa diretamente para o banco de dados.</p>
    </section>

    <form onSubmit={importar} className="admin-tool-form" style={{width:'100%',gap:8}}>
      <section className="admin-tool-card" style={{width:'100%',padding:'10px 12px'}}>
        <strong style={{color:'#1F4F73',fontSize:'1.08rem'}}>Período da importação</strong>
        <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'flex-end',marginTop:8}}>
          <label style={{display:'grid',gap:5,fontWeight:600}}>Data inicial<input type="date" value={dataInicial} onChange={e=>setDataInicial(e.target.value)} disabled={importando}/></label>
          <label style={{display:'grid',gap:5,fontWeight:600}}>Data final<input type="date" value={dataFinal} onChange={e=>setDataFinal(e.target.value)} disabled={importando}/></label>
          <span style={{color:'#64748B',paddingBottom:9}}>Somente registros dentro deste período serão importados.</span>
        </div>
      </section>

      <section className="admin-tool-card admin-upload-card" style={{width:'100%',padding:'12px'}}>
        <strong style={{color:'#1F4F73',fontSize:'1.08rem'}}>Arquivo para importação</strong>
        <p style={{color:'#64748B',margin:'4px 0 12px'}}>Uma única entrada para PDF e Excel. Não é necessário gerar Excel antes de importar um PDF.</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:10,alignItems:'end'}}>
          <label style={{display:'grid',gap:5,fontWeight:600}}>Tipo de dados
            <select className="admin-tool-select" value={tipoDados} onChange={e=>setTipoDados(e.target.value as TipoDados)} disabled={importando}>
              <option value="extrato">Extrato bancário</option><option value="compras">Compras</option><option value="lmc">Vendas / LMC</option><option value="vendasCartao">Vendas Cartão</option>
            </select>
          </label>
          {tipoDados === 'extrato' && <label style={{display:'grid',gap:5,fontWeight:600}}>Conta bancária de destino
            <select className="admin-tool-select" value={contaBancariaId} onChange={e=>setContaBancariaId(e.target.value)} disabled={importando||carregandoContas}>
              <option value="">{carregandoContas?'Carregando...':'Selecione a conta'}</option>
              {contas.map(c=><option key={c.id} value={c.id}>{c.nome_conta} — {c.banco}</option>)}
            </select>
          </label>}
          <label style={{display:'grid',gap:5,fontWeight:600}}>Arquivo PDF, XLS ou XLSX
            <input id="arquivo-financeiro" type="file" accept=".pdf,.xls,.xlsx,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e=>setArquivo(e.target.files?.[0]||null)} disabled={importando}/>
          </label>
        </div>
        {arquivo && <div style={{marginTop:12,padding:10,background:'#F8FAFC',border:'1px solid #E2E8F0',borderRadius:8}}>
          <strong>{arquivo.name}</strong><div style={{color:'#64748B',marginTop:3}}>Formato detectado: {formato}{tipoDados==='extrato'&&conta?` • Destino: ${conta.nome_conta} — ${conta.banco}`:''}</div>
        </div>}
        <div style={{display:'flex',justifyContent:'flex-end',marginTop:12}}><button className="admin-primary-button" type="submit" disabled={importando||carregandoContas}>{importando?'Importando...':'Importar para o Banco de Dados'}</button></div>
      </section>
    </form>
    {mensagem && <p className="admin-tool-message">{mensagem}</p>}
  </div>;
}
