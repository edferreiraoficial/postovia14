import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../store/auth'

const API_BASE = `${import.meta.env.VITE_API_URL || ''}/api`

const PERMISSOES = [
  ['dashboard', 'Dashboard'],
  ['dados_gravados', 'Dados gravados'],
  ['importar_pdf', 'Importar PDF'],
  ['importar_excel', 'Importar Excel'],
  ['pdf_excel', 'PDF para Excel'],
  ['lancamentos', 'Lançamentos financeiros'],
  ['auditoria', 'Auditoria'],
  ['cadastros', 'Cadastros diversos'],
  ['configuracoes', 'Configurações'],
  ['incluir', 'Incluir'],
  ['editar', 'Editar'],
  ['excluir', 'Excluir'],
  ['imprimir', 'Imprimir'],
] as const

type PermissaoKey = typeof PERMISSOES[number][0]
type Permissoes = Record<PermissaoKey, boolean>

type Usuario = {
  id: number
  nome: string
  usuario: string
  email: string | null
  perfil: string
  ativo: number | boolean
  ultimo_login: string | null
  criado_em: string
} & Partial<Record<PermissaoKey, number | boolean | null>>

type FormState = {
  id?: number
  nome: string
  usuario: string
  email: string
  senha: string
  perfil: string
  ativo: boolean
  permissoes: Permissoes
}

const permissoesVazias = (): Permissoes => Object.fromEntries(
  PERMISSOES.map(([campo]) => [campo, false])
) as Permissoes

const novoForm = (): FormState => ({
  nome: '',
  usuario: '',
  email: '',
  senha: '',
  perfil: 'OPERADOR',
  ativo: true,
  permissoes: permissoesVazias(),
})

const formatarData = (valor?: string | null) => {
  if (!valor) return 'Nunca acessou'
  const data = new Date(valor)
  return Number.isNaN(data.getTime()) ? '—' : data.toLocaleString('pt-BR')
}

