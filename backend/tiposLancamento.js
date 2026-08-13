import { db } from './db.js'

const TIPOS_SISTEMA = [
  { codigo: 'SALDO', nome: 'Saldo', resumo: 0, periodo: 0, termos: ['SALDO'] },
  { codigo: 'SEPARACAO_VENDAS', nome: 'Separação de vendas', resumo: 0, periodo: 0, termos: ['SEPARACAO VENDAS', 'SEPARAÇÃO VENDAS'] },
  { codigo: 'TRANSFERENCIA', nome: 'Transferência entre contas', resumo: 0, periodo: 0, termos: ['TRANSFERENCIA', 'TRANSFERÊNCIA'] },
  { codigo: 'COMPRA', nome: 'Compra de produto', resumo: 0, periodo: 0, termos: ['COMPRA'] },
  { codigo: 'VENDA', nome: 'Venda de produto', resumo: 0, periodo: 0, termos: ['VENDA'] },
  { codigo: 'RESULTADO', nome: 'Resultado líquido de produto', resumo: 1, periodo: 1, termos: ['RESULTADO LIQUIDO', 'RESULTADO LÍQUIDO'] },
  { codigo: 'AJUSTE', nome: 'Ajuste de saldo/estoque', resumo: 1, periodo: 1, termos: ['AJUSTE'] },
  { codigo: 'TAXA_CARTAO', nome: 'Taxa de cartão', resumo: 1, periodo: 1, termos: ['DESCONTO TAXAS CARTAO', 'DESCONTO TAXAS CARTÃO', 'TAXA CARTAO', 'TAXA CARTÃO'] },
]

const normalizar = (valor) => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

async function tabelaExiste(conn, tabela) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tabela]
  )
  return Number(row?.total || 0) > 0
}

async function colunaExiste(conn, tabela, coluna) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tabela, coluna]
  )
  return Number(row?.total || 0) > 0
}

