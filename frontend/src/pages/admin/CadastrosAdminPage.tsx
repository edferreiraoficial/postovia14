import { FormEvent, useEffect, useState } from 'react'

const API_BASE = `${import.meta.env.VITE_API_URL || ''}/api`
type Aba = 'empresas' | 'contas' | 'produtos'

export default function CadastrosAdminPage() {
  const [aba, setAba] = useState<Aba>('empresas')
  const [dados, setDados] = useState<any>({ empresas: [], contas: [], produtos: [] })
  const [form, setForm] = useState<any>({ ativo: true })
  const [erro, setErro] = useState('')
  const [mensagem, setMensagem] = useState('')

  const carregar = async () => {
    const response = await fetch(`${API_BASE}/cadastros-diversos`)
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.erro || 'Erro ao carregar cadastros.')
    setDados(payload)
  }
  useEffect(() => { carregar().catch((e) => setErro(e.message)) }, [])
  const novo = () => setForm({ ativo: true, empresa_id: dados.empresas?.[0]?.id || '' })
  const salvar = async (event: FormEvent) => {
    event.preventDefault(); setErro(''); setMensagem('')
    try {
      const plural = aba === 'empresas' ? 'empresas' : aba === 'contas' ? 'contas-financeiras' : 'produtos'
      const url = `${API_BASE}/${plural}${form.id ? `/${form.id}` : ''}`
      const response = await fetch(url, { method: form.id ? 'PUT' : 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(form) })
      const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.erro || 'Erro ao salvar.')
      setMensagem('Cadastro salvo com sucesso.'); novo(); await carregar()
    } catch(e){ setErro(e instanceof Error ? e.message : 'Erro ao salvar.') }
  }
  const lista = aba === 'empresas' ? dados.empresas : aba === 'contas' ? dados.contas : dados.produtos
  return <section className="settings-page">
    <header className="settings-header"><div><span>Administração</span><h1>Cadastros diversos</h1><p>Gerencie empresas, contas financeiras e produtos em um único local.</p></div><button className="settings-btn settings-btn-secondary" onClick={novo}>Novo cadastro</button></header>
    {erro && <div className="settings-alert settings-alert-error">{erro}</div>}{mensagem && <div className="settings-alert settings-alert-success">{mensagem}</div>}
    <div className="settings-tabs"><button className={aba==='empresas'?'active':''} onClick={()=>{setAba('empresas');novo()}}>Empresas</button><button className={aba==='contas'?'active':''} onClick={()=>{setAba('contas');novo()}}>Contas financeiras</button><button className={aba==='produtos'?'active':''} onClick={()=>{setAba('produtos');novo()}}>Produtos</button></div>
    <div className="settings-grid">
      <article className="settings-card"><div className="cadastros-form-header"><h2>{form.id ? 'Editar cadastro' : 'Novo cadastro'}</h2><label className="cadastros-active-checkbox"><input type="checkbox" checked={form.ativo!==false} onChange={e=>setForm({...form,ativo:e.target.checked})}/><span>Cadastro ativo</span></label></div><form className="settings-form" onSubmit={salvar}>
        {aba==='empresas' && <><label><span>Nome da empresa</span><input required value={form.nome||''} onChange={e=>setForm({...form,nome:e.target.value})}/></label><label><span>CNPJ</span><input value={form.cnpj||''} onChange={e=>setForm({...form,cnpj:e.target.value})}/></label></>}
        {aba==='contas' && <><label><span>Empresa</span><select required value={form.empresa_id||''} onChange={e=>setForm({...form,empresa_id:Number(e.target.value)})}><option value="">Selecione</option>{dados.empresas.map((x:any)=><option key={x.id} value={x.id}>{x.nome}</option>)}</select></label><label><span>Nome da conta</span><input required value={form.nome_conta||''} onChange={e=>setForm({...form,nome_conta:e.target.value})} placeholder="Ex.: Caixa Loja, Itaú Principal"/></label><label><span>Tipo</span><select value={form.tipo||'BANCARIA'} onChange={e=>setForm({...form,tipo:e.target.value})}><option value="BANCARIA">Bancária</option><option value="CAIXA">Caixa</option><option value="GERENCIAL">Gerencial interna</option><option value="OUTRA">Outra</option></select></label><label><span>Instituição</span><input value={form.instituicao||''} onChange={e=>setForm({...form,instituicao:e.target.value})} placeholder="Banco ou instituição, quando houver"/></label><label><span>Agência</span><input value={form.agencia||''} onChange={e=>setForm({...form,agencia:e.target.value})}/></label><label><span>Número da conta</span><input value={form.numero_conta||''} onChange={e=>setForm({...form,numero_conta:e.target.value})}/></label><label className="settings-field-full"><span>Observações</span><input value={form.observacoes||''} onChange={e=>setForm({...form,observacoes:e.target.value})}/></label></>}
        {aba==='produtos' && <><label><span>Produto</span><input required value={form.nome||''} onChange={e=>setForm({...form,nome:e.target.value})}/></label><label><span>Tipo</span><input value={form.tipo||'COMBUSTIVEL'} onChange={e=>setForm({...form,tipo:e.target.value})}/></label><label><span>Unidade</span><input value={form.unidade||'L'} onChange={e=>setForm({...form,unidade:e.target.value})}/></label></>}
        <div className="settings-actions"><button className="settings-btn settings-btn-primary" type="submit">Salvar</button></div>
      </form></article>
      <article className="settings-card"><div className="settings-card-title"><div><h2>Cadastros existentes</h2><p>{lista?.length||0} registro(s).</p></div></div><div className="settings-users-list">{lista?.map((item:any)=><button type="button" className="settings-user-row" key={item.id} onClick={()=>setForm({...item,ativo:Boolean(Number(item.ativo))})}><div><strong>{item.nome || item.nome_conta}</strong><span>{aba==='contas' ? `${item.empresa} • ${item.tipo}` : aba==='produtos' ? `${item.tipo} • ${item.unidade}` : item.cnpj || 'Sem CNPJ'}</span></div><span>{Number(item.ativo)?'Ativo':'Inativo'}</span></button>)}</div></article>
    </div>
  </section>
}
