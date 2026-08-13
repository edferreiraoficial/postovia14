import { db } from './db.js'

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
    if (!(await tabelaExiste(conn, 'tipos_lancamento'))) {
      throw new Error('A tabela tipos_lancamento não foi encontrada.')
    }
    if (!(await tabelaExiste(conn, 'regras_tipo_lancamento'))) {
      await conn.query(`
        CREATE TABLE regras_tipo_lancamento (
          id INT NOT NULL AUTO_INCREMENT,
          tipo_lancamento_id INT NOT NULL,
          texto_procurado VARCHAR(255) NOT NULL,
          texto_excluir VARCHAR(255) NULL,
          prioridade INT NOT NULL DEFAULT 100,
          ativo TINYINT(1) NOT NULL DEFAULT 1,
          PRIMARY KEY (id),
          KEY idx_regra_tipo_lancamento (tipo_lancamento_id),
          KEY idx_regra_tipo_prioridade (prioridade, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `)
    }

    // Os dois controles abaixo pertencem ao próprio cadastro oficial de tipos.
    // Não criamos tabela paralela: tipos_lancamento é a fonte única do T.
    if (!(await colunaExiste(conn, 'tipos_lancamento', 'considera_resumo_dia'))) {
      await conn.query(`ALTER TABLE tipos_lancamento ADD COLUMN considera_resumo_dia TINYINT(1) NOT NULL DEFAULT 1 AFTER ordem_relatorio`)
    }
    if (!(await colunaExiste(conn, 'tipos_lancamento', 'considera_relatorio_periodo'))) {
      await conn.query(`ALTER TABLE tipos_lancamento ADD COLUMN considera_relatorio_periodo TINYINT(1) NOT NULL DEFAULT 1 AFTER considera_resumo_dia`)
    }

    if (!(await colunaExiste(conn, 'regras_tipo_lancamento', 'texto_excluir'))) {
      await conn.query(`ALTER TABLE regras_tipo_lancamento ADD COLUMN texto_excluir VARCHAR(255) NULL AFTER texto_procurado`)
    }
    if (!(await colunaExiste(conn, 'regras_tipo_lancamento', 'prioridade'))) {
      await conn.query(`ALTER TABLE regras_tipo_lancamento ADD COLUMN prioridade INT NOT NULL DEFAULT 100 AFTER texto_excluir`)
    }
    if (!(await colunaExiste(conn, 'regras_tipo_lancamento', 'ativo'))) {
      await conn.query(`ALTER TABLE regras_tipo_lancamento ADD COLUMN ativo TINYINT(1) NOT NULL DEFAULT 1 AFTER prioridade`)
    }

    // Valores iniciais seguros para os tipos que são apenas estruturais/informativos.
    // Só executa quando os campos acabaram de ser criados ou continuam com o default 1.
    await conn.query(`
      UPDATE tipos_lancamento
         SET considera_resumo_dia = 0,
             considera_relatorio_periodo = 0
       WHERE UPPER(codigo) IN ('SALDO','TRANSFERENCIA','SEP_VENDAS')
    `)
  } finally {
    if (!connExterna) conn.release()
  }
}

const separarExpressoesRegra = (valor) => String(valor || '')
  .split(';')
  .map((parte) => normalizar(parte))
  .filter(Boolean)

export async function carregarRegrasTipoLancamento(conn) {
  await garantirEstruturaTiposLancamento(conn)
  const [rows] = await conn.query(
    `SELECT r.id,r.tipo_lancamento_id,r.texto_procurado,r.texto_excluir,r.prioridade,r.ativo
       FROM regras_tipo_lancamento r
       INNER JOIN tipos_lancamento t ON t.id=r.tipo_lancamento_id
      WHERE r.ativo=1 AND t.ativo=1
      ORDER BY r.prioridade ASC,r.id ASC`
  )
  return rows.map((row) => ({
    id: Number(row.id),
    tipoLancamentoId: row.tipo_lancamento_id == null ? null : Number(row.tipo_lancamento_id),
    // Cada item separado por ; e uma alternativa (OU).
    // Sem ; o comportamento permanece identico ao anterior.
    procurar: separarExpressoesRegra(row.texto_procurado),
    excluir: separarExpressoesRegra(row.texto_excluir),
  })).filter((row) => row.tipoLancamentoId != null && row.procurar.length > 0)
}

export function obterTipoLancamentoId(descricaoOriginal, regras = []) {
  const descricao = normalizar(descricaoOriginal)
  if (!descricao) return null
  for (const regra of regras) {
    const termosProcurados = Array.isArray(regra.procurar) ? regra.procurar : separarExpressoesRegra(regra.procurar)
    const termosExclusao = Array.isArray(regra.excluir) ? regra.excluir : separarExpressoesRegra(regra.excluir)

    // A regra casa quando QUALQUER expressao de texto_procurado estiver presente.
    if (!termosProcurados.some((termo) => descricao.includes(termo))) continue

    // Se QUALQUER expressao de texto_excluir estiver presente, a regra e descartada.
    if (termosExclusao.some((termo) => descricao.includes(termo))) continue

    // As regras ja chegam ordenadas por prioridade; a primeira compativel vence.
    return regra.tipoLancamentoId
  }
  return null
}

// O consolidado usa nomes técnicos internos (VENDA, RESULTADO, etc.).
// Aqui eles são associados aos códigos já existentes em tipos_lancamento.
const ALIASES_SISTEMA = new Map([
  ['SALDO', ['SALDO']],
  ['VENDA', ['VENDAS']],
  ['RESULTADO', ['RES_VENDAS']],
  ['COMPRA', ['COMPRA_PROD']],
  ['SEPARACAO_VENDAS', ['SEP_VENDAS']],
  ['TRANSFERENCIA', ['TRANSFERENCIA']],
  ['AJUSTE', ['AJUSTE_ESTOQUE']],
  ['TAXA_CARTAO', ['TARIFA_CARTAO']],
])

export async function carregarTiposSistema(conn, _empresaId) {
  await garantirEstruturaTiposLancamento(conn)
  const [rows] = await conn.query(`SELECT id,codigo FROM tipos_lancamento WHERE ativo=1 ORDER BY id`)
  const porCodigo = new Map(rows.map((r) => [normalizar(r.codigo), Number(r.id)]))
  const resultado = new Map(porCodigo)
  for (const [tecnico, codigos] of ALIASES_SISTEMA.entries()) {
    const id = codigos.map((codigo) => porCodigo.get(normalizar(codigo))).find((valor) => valor !== undefined)
    if (id !== undefined) resultado.set(tecnico, id)
  }
  return resultado
}

export async function carregarConfiguracaoTipos(conn, _empresaId) {
  await garantirEstruturaTiposLancamento(conn)
  const [rows] = await conn.query(
    `SELECT id,considera_resumo_dia,considera_relatorio_periodo,ativo FROM tipos_lancamento`
  )
  return new Map(rows.map((r) => [Number(r.id), {
    resumo: Number(r.ativo) === 1 && Number(r.considera_resumo_dia) === 1,
    periodo: Number(r.ativo) === 1 && Number(r.considera_relatorio_periodo) === 1,
  }]))
}

export function codigoTipoNormalizado(valor) { return normalizar(valor) }