export async function garantirEstruturaTiposLancamento(connExterna = null) {
  const conn = connExterna || await db.getConnection()
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS tipos_lancamento_config (
        id INT NOT NULL AUTO_INCREMENT,
        empresa_id INT NOT NULL DEFAULT 1,
        tipo_lancamento_id INT NOT NULL,
        codigo VARCHAR(60) NULL,
        nome VARCHAR(150) NOT NULL,
        considera_resumo_dia TINYINT(1) NOT NULL DEFAULT 1,
        considera_relatorio_periodo TINYINT(1) NOT NULL DEFAULT 1,
        ativo TINYINT(1) NOT NULL DEFAULT 1,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_tipo_config_empresa_tipo (empresa_id, tipo_lancamento_id),
        UNIQUE KEY uk_tipo_config_empresa_codigo (empresa_id, codigo)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    await conn.query(`
      CREATE TABLE IF NOT EXISTS regras_tipo_lancamento (
        id INT NOT NULL AUTO_INCREMENT,
        tipo_lancamento_id INT NOT NULL,
        texto_procurado VARCHAR(255) NOT NULL,
        texto_excluir VARCHAR(255) NULL,
        prioridade INT NOT NULL DEFAULT 100,
        ativo TINYINT(1) NOT NULL DEFAULT 1,
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_regra_tipo_lancamento (tipo_lancamento_id),
        KEY idx_regra_tipo_prioridade (prioridade, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    // Compatibilidade com instalações onde a tabela de regras já existia com menos campos.
    if (!(await colunaExiste(conn, 'regras_tipo_lancamento', 'texto_excluir'))) {
      await conn.query(`ALTER TABLE regras_tipo_lancamento ADD COLUMN texto_excluir VARCHAR(255) NULL AFTER texto_procurado`)
    }
    if (!(await colunaExiste(conn, 'regras_tipo_lancamento', 'prioridade'))) {
      await conn.query(`ALTER TABLE regras_tipo_lancamento ADD COLUMN prioridade INT NOT NULL DEFAULT 100 AFTER texto_excluir`)
    }
    if (!(await colunaExiste(conn, 'regras_tipo_lancamento', 'ativo'))) {
      await conn.query(`ALTER TABLE regras_tipo_lancamento ADD COLUMN ativo TINYINT(1) NOT NULL DEFAULT 1 AFTER prioridade`)
    }

    const [empresas] = await conn.query(await tabelaExiste(conn, 'empresas') ? `SELECT id FROM empresas ORDER BY id` : `SELECT 1 AS id`)
    for (const empresaRow of empresas.length ? empresas : [{ id: 1 }]) {
      const empresaId = Number(empresaRow.id || 1)
      const [configs] = await conn.query(`SELECT * FROM tipos_lancamento_config WHERE empresa_id = ?`, [empresaId])
      const porCodigo = new Map(configs.filter((x) => x.codigo).map((x) => [normalizar(x.codigo), x]))

      const [idsFinanceiro] = await conn.query(
        await tabelaExiste(conn, 'financeiro_geral')
          ? `SELECT DISTINCT tipo_lancamento_id FROM financeiro_geral WHERE empresa_id=? AND tipo_lancamento_id IS NOT NULL`
          : `SELECT NULL AS tipo_lancamento_id WHERE 1=0`,
        await tabelaExiste(conn, 'financeiro_geral') ? [empresaId] : []
      )
      const [idsRegras] = await conn.query(`SELECT DISTINCT tipo_lancamento_id FROM regras_tipo_lancamento WHERE tipo_lancamento_id IS NOT NULL`)
      let proximoId = Math.max(0, ...configs.map((x) => Number(x.tipo_lancamento_id || 0)), ...idsFinanceiro.map((x) => Number(x.tipo_lancamento_id || 0)), ...idsRegras.map((x) => Number(x.tipo_lancamento_id || 0))) + 1

      for (const padrao of TIPOS_SISTEMA) {
        if (porCodigo.has(normalizar(padrao.codigo))) continue

        let tipoId = null
        if (await tabelaExiste(conn, 'financeiro_geral')) {
          const [candidatos] = await conn.query(
            `SELECT tipo_lancamento_id, COUNT(*) AS qtd
               FROM financeiro_geral
              WHERE empresa_id=? AND tipo_lancamento_id IS NOT NULL AND UPPER(tipo_lancamento)=?
              GROUP BY tipo_lancamento_id ORDER BY qtd DESC LIMIT 1`,
            [empresaId, padrao.codigo]
          )
          if (candidatos[0]) tipoId = Number(candidatos[0].tipo_lancamento_id)
        }
        if (!tipoId) {
          const [regras] = await conn.query(`SELECT tipo_lancamento_id, texto_procurado FROM regras_tipo_lancamento WHERE ativo=1 ORDER BY prioridade,id`)
          const candidata = regras.find((r) => padrao.termos.some((termo) => normalizar(r.texto_procurado).includes(normalizar(termo))))
          if (candidata) tipoId = Number(candidata.tipo_lancamento_id)
        }
        if (!tipoId) tipoId = proximoId++

        // Se o ID já estiver configurado para outro código, não colide: usa um novo ID.
        const [[ocupado]] = await conn.query(`SELECT id FROM tipos_lancamento_config WHERE empresa_id=? AND tipo_lancamento_id=? LIMIT 1`, [empresaId, tipoId])
        if (ocupado) tipoId = proximoId++

        await conn.query(
          `INSERT INTO tipos_lancamento_config
             (empresa_id,tipo_lancamento_id,codigo,nome,considera_resumo_dia,considera_relatorio_periodo,ativo)
           VALUES (?,?,?,?,?,?,1)`,
          [empresaId, tipoId, padrao.codigo, padrao.nome, padrao.resumo, padrao.periodo]
        )
      }

      // Qualquer T já utilizado por regras ou lançamentos passa a aparecer na configuração,
      // sem mudar seu número e com comportamento inclusivo por padrão.
      const idsDescobertos = [...new Set([...idsFinanceiro, ...idsRegras].map((x) => Number(x.tipo_lancamento_id)).filter((x) => x > 0))]
      for (const tipoId of idsDescobertos) {
        const [[existe]] = await conn.query(`SELECT id FROM tipos_lancamento_config WHERE empresa_id=? AND tipo_lancamento_id=? LIMIT 1`, [empresaId, tipoId])
        if (existe) continue
        let nome = `Tipo ${tipoId}`
        if (await tabelaExiste(conn, 'financeiro_geral')) {
          const [[amostra]] = await conn.query(
            `SELECT descricao_original, tipo_lancamento FROM financeiro_geral WHERE empresa_id=? AND tipo_lancamento_id=? ORDER BY id DESC LIMIT 1`,
            [empresaId, tipoId]
          )
          nome = String(amostra?.tipo_lancamento || amostra?.descricao_original || nome).slice(0, 150)
        }
        await conn.query(
          `INSERT IGNORE INTO tipos_lancamento_config (empresa_id,tipo_lancamento_id,codigo,nome,considera_resumo_dia,considera_relatorio_periodo,ativo)
           VALUES (?,?,NULL,?,1,1,1)`,
          [empresaId, tipoId, nome]
        )
      }
    }
  } finally {
    if (!connExterna) conn.release()
  }
}

export async function carregarRegrasTipoLancamento(conn) {
  if (!(await tabelaExiste(conn, 'regras_tipo_lancamento'))) return []
  const [rows] = await conn.query(
    `SELECT id,tipo_lancamento_id,texto_procurado,texto_excluir,prioridade
       FROM regras_tipo_lancamento WHERE ativo=1 ORDER BY prioridade ASC,id ASC`
  )
  return rows.map((row) => ({
    id: Number(row.id),
    tipoLancamentoId: row.tipo_lancamento_id == null ? null : Number(row.tipo_lancamento_id),
    procurar: normalizar(row.texto_procurado),
    excluir: normalizar(row.texto_excluir),
  })).filter((row) => row.tipoLancamentoId != null && row.procurar)
}

export function obterTipoLancamentoId(descricaoOriginal, regras = []) {
  const descricao = normalizar(descricaoOriginal)
  if (!descricao) return null
  for (const regra of regras) {
    if (!descricao.includes(regra.procurar)) continue
    if (regra.excluir && descricao.includes(regra.excluir)) continue
    return regra.tipoLancamentoId
  }
  return null
}

export async function carregarTiposSistema(conn, empresaId) {
  const [rows] = await conn.query(`SELECT codigo,tipo_lancamento_id FROM tipos_lancamento_config WHERE empresa_id=? AND ativo=1 AND codigo IS NOT NULL`, [empresaId])
  return new Map(rows.map((r) => [normalizar(r.codigo), Number(r.tipo_lancamento_id)]))
}

export async function carregarConfiguracaoTipos(conn, empresaId) {
  const [rows] = await conn.query(
    `SELECT tipo_lancamento_id,considera_resumo_dia,considera_relatorio_periodo,ativo
       FROM tipos_lancamento_config WHERE empresa_id=?`,
    [empresaId]
  )
  return new Map(rows.map((r) => [Number(r.tipo_lancamento_id), {
    resumo: Number(r.ativo) === 1 && Number(r.considera_resumo_dia) === 1,
    periodo: Number(r.ativo) === 1 && Number(r.considera_relatorio_periodo) === 1,
  }]))
}

export function codigoTipoNormalizado(valor) { return normalizar(valor) }
