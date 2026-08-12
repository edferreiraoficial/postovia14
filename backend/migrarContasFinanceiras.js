import { db } from './db.js'

const CAMPOS_CONTAS_FINANCEIRO = Array.from({ length: 30 }, (_, i) => `conta${String(i + 1).padStart(2, '0')}`)
const CAMPOS_ESTRUTURAIS_RESERVADOS = new Set(['conta01', 'conta02', 'conta03', 'conta11', 'conta12', 'conta13', 'conta21', 'conta23', 'conta24'])
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

function campoEstruturalPorNome(conta) {
  const texto = normalizarNomeFinanceiro([conta.nome_conta, conta.instituicao, conta.tipo].filter(Boolean).join(' '))
  return ALIASES_CONTAS_FINANCEIRO.find((item) => item.termos.some((termo) => texto.includes(normalizarNomeFinanceiro(termo))))?.campo || null
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
    console.warn(`[migração contas financeiras] ${descricao}:`, error.message)
  }
}

async function garantirTabelaMapeamentos(conn) {
  if (await tabelaExiste(conn, 'financeiro_geral_mapeamentos')) return true
  await executarEtapa(conn, 'criar financeiro_geral_mapeamentos', () => conn.query(`
    CREATE TABLE IF NOT EXISTS financeiro_geral_mapeamentos (
      id INT NOT NULL AUTO_INCREMENT,
      empresa_id INT NOT NULL,
      tipo VARCHAR(20) NOT NULL DEFAULT 'CONTA',
      campo_destino VARCHAR(40) NOT NULL,
      conta_financeira_id INT NULL,
      produto_id INT NULL,
      descricao VARCHAR(150) NULL,
      ativo TINYINT(1) NOT NULL DEFAULT 1,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_empresa_campo (empresa_id, campo_destino),
      KEY idx_fg_map_conta (conta_financeira_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `))
  return await tabelaExiste(conn, 'financeiro_geral_mapeamentos')
}

export async function garantirMapeamentosContasFinanceiras(conn, empresaId) {
  if (!(await garantirTabelaMapeamentos(conn))) return

  const [mapeamentos] = await conn.query(
    `SELECT id, campo_destino, conta_financeira_id, descricao, ativo
       FROM financeiro_geral_mapeamentos
      WHERE empresa_id = ? AND tipo = 'CONTA'
      ORDER BY id ASC`,
    [empresaId]
  )
  const [contas] = await conn.query(
    `SELECT id, nome_conta, instituicao, tipo, ativo
       FROM contas_bancarias
      WHERE empresa_id = ? AND ativo = 1
      ORDER BY id ASC`,
    [empresaId]
  )

  const camposOcupados = new Set(mapeamentos.map((item) => String(item.campo_destino || '')).filter(Boolean))
  const contaJaMapeada = new Map(
    mapeamentos
      .filter((item) => item.conta_financeira_id != null)
      .map((item) => [Number(item.conta_financeira_id), item])
  )

  // Primeiro reaproveita mapeamentos estruturais já existentes cujo texto coincide
  // exatamente com o nome da conta. Isso corrige, por exemplo, ADEN -> conta04 sem
  // criar outra coluna e sem alterar a estrutura oficial existente.
  for (const item of mapeamentos) {
    if (item.conta_financeira_id != null) continue
    const descricao = normalizarNomeFinanceiro(item.descricao)
    if (!descricao) continue
    const correspondentes = contas.filter((conta) => normalizarNomeFinanceiro(conta.nome_conta) === descricao)
    if (correspondentes.length !== 1) continue
    const conta = correspondentes[0]
    if (contaJaMapeada.has(Number(conta.id))) continue
    try {
      await conn.query(
        `UPDATE financeiro_geral_mapeamentos
            SET conta_financeira_id = ?, atualizado_em = NOW()
          WHERE id = ? AND conta_financeira_id IS NULL`,
        [Number(conta.id), Number(item.id)]
      )
      item.conta_financeira_id = Number(conta.id)
      contaJaMapeada.set(Number(conta.id), item)
    } catch (error) {
      // Se houver uma restrição antiga para a conta, preserva o mapeamento visual e
      // deixa a consolidação usar os aliases já existentes.
      console.warn(`[mapeamento financeiro] não foi possível vincular ${conta.nome_conta} a ${item.campo_destino}:`, error.message)
    }
  }

  // Nunca move, remove ou substitui os registros já existentes em
  // financeiro_geral_mapeamentos. Contas estruturais conhecidas usam os campos
  // históricos por alias. Somente uma conta realmente nova recebe um campo livre.
  for (const conta of contas) {
    const contaId = Number(conta.id)
    if (contaJaMapeada.has(contaId)) continue
    if (campoEstruturalPorNome(conta)) continue

    // Se já existir uma coluna visual com a mesma descrição, ela é a coluna correta.
    const descricaoConta = normalizarNomeFinanceiro(conta.nome_conta)
    const mapeamentoMesmoNome = mapeamentos.find((item) => normalizarNomeFinanceiro(item.descricao) === descricaoConta)
    if (mapeamentoMesmoNome) continue

    const campoLivre = CAMPOS_CONTAS_FINANCEIRO.find(
      (campo) => !camposOcupados.has(campo) && !CAMPOS_ESTRUTURAIS_RESERVADOS.has(campo)
    )
    if (!campoLivre) throw new Error('Não há mais colunas livres no Financeiro Geral para vincular novas contas.')

    const [resultado] = await conn.query(
      `INSERT INTO financeiro_geral_mapeamentos
        (empresa_id, tipo, campo_destino, conta_financeira_id, produto_id, descricao, ativo)
       VALUES (?, 'CONTA', ?, ?, NULL, ?, 1)`,
      [empresaId, campoLivre, contaId, String(conta.nome_conta || campoLivre)]
    )
    const criado = {
      id: resultado.insertId,
      campo_destino: campoLivre,
      conta_financeira_id: contaId,
      descricao: String(conta.nome_conta || campoLivre),
      ativo: 1,
    }
    mapeamentos.push(criado)
    contaJaMapeada.set(contaId, criado)
    camposOcupados.add(campoLivre)
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

    // Apenas completa vínculos seguros e cria coluna para conta realmente nova.
    // Nunca apaga, renomeia ou realoca as colunas estruturais já cadastradas.
    const [empresasContas] = await conn.query(`SELECT DISTINCT empresa_id FROM contas_bancarias WHERE ativo = 1`)
    for (const item of empresasContas) {
      await executarEtapa(conn, `garantir mapeamentos da empresa ${item.empresa_id}`, () =>
        garantirMapeamentosContasFinanceiras(conn, Number(item.empresa_id))
      )
    }
  } finally {
    conn.release()
  }
}
