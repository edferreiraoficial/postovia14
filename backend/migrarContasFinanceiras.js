import { db } from './db.js'

const CAMPOS_CONTAS_FINANCEIRO = Array.from({ length: 30 }, (_, i) => `conta${String(i + 1).padStart(2, '0')}`)
const CAMPOS_RESERVADOS_FIXOS = new Set(['conta01', 'conta02', 'conta03', 'conta11', 'conta12', 'conta13', 'conta21', 'conta23', 'conta24'])
const ALIASES_CONTAS_FINANCEIRO = [
  { campo: 'conta03', termos: ['SPOT LUCILA', 'LUCILA'] },
  { campo: 'conta02', termos: ['ITAU', 'ITAÚ'] },
  { campo: 'conta11', termos: ['CAIXA'] },
  { campo: 'conta12', termos: ['CARTAO', 'CARTÃO'] },
  { campo: 'conta21', termos: ['ERALDO'] },
  { campo: 'conta23', termos: ['EMPRESTIMO', 'EMPRÉSTIMO'] },
  { campo: 'conta24', termos: ['FORNECEDOR'] },
  { campo: 'conta01', termos: ['SPOT'] },
]

function normalizarNomeFinanceiro(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
}

function campoPreferidoConta(conta) {
  const texto = normalizarNomeFinanceiro([conta.nome_conta, conta.instituicao, conta.tipo].filter(Boolean).join(' '))
  return ALIASES_CONTAS_FINANCEIRO.find((item) => item.termos.some((termo) => texto.includes(normalizarNomeFinanceiro(termo))))?.campo || null
}

async function garantirTabelaMapeamentos(conn) {
  if (await tabelaExiste(conn, 'financeiro_geral_mapeamentos')) return true

  await executarEtapa(conn, 'criar financeiro_geral_mapeamentos', () => conn.query(`
    CREATE TABLE IF NOT EXISTS financeiro_geral_mapeamentos (
      id INT NOT NULL AUTO_INCREMENT,
      empresa_id INT NOT NULL,
      tipo VARCHAR(20) NOT NULL DEFAULT 'CONTA',
      conta_financeira_id INT NULL,
      campo_destino VARCHAR(40) NOT NULL,
      ativo TINYINT(1) NOT NULL DEFAULT 1,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_fg_map_empresa_conta (empresa_id, tipo, conta_financeira_id),
      UNIQUE KEY uk_empresa_campo (empresa_id, campo_destino),
      KEY idx_fg_map_conta (conta_financeira_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `))
  return await tabelaExiste(conn, 'financeiro_geral_mapeamentos')
}

