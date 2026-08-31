import { FormEvent, useEffect, useMemo, useState } from 'react'
import { hasPermission } from '../../authPermissions'
import { useAuth } from '../../store/auth'

const API_BASE = `${import.meta.env.VITE_API_URL || ''}/api`
type Aba = 'empresas' | 'contas' | 'produtos' | 'mapeamentos' | 'tipos_lancamento' | 'relatorio_periodo'

export default function CadastrosAdminPage() {
  const { user } = useAuth()
  const podeMapeamentos = hasPermission(user, 'mapeamentos_financeiro')
  const podeConfigRelatorio = hasPermission(user, 'configuracoes') || podeMapeamentos
  const [aba, setAba] = useState<Aba>('empresas')
  const [dados, setDados] = useState<any>({ empresas: [], contas: [], produtos: [], mapeamentos: [], tiposLancamento: [], regrasTipo: [] })
  const [form, setForm] = useState<any>({ ativo: true })
  const [erro, setErro] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [regraForm, setRegraForm] = useState<any>({ prioridade: 100, ativo: true })
  const [salvandoRegra, setSalvandoRegra] = useState(false)
  const [tiposRelatorio, setTiposRelatorio] = useState<any[]>([])
  const [salvandoRelatorio, setSalvandoRelatorio] = useState(false)

  const carregar = async () => {
    const response = await fetch(`${API_BASE}/cadastros-diversos`)
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.erro || 'Erro ao carregar cadastros.')

    let mapeamentos: any[] = []
    let tiposLancamento: any[] = []
    let regrasTipo: any[] = []
    if (podeMapeamentos) {
      const empresaId = Number(payload.empresas?.[0]?.id || 1)
      const [respostaMapeamentos, respostaTipos] = await Promise.all([
        fetch(`${API_BASE}/mapeamentos-financeiro?empresaId=${empresaId}`),
        fetch(`${API_BASE}/tipos-lancamento`),
      ])
      const payloadMapeamentos = await respostaMapeamentos.json().catch(() => ({}))
      const payloadTipos = await respostaTipos.json().catch(() => ({}))
      if (!respostaMapeamentos.ok) throw new Error(payloadMapeamentos.erro || 'Erro ao carregar os mapeamentos do Financeiro Geral.')
      if (!respostaTipos.ok) throw new Error(payloadTipos.erro || 'Erro ao carregar os tipos de lançamento.')
      mapeamentos = payloadMapeamentos.mapeamentos || []
      tiposLancamento = payloadTipos.tipos || []
      regrasTipo = payloadTipos.regras || []
    }

    setDados({ ...payload, mapeamentos, tiposLancamento, regrasTipo })
  }

  const carregarTiposRelatorio = async () => {
    const response = await fetch(`${API_BASE}/relatorio-periodo/tipos`)
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload.ok) throw new Error(payload.erro || 'Erro ao carregar a configuração do Relatório do Período.')
    setTiposRelatorio((payload.tipos || []).map((tipo: any) => ({
      ...tipo,
      setor: String(tipo.setor_relatorio_periodo || '')
    })))
  }

  useEffect(() => { carregar().catch((e) => setErro(e.message)) }, [podeMapeamentos])

  const novo = () => {
    if (aba === 'mapeamentos') {
      setForm(dados.mapeamentos?.[0] ? { ...dados.mapeamentos[0], ativo: Boolean(Number(dados.mapeamentos[0].ativo)) } : { ativo: true })
      return
    }
    if (aba === 'tipos_lancamento') {
      setForm({ ativo: true, natureza: 'OUTROS', ordem_relatorio: 100, considera_resumo_dia: true, considera_relatorio_periodo: true })
      setRegraForm({ prioridade: 100, ativo: true })
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
    } else if (novaAba === 'relatorio_periodo') {
      setForm({ ativo: true })
      carregarTiposRelatorio().catch((e) => setErro(e.message))
    } else if (novaAba === 'tipos_lancamento') {
      const primeiro = dados.tiposLancamento?.[0]
      setForm(primeiro ? { ...primeiro, ativo: Boolean(Number(primeiro.ativo)), considera_resumo_dia: Boolean(Number(primeiro.considera_resumo_dia)), considera_relatorio_periodo: Boolean(Number(primeiro.considera_relatorio_periodo)) } : { ativo: true, natureza: 'OUTROS', ordem_relatorio: 100, considera_resumo_dia: true, considera_relatorio_periodo: true })
      setRegraForm({ prioridade: 100, ativo: true })
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
      } else if (aba === 'tipos_lancamento') {
        const editandoTipo = form.id !== undefined && form.id !== null
        url = `${API_BASE}/tipos-lancamento${editandoTipo ? `/${form.id}` : ''}`
        method = editandoTipo ? 'PUT' : 'POST'
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

      setMensagem(aba === 'mapeamentos' ? (payload.mensagem || 'Mapeamento atualizado com sucesso.') : aba === 'tipos_lancamento' ? (payload.mensagem || 'Tipo de lançamento atualizado com sucesso.') : 'Cadastro salvo com sucesso.')
      await carregar()
      if (aba === 'mapeamentos') {
        setDados((atual: any) => atual)
      } else if (aba === 'tipos_lancamento') {
        setForm({ ativo: true, natureza: 'OUTROS', ordem_relatorio: 100, considera_resumo_dia: true, considera_relatorio_periodo: true })
        setRegraForm({ prioridade: 100, ativo: true })
      } else {
        novo()
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  const definirSetorRelatorio = (id: number, setor: string) => {
    setTiposRelatorio((atuais) => atuais.map((tipo) =>
      Number(tipo.id) === Number(id) ? { ...tipo, setor } : tipo
    ))
  }

  const salvarConfiguracaoRelatorio = async () => {
    setSalvandoRelatorio(true)
    setErro('')
    setMensagem('')
    try {
      const response = await fetch(`${API_BASE}/relatorio-periodo/tipos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipos: tiposRelatorio.map((tipo) => ({
            id: Number(tipo.id),
            setor: String(tipo.setor || '')
          }))
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.ok) throw new Error(payload.erro || 'Erro ao salvar a configuração do Relatório do Período.')
      setMensagem(payload.mensagem || 'Configuração do Relatório do Período salva com sucesso.')
      await carregarTiposRelatorio()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar a configuração do Relatório do Período.')
    } finally {
      setSalvandoRelatorio(false)
    }
  }

  const lista = aba === 'empresas'
    ? dados.empresas
    : aba === 'contas'
      ? dados.contas
      : aba === 'produtos'
        ? dados.produtos
        : aba === 'mapeamentos'
          ? dados.mapeamentos
          : dados.tiposLancamento

  const contasDaEmpresa = useMemo(
    () => (dados.contas || []).filter((conta: any) => Number(conta.empresa_id) === Number(form.empresa_id)),
    [dados.contas, form.empresa_id]
  )

  const selecionar = (item: any) => {
    setForm({ ...item, ativo: Boolean(Number(item.ativo)), considera_resumo_dia: Boolean(Number(item.considera_resumo_dia)), considera_relatorio_periodo: Boolean(Number(item.considera_relatorio_periodo)) })
    if (aba === 'tipos_lancamento') setRegraForm({ tipo_lancamento_id: Number(item.id), prioridade: 100, ativo: true })
    setErro('')
    setMensagem('')
  }

  const editarRegra = (regra: any) => {
    const tipo = (dados.tiposLancamento || []).find((item: any) => Number(item.id) === Number(regra.tipo_lancamento_id))
    if (tipo) {
      setForm({
        ...tipo,
        ativo: Boolean(Number(tipo.ativo)),
        considera_resumo_dia: Boolean(Number(tipo.considera_resumo_dia)),
        considera_relatorio_periodo: Boolean(Number(tipo.considera_relatorio_periodo)),
      })
    }
    setRegraForm({ ...regra, ativo: Boolean(Number(regra.ativo)) })
    setErro('')
    setMensagem('')
  }

  const salvarRegra = async (event: FormEvent) => {
    event.preventDefault()
    if (form.id === undefined || form.id === null) return
    setSalvandoRegra(true); setErro(''); setMensagem('')
    try {
      const editando = Boolean(regraForm.id)
      const response = await fetch(`${API_BASE}/tipos-lancamento/regras${editando ? `/${regraForm.id}` : ''}`, {
        method: editando ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...regraForm, tipo_lancamento_id: Number(form.id) }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.erro || 'Erro ao salvar a regra.')
      setMensagem('Regra de classificação salva com sucesso.')
      setRegraForm({ tipo_lancamento_id: Number(form.id), prioridade: 100, ativo: true })
      await carregar()
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao salvar a regra.') }
    finally { setSalvandoRegra(false) }
  }


  const excluirRegra = async (regraId: number) => {
    if (!window.confirm('Excluir esta regra de classificação?')) return
    setErro(''); setMensagem('')
    try {
      const response = await fetch(`${API_BASE}/tipos-lancamento/regras/${regraId}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.erro || 'Erro ao excluir a regra.')
      setMensagem(payload.mensagem || 'Regra excluída com sucesso.')
      setRegraForm({ tipo_lancamento_id: Number(form.id), prioridade: 100, ativo: true })
      await carregar()
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao excluir a regra.') }
  }

  return <section className="settings-page">
    <header className="settings-header">
      <div>
        <span>Administração</span>
        <h1>Cadastros diversos</h1>
        <p>Gerencie empresas, contas financeiras, produtos e os mapeamentos do Financeiro Geral.</p>
      </div>
      {aba !== 'mapeamentos' && aba !== 'relatorio_periodo' && <button className="settings-btn settings-btn-secondary" onClick={novo}>{aba === 'tipos_lancamento' ? 'Novo tipo' : 'Novo cadastro'}</button>}
    </header>

    {erro && <div className="settings-alert settings-alert-error">{erro}</div>}
    {mensagem && <div className="settings-alert settings-alert-success">{mensagem}</div>}

    <div className="settings-tabs">
      <button className={aba === 'empresas' ? 'active' : ''} onClick={() => abrirAba('empresas')}>Empresas</button>
      <button className={aba === 'contas' ? 'active' : ''} onClick={() => abrirAba('contas')}>Contas financeiras</button>
      <button className={aba === 'produtos' ? 'active' : ''} onClick={() => abrirAba('produtos')}>Produtos</button>
      {podeMapeamentos && <button className={aba === 'mapeamentos' ? 'active' : ''} onClick={() => abrirAba('mapeamentos')}>Mapeamentos Financeiro Geral</button>}
      {podeMapeamentos && <button className={aba === 'tipos_lancamento' ? 'active' : ''} onClick={() => abrirAba('tipos_lancamento')}>Tipos de lançamento (T)</button>}
      {podeConfigRelatorio && <button className={aba === 'relatorio_periodo' ? 'active' : ''} onClick={() => abrirAba('relatorio_periodo')}>Relatório do Período</button>}
    </div>

    {aba === 'relatorio_periodo' ? (
      <div className="admin-tool-page">
        <section className="admin-tool-hero">
          <h1>Configuração do Relatório do Período</h1>
          <p>Defina em qual setor cada Tipo de Lançamento (T) será computado. Tipos sem setor não serão listados nem somados.</p>
        </section>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:12}}>
          {[
            { setor:'RESULTADO_PRODUTOS', titulo:'Receitas / Resultado Líquido dos Produtos', ajuda:'Tipos usados para compor o resultado líquido dos produtos.' },
            { setor:'OUTRAS_RECEITAS', titulo:'Outras Receitas', ajuda:'Tipos listados e somados como outras receitas do período.' },
            { setor:'DESPESAS', titulo:'Despesas pagas no período', ajuda:'Tipos listados e somados como despesas do período.' },
          ].map((grupo) => (
            <section className="admin-tool-card" key={grupo.setor}>
              <h2 style={{marginTop:0}}>{grupo.titulo}</h2>
              <p style={{color:'#64748B'}}>{grupo.ajuda}</p>
              <div style={{display:'grid',gap:6}}>
                {tiposRelatorio.map((tipo:any) => (
                  <label
                    key={`${grupo.setor}-${tipo.id}`}
                    style={{display:'flex',gap:8,alignItems:'center',padding:'7px 8px',border:'1px solid #E2E8F0',borderRadius:7,cursor:'pointer'}}
                  >
                    <input
                      type="checkbox"
                      checked={tipo.setor === grupo.setor}
                      onChange={() => definirSetorRelatorio(Number(tipo.id), tipo.setor === grupo.setor ? '' : grupo.setor)}
                    />
                    <span><strong>T{tipo.id}</strong> — {tipo.nome} <small style={{color:'#64748B'}}>({tipo.codigo})</small></span>
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>

        <section className="admin-tool-card" style={{marginTop:12}}>
          <h2 style={{marginTop:0}}>Não computar no Relatório do Período</h2>
          <p>Estes tipos ficam fora das listas e de todas as somas:</p>
          <div>
            {tiposRelatorio.filter((tipo:any) => !tipo.setor).length
              ? tiposRelatorio.filter((tipo:any) => !tipo.setor).map((tipo:any) => (
                  <span key={tipo.id} style={{display:'inline-block',margin:'3px 6px 3px 0',padding:'5px 8px',background:'#F1F5F9',borderRadius:6}}>
                    T{tipo.id} — {tipo.nome}
                  </span>
                ))
              : 'Nenhum tipo.'}
          </div>
        </section>

        <div style={{display:'flex',justifyContent:'flex-end',marginTop:12}}>
          <button className="admin-primary-button" type="button" onClick={salvarConfiguracaoRelatorio} disabled={salvandoRelatorio}>
            {salvandoRelatorio ? 'Salvando...' : 'Salvar configuração'}
          </button>
        </div>
      </div>
    ) : (
      <div className="settings-grid">
        <article className="settings-card">
        <div className="cadastros-form-header">
          <div>
            <h2>{aba === 'mapeamentos' ? (form.id ? 'Editar mapeamento' : 'Selecione um mapeamento') : aba === 'tipos_lancamento' ? (form.id !== undefined && form.id !== null ? 'Editar tipo de lançamento' : 'Novo tipo de lançamento') : (form.id ? 'Editar cadastro' : 'Novo cadastro')}</h2>
            {aba === 'mapeamentos' && <p>O campo destino e o tipo são estruturais e permanecem protegidos. Você pode alterar o título, o vínculo e a situação do mapeamento.</p>}
            {aba === 'tipos_lancamento' && <p>Defina se o T entra no Resumo do Dia e no Relatório do Período. As regras por texto reaplicam o T ao recriar os lançamentos.</p>}
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

          {aba === 'tipos_lancamento' && <>
            {form.id !== undefined && form.id !== null && <label><span>T</span><input value={form.id} disabled /></label>}
            <label><span>Código</span><input required value={form.codigo || ''} onChange={e => setForm({ ...form, codigo: e.target.value.toUpperCase() })} placeholder="Ex.: TRANSFERENCIA;TED ENVIADA;PIX ENVIADO" /></label>
            <label className="settings-field-full"><span>Nome do tipo</span><input required value={form.nome || ''} onChange={e => setForm({ ...form, nome: e.target.value })} /></label>
            <label><span>Natureza</span><select value={form.natureza || 'OUTROS'} onChange={e => setForm({ ...form, natureza: e.target.value })}><option value="SALDO">Saldo</option><option value="RECEITA">Receita</option><option value="DESPESA">Despesa</option><option value="CUSTO">Custo</option><option value="TRANSFERENCIA">Transferência</option><option value="AJUSTE">Ajuste</option><option value="OUTROS">Outros</option></select></label>
            <label><span>Ordem no relatório</span><input type="number" min="0" value={form.ordem_relatorio ?? 100} onChange={e => setForm({ ...form, ordem_relatorio: Number(e.target.value) })} /></label>
            <label className="cadastros-active-checkbox settings-field-full"><input type="checkbox" checked={Boolean(form.considera_resumo_dia)} onChange={e => setForm({ ...form, considera_resumo_dia: e.target.checked })} /><span>Considerar no Resumo do Dia</span></label>
            <label className="cadastros-active-checkbox settings-field-full"><input type="checkbox" checked={Boolean(form.considera_relatorio_periodo)} onChange={e => setForm({ ...form, considera_relatorio_periodo: e.target.checked })} /><span>Considerar no Relatório do Período</span></label>
          </>}

          <div className="settings-actions">
            <button className="settings-btn settings-btn-primary" type="submit" disabled={salvando || (aba === 'mapeamentos' && !form.id)}>{salvando ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </form>
      </article>

      <article className="settings-card">
        <div className="settings-card-title"><div><h2>{aba === 'mapeamentos' ? 'Mapeamentos existentes' : aba === 'tipos_lancamento' ? 'Tipos de lançamento' : 'Cadastros existentes'}</h2><p>{lista?.length || 0} registro(s).</p></div></div>
        <div className="settings-users-list">{lista?.map((item: any) => <button type="button" className="settings-user-row" key={item.id} onClick={() => selecionar(item)}>
          <div>
            <strong>{aba === 'mapeamentos' ? item.descricao : aba === 'tipos_lancamento' ? `T ${item.id} — ${item.nome}` : (item.nome || item.nome_conta)}</strong>
            <span>{aba === 'contas'
              ? `${item.empresa} • ${item.tipo}`
              : aba === 'produtos'
                ? `${item.tipo} • ${item.unidade}`
                : aba === 'mapeamentos'
                  ? `${item.campo_destino} • ${item.tipo}${item.conta_financeira ? ` • ${item.conta_financeira}` : item.produto ? ` • ${item.produto}` : ''}`
                  : aba === 'tipos_lancamento'
                    ? `${item.codigo} • ${item.natureza} • ${Number(item.quantidade_lancamentos || 0)} lançamento(s) • Resumo: ${Number(item.considera_resumo_dia) ? 'Sim' : 'Não'} • Período: ${Number(item.considera_relatorio_periodo) ? 'Sim' : 'Não'}`
                    : item.cnpj || 'Sem CNPJ'}</span>
          </div>
          <span>{Number(item.ativo) ? 'Ativo' : 'Inativo'}</span>
        </button>)}</div>
      </article>

      {aba === 'tipos_lancamento' && <article className="settings-card settings-field-full">
        <div className="settings-card-title"><div><h2>Regras cadastradas</h2><p>{(dados.regrasTipo || []).length} regra(s) cadastrada(s) em regras_tipo_lancamento. Clique em uma regra para editar.</p></div></div>
        <div className="settings-users-list">{(dados.regrasTipo || []).map((r: any) => <div className="settings-user-row" key={`regra-geral-${r.id}`}>
          <button type="button" style={{flex:1,textAlign:'left',background:'transparent',border:0}} onClick={() => editarRegra(r)}>
            <div><strong>{r.texto_procurado}</strong><span>T {r.tipo_lancamento_id} — {r.tipo_nome || r.tipo_codigo || 'Tipo não encontrado'}{r.texto_excluir ? ` • Exceto: ${r.texto_excluir}` : ''} • Prioridade ${r.prioridade}</span></div>
          </button>
          <span>{Number(r.ativo) ? 'Ativa' : 'Inativa'}</span>
          <button type="button" className="settings-btn settings-btn-secondary" onClick={() => excluirRegra(Number(r.id))}>Excluir</button>
        </div>)}</div>
      </article>}

      {aba === 'tipos_lancamento' && form.id !== undefined && form.id !== null && <article className="settings-card settings-field-full">
        <div className="settings-card-title"><div><h2>Regras para preencher a coluna T</h2><p>Quando a descrição contiver qualquer expressão do texto procurado, o lançamento receberá T {form.id}. Separe alternativas por ponto e vírgula (;). O campo “não pode conter” também aceita várias expressões separadas por ;.</p></div></div>
        <form className="settings-form" onSubmit={salvarRegra}>
          <label><span>Texto procurado</span><input required value={regraForm.texto_procurado || ''} onChange={e => setRegraForm({ ...regraForm, texto_procurado: e.target.value })} placeholder="Ex.: TRANSFERENCIA;TED ENVIADA;PIX ENVIADO" /></label>
          <label><span>Não pode conter</span><input value={regraForm.texto_excluir || ''} onChange={e => setRegraForm({ ...regraForm, texto_excluir: e.target.value })} placeholder="Ex.: TARIFA;ESTORNO" /></label>
          <label><span>Prioridade</span><input type="number" min="0" value={regraForm.prioridade ?? 100} onChange={e => setRegraForm({ ...regraForm, prioridade: Number(e.target.value) })} /></label>
          <label className="cadastros-active-checkbox"><input type="checkbox" checked={regraForm.ativo !== false} onChange={e => setRegraForm({ ...regraForm, ativo: e.target.checked })} /><span>Regra ativa</span></label>
          <div className="settings-actions"><button className="settings-btn settings-btn-primary" type="submit" disabled={salvandoRegra}>{salvandoRegra ? 'Salvando...' : regraForm.id ? 'Atualizar regra' : 'Adicionar regra'}</button>{regraForm.id && <button className="settings-btn settings-btn-secondary" type="button" onClick={() => setRegraForm({ tipo_lancamento_id: Number(form.id), prioridade: 100, ativo: true })}>Nova regra</button>}</div>
        </form>
        <div className="settings-users-list">{(dados.regrasTipo || []).filter((r: any) => Number(r.tipo_lancamento_id) === Number(form.id)).map((r: any) => <div className="settings-user-row" key={r.id}><button type="button" style={{flex:1,textAlign:'left',background:'transparent',border:0}} onClick={() => editarRegra(r)}><div><strong>{r.texto_procurado}</strong><span>{r.texto_excluir ? `Exceto: ${r.texto_excluir} • ` : ''}Prioridade ${r.prioridade}</span></div></button><span>{Number(r.ativo) ? 'Ativa' : 'Inativa'}</span><button type="button" className="settings-btn settings-btn-secondary" onClick={() => excluirRegra(Number(r.id))}>Excluir</button></div>)}</div>
      </article>}
      </div>
    )}
  </section>
}