export default function SettingsAdminPage() {
  const { user } = useAuth()
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [form, setForm] = useState<FormState>(novoForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [senhaId, setSenhaId] = useState<number | null>(null)
  const [novaSenha, setNovaSenha] = useState('')
  const [dataTravaConsolidacao, setDataTravaConsolidacao] = useState('')
  const [salvandoTrava, setSalvandoTrava] = useState(false)

  const editando = Boolean(form.id)
  const podeGerenciar = useMemo(
    () => user?.perfil === 'ADMIN' || Boolean(user?.permissoes?.configuracoes),
    [user]
  )

  const carregar = async () => {
    try {
      setLoading(true)
      const response = await fetch(`${API_BASE}/usuarios`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.erro || 'Erro ao carregar usuários.')
      setUsuarios(payload.usuarios || [])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar usuários.')
    } finally {
      setLoading(false)
    }
  }

  const carregarConfiguracaoFinanceira = async () => {
    try {
      const response = await fetch(`${API_BASE}/configuracoes-financeiro?empresaId=1`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.erro || 'Erro ao carregar a trava financeira.')
      setDataTravaConsolidacao(payload.dataTravaConsolidacao || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar a trava financeira.')
    }
  }

  useEffect(() => {
    if (podeGerenciar) {
      carregar()
      carregarConfiguracaoFinanceira()
    } else setLoading(false)
  }, [podeGerenciar])

  const selecionar = (item: Usuario) => {
    setForm({
      id: item.id,
      nome: item.nome || '',
      usuario: item.usuario || '',
      email: item.email || '',
      senha: '',
      perfil: item.perfil || 'OPERADOR',
      ativo: Boolean(Number(item.ativo)),
      permissoes: Object.fromEntries(
        PERMISSOES.map(([campo]) => [campo, Boolean(Number(item[campo] || 0))])
      ) as Permissoes,
    })
    setMessage('')
    setError('')
  }

  const cancelar = () => {
    setForm(novoForm())
    setSenhaId(null)
    setNovaSenha('')
  }

  const marcarPerfil = (perfil: string) => {
    const admin = perfil === 'ADMIN'
    setForm((atual) => ({
      ...atual,
      perfil,
      permissoes: admin
        ? Object.fromEntries(PERMISSOES.map(([campo]) => [campo, true])) as Permissoes
        : atual.permissoes,
    }))
  }

  const salvar = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')

    try {
      const response = await fetch(
        editando ? `${API_BASE}/usuarios/${form.id}` : `${API_BASE}/usuarios`,
        {
          method: editando ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        }
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.erro || 'Erro ao salvar usuário.')
      setMessage(editando ? 'Usuário atualizado com sucesso.' : 'Usuário cadastrado com sucesso.')
      setForm(novoForm())
      await carregar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar usuário.')
    } finally {
      setSaving(false)
    }
  }

  const alterarSenha = async (event: FormEvent) => {
    event.preventDefault()
    if (!senhaId) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`${API_BASE}/usuarios/${senhaId}/senha`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha: novaSenha }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.erro || 'Erro ao alterar senha.')
      setMessage('Senha alterada com sucesso.')
      setSenhaId(null)
      setNovaSenha('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao alterar senha.')
    } finally {
      setSaving(false)
    }
  }

  const salvarTravaFinanceira = async (event: FormEvent) => {
    event.preventDefault()
    setSalvandoTrava(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`${API_BASE}/configuracoes-financeiro`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresaId: 1, dataTravaConsolidacao }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.erro || 'Erro ao salvar a trava financeira.')
      setMessage(payload.mensagem || 'Configuração financeira salva com sucesso.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar a trava financeira.')
    } finally {
      setSalvandoTrava(false)
    }
  }

  if (!podeGerenciar) {
    return (
      <section className="settings-page">
        <div className="settings-card">
          <h1>Configurações</h1>
          <p>Seu usuário não possui permissão para gerenciar usuários e senhas.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="settings-page">
      <header className="settings-header">
        <div>
          <span>Controle de acesso</span>
          <h1>Usuários e senhas</h1>
          <p>Cadastre usuários, defina perfis, permissões e altere senhas com segurança.</p>
        </div>
        <button type="button" className="settings-btn settings-btn-secondary" onClick={cancelar}>
          Novo usuário
        </button>
      </header>

      {error && <div className="settings-alert settings-alert-error">{error}</div>}
      {message && <div className="settings-alert settings-alert-success">{message}</div>}

      <div className="settings-grid">
        <article className="settings-card">
          <div className="settings-card-title">
            <div>
              <h2>{editando ? 'Editar usuário' : 'Cadastrar usuário'}</h2>
              <p>{editando ? 'Altere os dados e permissões do usuário.' : 'Crie um novo acesso ao painel administrativo.'}</p>
            </div>
            <label className="cadastros-active-checkbox">
              <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
              <span>Cadastro ativo</span>
            </label>
          </div>

          <form className="settings-form" onSubmit={salvar}>
            <div className="settings-form-grid">
              <label>
                <span>Nome</span>
                <input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
              </label>
              <label>
                <span>Usuário</span>
                <input required value={form.usuario} onChange={(e) => setForm({ ...form, usuario: e.target.value })} />
              </label>
              <label>
                <span>E-mail</span>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </label>
              {!editando && (
                <label>
                  <span>Senha inicial</span>
                  <input required minLength={6} type="password" value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} />
                </label>
              )}
              <label>
                <span>Perfil</span>
                <select value={form.perfil} onChange={(e) => marcarPerfil(e.target.value)}>
                  <option value="ADMIN">Administrador</option>
                  <option value="GERENTE">Gerente</option>
                  <option value="OPERADOR">Operador</option>
                  <option value="CONSULTA">Consulta</option>
                </select>
              </label>

            </div>

            <div className="settings-permissions">
              <h3>Permissões</h3>
              <div className="settings-permission-grid">
                {PERMISSOES.map(([campo, label]) => (
                  <label key={campo}>
                    <input
                      type="checkbox"
                      checked={form.permissoes[campo]}
                      disabled={form.perfil === 'ADMIN'}
                      onChange={(e) => setForm({
                        ...form,
                        permissoes: { ...form.permissoes, [campo]: e.target.checked },
                      })}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="settings-actions">
              {editando && <button type="button" className="settings-btn settings-btn-secondary" onClick={cancelar}>Cancelar</button>}
              <button disabled={saving} type="submit" className="settings-btn settings-btn-primary">
                {saving ? 'Salvando...' : editando ? 'Salvar alterações' : 'Cadastrar usuário'}
              </button>
            </div>
          </form>
        </article>

        <article className="settings-card settings-list-card">
          <div className="settings-card-title">
            <div>
              <h2>Usuários cadastrados</h2>
              <p>{usuarios.length} acesso(s) registrado(s).</p>
            </div>
          </div>

          {loading ? <p>Carregando usuários...</p> : (
            <div className="settings-user-list">
              {usuarios.map((item) => (
                <div className="settings-user-item" key={item.id}>
                  <div className="settings-user-main">
                    <div className="settings-avatar">{(item.nome || item.usuario).slice(0, 2).toUpperCase()}</div>
                    <div>
                      <strong>{item.nome}</strong>
                      <span>@{item.usuario} · {item.perfil}</span>
                      <small>Último acesso: {formatarData(item.ultimo_login)}</small>
                    </div>
                  </div>
                  <span className={`settings-status ${Number(item.ativo) ? 'is-active' : 'is-inactive'}`}>
                    {Number(item.ativo) ? 'Ativo' : 'Inativo'}
                  </span>
                  <div className="settings-user-actions">
                    <button type="button" onClick={() => selecionar(item)}>Editar</button>
                    <button type="button" onClick={() => { setSenhaId(item.id); setNovaSenha(''); }}>Alterar senha</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <article className="settings-card settings-finance-lock-card">
        <div className="settings-card-title">
          <div>
            <h2>Trava da consolidação financeira</h2>
            <p>Impede consolidar, recriar ou editar lançamentos com data igual ou anterior à data definida.</p>
          </div>
        </div>
        <form className="settings-finance-lock-form" onSubmit={salvarTravaFinanceira}>
          <label>
            <span>Bloquear alterações até</span>
            <input type="date" value={dataTravaConsolidacao} onChange={(e) => setDataTravaConsolidacao(e.target.value)} />
          </label>
          <button disabled={salvandoTrava} type="submit" className="settings-btn settings-btn-primary">
            {salvandoTrava ? 'Salvando...' : 'Salvar configuração'}
          </button>
          <button type="button" className="settings-btn settings-btn-secondary" onClick={() => setDataTravaConsolidacao('')}>
            Limpar data
          </button>
        </form>
      </article>

      {senhaId && (
        <div className="settings-modal-backdrop" role="presentation" onMouseDown={() => setSenhaId(null)}>
          <form className="settings-modal" onSubmit={alterarSenha} onMouseDown={(e) => e.stopPropagation()}>
            <h2>Alterar senha</h2>
            <p>Digite uma nova senha com pelo menos 6 caracteres.</p>
            <input autoFocus required minLength={6} type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} />
            <div className="settings-actions">
              <button type="button" className="settings-btn settings-btn-secondary" onClick={() => setSenhaId(null)}>Cancelar</button>
              <button disabled={saving} type="submit" className="settings-btn settings-btn-primary">Salvar senha</button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}