export async function garantirMapeamentosContasFinanceiras(conn, empresaId) {
  if (!(await garantirTabelaMapeamentos(conn))) return

  const [contas] = await conn.query(
    `SELECT id, nome_conta, instituicao, tipo
       FROM contas_bancarias
      WHERE empresa_id = ? AND ativo = 1
      ORDER BY criado_em ASC, id ASC`,
    [empresaId]
  )

  const [existentes] = await conn.query(
    `SELECT id, conta_financeira_id, campo_destino, ativo
       FROM financeiro_geral_mapeamentos
      WHERE empresa_id = ? AND tipo = 'CONTA'
      ORDER BY id ASC`,
    [empresaId]
  )

  const mapeamentoPorConta = new Map()
  const mapeamentoPorCampo = new Map()
  for (const item of existentes) {
    if (item.conta_financeira_id != null) mapeamentoPorConta.set(Number(item.conta_financeira_id), item)
    const campo = String(item.campo_destino || '')
    if (campo && !mapeamentoPorCampo.has(campo)) mapeamentoPorCampo.set(campo, item)
  }

  // Cada campo físico do Financeiro Geral possui apenas UM registro de mapeamento
  // no banco (há instalações com a constraint uk_empresa_campo). Quando duas contas
  // representam a mesma coluna estrutural, somente uma delas fica mapeada fisicamente;
  // as demais são reconhecidas pelo nome durante a consolidação e usam a mesma coluna.
  // Isso evita ER_DUP_ENTRY e também impede cabeçalhos duplicados.
  for (const conta of contas) {
    const contaId = Number(conta.id)
    const preferido = campoPreferidoConta(conta)
    if (!preferido) continue

    const atual = mapeamentoPorConta.get(contaId)
    const donoPreferido = mapeamentoPorCampo.get(preferido)

    if (donoPreferido && Number(donoPreferido.conta_financeira_id) !== contaId) {
      // Já existe uma conta canônica ocupando o campo estrutural. Se esta conta
      // equivalente ganhou uma contaXX dinâmica em versão anterior, remove apenas
      // o mapeamento incorreto. A conta e seus lançamentos NÃO são excluídos.
      if (atual && String(atual.campo_destino) !== preferido) {
        await conn.query(`DELETE FROM financeiro_geral_mapeamentos WHERE id = ?`, [atual.id])
        mapeamentoPorConta.delete(contaId)
        mapeamentoPorCampo.delete(String(atual.campo_destino))
      }
      continue
    }

    if (atual) {
      if (String(atual.campo_destino) !== preferido || Number(atual.ativo) !== 1) {
        await conn.query(
          `UPDATE financeiro_geral_mapeamentos
              SET campo_destino = ?, ativo = 1
            WHERE id = ?`,
          [preferido, atual.id]
        )
        mapeamentoPorCampo.delete(String(atual.campo_destino))
        atual.campo_destino = preferido
        atual.ativo = 1
        mapeamentoPorCampo.set(preferido, atual)
      }
    } else {
      const [resultado] = await conn.query(
        `INSERT INTO financeiro_geral_mapeamentos (empresa_id, tipo, conta_financeira_id, campo_destino, ativo)
         VALUES (?, 'CONTA', ?, ?, 1)`,
        [empresaId, contaId, preferido]
      )
      const criado = { id: resultado.insertId, conta_financeira_id: contaId, campo_destino: preferido, ativo: 1 }
      mapeamentoPorConta.set(contaId, criado)
      mapeamentoPorCampo.set(preferido, criado)
    }
  }

  // Recarrega os campos efetivamente ocupados depois da limpeza acima.
  const [aposEstruturais] = await conn.query(
    `SELECT id, conta_financeira_id, campo_destino, ativo
       FROM financeiro_geral_mapeamentos
      WHERE empresa_id = ? AND tipo = 'CONTA'`,
    [empresaId]
  )
  mapeamentoPorConta.clear()
  const camposOcupados = new Set(['conta13'])
  for (const item of aposEstruturais) {
    if (item.conta_financeira_id != null) mapeamentoPorConta.set(Number(item.conta_financeira_id), item)
    if (Number(item.ativo) === 1 && item.campo_destino) camposOcupados.add(String(item.campo_destino))
  }

  // Somente contas realmente novas, sem equivalência estrutural, recebem contaXX.
  for (const conta of contas) {
    const contaId = Number(conta.id)
    if (campoPreferidoConta(conta)) continue

    const atual = mapeamentoPorConta.get(contaId)
    if (atual) {
      if (Number(atual.ativo) !== 1) {
        await conn.query(`UPDATE financeiro_geral_mapeamentos SET ativo = 1 WHERE id = ?`, [atual.id])
      }
      continue
    }

    const campo = CAMPOS_CONTAS_FINANCEIRO.find(
      (item) => !camposOcupados.has(item) && !CAMPOS_RESERVADOS_FIXOS.has(item)
    ) || null
    if (!campo) throw new Error('Não há mais colunas livres no Financeiro Geral para vincular novas contas.')

    const [resultado] = await conn.query(
      `INSERT INTO financeiro_geral_mapeamentos (empresa_id, tipo, conta_financeira_id, campo_destino, ativo)
       VALUES (?, 'CONTA', ?, ?, 1)`,
      [empresaId, contaId, campo]
    )
    mapeamentoPorConta.set(contaId, { id: resultado.insertId, conta_financeira_id: contaId, campo_destino: campo, ativo: 1 })
    camposOcupados.add(campo)
  }
}


async function colunaExiste(conn, tabela, coluna) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS total FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tabela, coluna]
  )
  return Number(rows[0]?.total || 0) > 0
}

async function tabelaExiste(conn, tabela) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS total FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tabela]
  )
  return Number(rows[0]?.total || 0) > 0
}

async function executarEtapa(conn, descricao, fn) {
  try {
    await fn()
  } catch (error) {
    // A migração não pode impedir o servidor de iniciar. Em hospedagens com
    // permissões limitadas, registra o ponto pendente e mantém a aplicação online.
    console.warn(`[migração contas financeiras] ${descricao}:`, error.message)
  }
}

