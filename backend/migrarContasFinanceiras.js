import { db } from './db.js'

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
  } finally {
    conn.release()
  }
}
