import { FormEvent, useEffect, useMemo, useState } from 'react'
import { hasPermission } from '../../authPermissions'
import { useAuth } from '../../store/auth'

const API_BASE = `${import.meta.env.VITE_API_URL || ''}/api`
type Aba = 'empresas' | 'contas' | 'produtos' | 'mapeamentos'

export default function CadastrosAdminPage() {
  const { user } = useAuth()
  const podeMapeamentos = hasPermission(user, 'mapeamentos_financeiro')
  const [aba, setAba] = useState<Aba>('empresas')
  const [dados, setDados] = useState<any>({ empresas: [], contas: [], produtos: [], mapeamentos: [] })
  const [form, setForm] = useState<any>({ ativo: true })
  const [erro, setErro] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [salvando, setSalvando] = useState(false)

  const carregar = async () => {
    const response = await fetch(`${API_BASE}/cadastros-diversos`)
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.erro || 'Erro ao carregar cadastros.')

    let mapeamentos: any[] = []
    if (podeMapeamentos) {
      const empresaId = Number(payload.empresas?.[0]?.id || 1)
      const respostaMapeamentos = await fetch(`${API_BASE}/mapeamentos-financeiro?empresaId=${empresaId}`)
      const payloadMapeamentos = await respostaMapeamentos.json().catch(() => ({}))
      if (!respostaMapeamentos.ok) throw new Error(payloadMapeamentos.erro || 'Erro ao carregar os mapeamentos do Financeiro Geral.')
      mapeamentos = payloadMapeamentos.mapeamentos || []
    }

    setDados({ ...payload, mapeamentos })
  }

  useEffect(() => { carregar().catch((e) => setErro(e.message)) }, [podeMapeamentos])

  const novo = () => {
    if (aba === 'mapeamentos') {
      setForm(dados.mapeamentos?.[0] ? { ...dados.mapeamentos[0], ativo: Boolean(Number(dados.mapeamentos[0].ativo)) } : { ativo: true })
      return
    }
    setForm({ ativo: true, empresa_id: dados.empresas?.[0]?.id || '' })
  }

  const abrirAba = (novaAba: Aba) => {
    setAba(novaAba)
    setErro('')
    setMensagem('')
    if (novaAba === 'mapeamentos') {
      const primeiro = dados.mapeamentos?.[0]
      setForm(primeiro ? { ...primeiro, ativo: Boolean(Number(primeiro.ativo)) } : { ativo: true })
    } else {
      setForm({ ativo: true, empresa_id: dados.empresas?.[0]?.id || '' })
    }
  }

  const salvar = async (event: FormEvent) => {
    event.preventDefault()
    setErro('')
    setMensagem('')
    setSalvando(true)
    try {
      let url = ''
      let method = 'POST'

      if (aba === 'mapeamentos') {
        if (!form.id) throw new Error('Selecione um mapeamento para alterar.')
        url = `${API_BASE}/mapeamentos-financeiro/${form.id}`
        method = 'PUT'
      } else {
        const plural = aba === 'empresas' ? 'empresas' : aba === 'contas' ? 'contas-financeiras' : 'produtos'
        url = `${API_BASE}/${plural}${form.id ? `/${form.id}` : ''}`
        method = form.id ? 'PUT' : 'POST'
      }

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.erro || 'Erro ao salvar.')

      setMensagem(aba === 'mapeamentos' ? (payload.mensagem || 'Mapeamento atualizado com sucesso.') : 'Cadastro salvo com sucesso.')
      await carregar()
      if (aba === 'mapeamentos') {
        setDados((atual: any) => atual)
      } else {
        novo()
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  const lista = aba === 'empresas'
    ? dados.empresas
    : aba === 'contas'
      ? dados.contas
      : aba === 'produtos'
        ? dados.produtos
        : dados.mapeamentos

  const contasDaEmpresa = useMemo(
    () => (dados.contas || []).filter((conta: any) => Number(conta.empresa_id) === Number(form.empresa_id)),
    [dados.contas, form.empresa_id]
  )

  const selecionar = (item: any) => {
    setForm({ ...item, ativo: Boolean(Number(item.ativo)) })
    setErro('')
    setMensagem('')
  }

  return <section className="settings-page">
    <header className="settings-header">
      <div>
        <span>Administração</span>
        <h1>Cadastros diversos</h1>
        <p>Gerencie empresas, contas financeiras, produtos e os mapeamentos do Financeiro Geral.</p>
      </div>
      {aba !== 'mapeamentos' && <button className="settings-btn settings-btn-secondary" onClick={novo}>Novo cadastro</button>}
    </header>

    {erro && <div className="settings-alert settings-alert-error">{erro}</div>}
    {mensagem && <div className="settings-alert settings-alert-success">{mensagem}</div>}

    <div className="settings-tabs">
      <button className={aba === 'empresas' ? 'active' : ''} onClick={() => abrirAba('empresas')}>Empresas</button>
      <button className={aba === 'contas' ? 'active' : ''} onClick={() => abrirAba('contas')}>Contas financeiras</button>
      <button className={aba === 'produtos' ? 'active' : ''} onClick={() => abrirAba('produtos')}>Produtos</button>
      {podeMapeamentos && <button className={aba === 'mapeamentos' ? 'active' : ''} onClick={() => abrirAba('mapeamentos')}>Mapeamentos Financeiro Geral</button>}
    </div>

    <div className="settings-grid">
      <article className="settings-card">
        <div className="cadastros-form-header">
          <div>
            <h2>{aba === 'mapeamentos' ? (form.id ? 'Editar mapeamento' : 'Selecione um mapeamento') : (form.id ? 'Editar cadastro' : 'Novo cadastro')}</h2>
            {aba === 'mapeamentos' && <p>O campo destino e o tipo são estruturais e permanecem protegidos. Você pode alterar o título, o vínculo e a situação do mapeamento.</p>}
          </div>
          <label className="cadastros-active-checkbox">
            <input type="checkbox" checked={form.ativo !== false} disabled={aba === 'mapeamentos' && !form.id} onChange={e => setForm({ ...form, ativo: e.target.checked })} />
            <span>Cadastro ativo</span>
          </label>
        </div>

        <form className="settings-form" onSubmit={salvar}>
          {aba === 'empresas' && <>
            <label><span>Nome da empresa</span><input required value={form.nome || ''} onChange={e => setForm({ ...form, nome: e.target.value })} /></label>
            <label><span>CNPJ</span><input value={form.cnpj || ''} onChange={e => setForm({ ...form, cnpj: e.target.value })} /></label>
          </>}

          {aba === 'contas' && <>
            <label><span>Empresa</span><select required value={form.empresa_id || ''} onChange={e => setForm({ ...form, empresa_id: Number(e.target.value) })}><option value="">Selecione</option>{dados.empresas.map((x: any) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></label>
            <label><span>Nome da conta</span><input required value={form.nome_conta || ''} onChange={e => setForm({ ...form, nome_conta: e.target.value })} placeholder="Ex.: Caixa Loja, Itaú Principal" /></label>
            <label><span>Tipo</span><select value={form.tipo || 'BANCARIA'} onChange={e => setForm({ ...form, tipo: e.target.value })}><option value="BANCARIA">Bancária</option><option value="CAIXA">Caixa</option><option value="GERENCIAL">Gerencial interna</option><option value="OUTRA">Outra</option></select></label>
            <label><span>Instituição</span><input value={form.instituicao || ''} onChange={e => setForm({ ...form, instituicao: e.target.value })} placeholder="Banco ou instituição, quando houver" /></label>
            <label><span>Agência</span><input value={form.agencia || ''} onChange={e => setForm({ ...form, agencia: e.target.value })} /></label>
            <label><span>Número da conta</span><input value={form.numero_conta || ''} onChange={e => setForm({ ...form, numero_conta: e.target.value })} /></label>
            <label className="settings-field-full"><span>Observações</span><input value={form.observacoes || ''} onChange={e => setForm({ ...form, observacoes: e.target.value })} /></label>
          </>}

          {aba === 'produtos' && <>
            <label><span>Produto</span><input required value={form.nome || ''} onChange={e => setForm({ ...form, nome: e.target.value })} /></label>
            <label><span>Tipo</span><input value={form.tipo || 'COMBUSTIVEL'} onChange={e => setForm({ ...form, tipo: e.target.value })} /></label>
            <label><span>Unidade</span><input value={form.unidade || 'L'} onChange={e => setForm({ ...form, unidade: e.target.value })} /></label>
          </>}

          {aba === 'mapeamentos' && form.id && <>
            <label><span>Empresa</span><input value={form.empresa || ''} disabled /></label>
            <label><span>Tipo</span><input value={form.tipo || ''} disabled /></label>
            <label><span>Campo destino</span><input value={form.campo_destino || ''} disabled /></label>
            <label><span>Título / descrição</span><input required value={form.descricao || ''} onChange={e => setForm({ ...form, descricao: e.target.value })} /></label>
            {String(form.tipo || '').toUpperCase() === 'CONTA' && <label className="settings-field-full"><span>Conta financeira vinculada</span><select value={form.conta_financeira_id || ''} onChange={e => setForm({ ...form, conta_financeira_id: e.target.value ? Number(e.target.value) : null })}><option value="">Sem vínculo específico</option>{contasDaEmpresa.map((conta: any) => <option key={conta.id} value={conta.id}>{conta.nome_conta}</option>)}</select></label>}
            {String(form.tipo || '').toUpperCase() === 'PRODUTO' && <label className="settings-field-full"><span>Produto vinculado</span><select value={form.produto_id || ''} onChange={e => setForm({ ...form, produto_id: e.target.value ? Number(e.target.value) : null })}><option value="">Sem vínculo específico</option>{dados.produtos.map((produto: any) => <option key={produto.id} value={produto.id}>{produto.nome}</option>)}</select></label>}
          </>}

          <div className="settings-actions">
            <button className="settings-btn settings-btn-primary" type="submit" disabled={salvando || (aba === 'mapeamentos' && !form.id)}>{salvando ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </form>
      </article>

      <article className="settings-card">
        <div className="settings-card-title"><div><h2>{aba === 'mapeamentos' ? 'Mapeamentos existentes' : 'Cadastros existentes'}</h2><p>{lista?.length || 0} registro(s).</p></div></div>
        <div className="settings-users-list">{lista?.map((item: any) => <button type="button" className="settings-user-row" key={item.id} onClick={() => selecionar(item)}>
          <div>
            <strong>{aba === 'mapeamentos' ? item.descricao : (item.nome || item.nome_conta)}</strong>
            <span>{aba === 'contas'
              ? `${item.empresa} • ${item.tipo}`
              : aba === 'produtos'
                ? `${item.tipo} • ${item.unidade}`
                : aba === 'mapeamentos'
                  ? `${item.campo_destino} • ${item.tipo}${item.conta_financeira ? ` • ${item.conta_financeira}` : item.produto ? ` • ${item.produto}` : ''}`
                  : item.cnpj || 'Sem CNPJ'}</span>
          </div>
          <span>{Number(item.ativo) ? 'Ativo' : 'Inativo'}</span>
        </button>)}</div>
      </article>
    </div>
  </section>
}