export async function migrarContasFinanceiras() {
  const conn = await db.getConnection()
  try {
    if (await tabelaExiste(conn, 'empresas')) {
      if (!(await colunaExiste(conn, 'empresas', 'cnpj'))) {
        await executarEtapa(conn, 'adicionar empresas.cnpj', () => conn.query(`ALTER TABLE empresas ADD COLUMN cnpj VARCHAR(20) NULL AFTER nome`))
      }
      if (!(await colunaExiste(conn, 'empresas', 'ativo'))) {
        await executarEtapa(conn, 'adicionar empresas.ativo', () => conn.query(`ALTER TABLE empresas ADD COLUMN ativo TINYINT(1) NOT NULL DEFAULT 1`))
      }
      if (!(await colunaExiste(conn, 'empresas', 'atualizado_em'))) {
        await executarEtapa(conn, 'adicionar empresas.atualizado_em', () => conn.query(`ALTER TABLE empresas ADD COLUMN atualizado_em TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`))
      }
    }

    if (await tabelaExiste(conn, 'produtos')) {
      if (!(await colunaExiste(conn, 'produtos', 'ativo'))) {
        await executarEtapa(conn, 'adicionar produtos.ativo', () => conn.query(`ALTER TABLE produtos ADD COLUMN ativo TINYINT(1) NOT NULL DEFAULT 1`))
      }
      if (!(await colunaExiste(conn, 'produtos', 'atualizado_em'))) {
        await executarEtapa(conn, 'adicionar produtos.atualizado_em', () => conn.query(`ALTER TABLE produtos ADD COLUMN atualizado_em TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`))
      }
    }

    if (await tabelaExiste(conn, 'permissoes') && !(await colunaExiste(conn, 'permissoes', 'cadastros'))) {
      await executarEtapa(conn, 'adicionar permissoes.cadastros', async () => {
        await conn.query(`ALTER TABLE permissoes ADD COLUMN cadastros TINYINT(1) NOT NULL DEFAULT 0 AFTER auditoria`)
        await conn.query(`UPDATE permissoes p INNER JOIN usuarios u ON u.id=p.usuario_id SET p.cadastros=1 WHERE UPPER(u.perfil)='ADMIN'`)
      })
    }

    if (!(await tabelaExiste(conn, 'contas_bancarias'))) return

    const adicoes = [
      ['instituicao', "VARCHAR(120) NULL AFTER empresa_id"],
      ['tipo', "VARCHAR(20) NOT NULL DEFAULT 'BANCARIA' AFTER instituicao"],
      ['agencia', 'VARCHAR(30) NULL AFTER nome_conta'],
      ['numero_conta', 'VARCHAR(40) NULL AFTER agencia'],
      ['observacoes', 'VARCHAR(255) NULL AFTER numero_conta'],
      ['ativo', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER observacoes'],
    ]
    for (const [coluna, definicao] of adicoes) {
      if (!(await colunaExiste(conn, 'contas_bancarias', coluna))) {
        await executarEtapa(conn, `adicionar contas_bancarias.${coluna}`, () =>
          conn.query(`ALTER TABLE contas_bancarias ADD COLUMN ${coluna} ${definicao}`)
        )
      }
    }

    // Mantém bancos/banco_id apenas como compatibilidade interna. Eles deixam de
    // aparecer e de ser administrados na interface, evitando operações destrutivas
    // que anteriormente podiam derrubar o Node com erro 503.
    if (await tabelaExiste(conn, 'bancos') && await colunaExiste(conn, 'contas_bancarias', 'banco_id') && await colunaExiste(conn, 'contas_bancarias', 'instituicao')) {
      await executarEtapa(conn, 'copiar nomes dos bancos para a conta financeira', () =>
        conn.query(`UPDATE contas_bancarias cb
                    LEFT JOIN bancos b ON b.id = cb.banco_id
                    SET cb.instituicao = COALESCE(NULLIF(cb.instituicao, ''), b.nome, cb.nome_conta)`)
      )
    }

    if (await colunaExiste(conn, 'contas_bancarias', 'instituicao')) {
      await executarEtapa(conn, 'normalizar contas financeiras', () =>
        conn.query(`UPDATE contas_bancarias
                    SET instituicao = COALESCE(NULLIF(instituicao, ''), nome_conta),
                        tipo = COALESCE(NULLIF(tipo, ''), 'BANCARIA'),
                        ativo = COALESCE(ativo, 1)`)
      )
    }


    const [empresasContas] = await conn.query(`SELECT DISTINCT empresa_id FROM contas_bancarias WHERE ativo = 1`)
    for (const item of empresasContas) await garantirMapeamentosContasFinanceiras(conn, Number(item.empresa_id))
  } finally {
    conn.release()
  }
}
