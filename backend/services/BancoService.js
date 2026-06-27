import { db } from '../db.js'

export async function obterEmpresaPadrao() {
  const [rows] = await db.query(
    'SELECT id FROM empresas WHERE nome = ? LIMIT 1',
    ['Posto Via 14']
  )

  if (rows.length === 0) {
    throw new Error('Empresa Posto Via 14 não encontrada no banco.')
  }

  return rows[0]
}

export async function obterOuCriarPeriodo({ empresaId, ano, mes }) {
  await db.query(
    `INSERT INTO periodos (empresa_id, ano, mes)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE atualizado_em = NOW()`,
    [empresaId, ano, mes]
  )

  const [rows] = await db.query(
    `SELECT * FROM periodos
     WHERE empresa_id = ? AND ano = ? AND mes = ?
     LIMIT 1`,
    [empresaId, ano, mes]
  )

  return rows[0]
}

export async function obterOuCriarPeriodoPorData({ empresaId, data }) {
  if (!data) throw new Error('Data inválida para criação de período.')

  const d = new Date(`${data}T00:00:00`)
  const ano = d.getFullYear()
  const mes = d.getMonth() + 1

  return obterOuCriarPeriodo({ empresaId, ano, mes })
}

export async function obterOuCriarFornecedor(nome) {
  const nomeLimpo = String(nome || '').trim()
  if (!nomeLimpo) return null

  await db.query(
    `INSERT INTO fornecedores (nome)
     VALUES (?)
     ON DUPLICATE KEY UPDATE nome = VALUES(nome)`,
    [nomeLimpo]
  )

  const [rows] = await db.query(
    'SELECT id FROM fornecedores WHERE nome = ? LIMIT 1',
    [nomeLimpo]
  )

  return rows[0]?.id || null
}

export async function obterOuCriarProduto(nome) {
  const nomeLimpo = String(nome || '').trim().toUpperCase()
  if (!nomeLimpo) return null

  let produtoBase = nomeLimpo

  if (nomeLimpo.includes('GASOLINA')) produtoBase = 'GASOLINA'
  if (nomeLimpo.includes('ETANOL')) produtoBase = 'ETANOL'
  if (nomeLimpo.includes('DIESEL')) produtoBase = 'DIESEL'

  await db.query(
    `INSERT INTO produtos (nome, tipo, unidade)
     VALUES (?, 'COMBUSTIVEL', 'L')
     ON DUPLICATE KEY UPDATE
       tipo = VALUES(tipo),
       unidade = VALUES(unidade)`,
    [produtoBase]
  )

  const [rows] = await db.query(
    'SELECT id FROM produtos WHERE nome = ? LIMIT 1',
    [produtoBase]
  )

  return rows[0]?.id || null
}

export function dataBrParaSql(dataBr) {
  if (!dataBr) return null

  const [dia, mes, ano] = String(dataBr).split('/')
  if (!dia || !mes || !ano) return null

  return `${ano}-${mes}-${dia}`
}

export async function salvarComprasNoBanco({ empresaId, periodoId, compras }) {
  let total = 0

  for (const compra of compras) {
    const produtoId = await obterOuCriarProduto(compra.produto)
    const fornecedorId = await obterOuCriarFornecedor(compra.fornecedor)
    const dataSql = dataBrParaSql(compra.dataEmissao || compra.data)

    const periodo = periodoId
      ? { id: periodoId }
      : await obterOuCriarPeriodoPorData({ empresaId, data: dataSql })

    await db.query(
      `INSERT IGNORE INTO compras (
        empresa_id,
        periodo_id,
        data_emissao,
        produto_id,
        fornecedor_id,
        numero_nf,
        custo,
        quantidade,
        valor_total
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId,
        periodo.id,
        dataSql,
        produtoId,
        fornecedorId,
        compra.nf,
        compra.custo,
        compra.quantidade,
        compra.valorTotal,
      ]
    )

    total++
  }

  return total
}

export async function salvarLmcNoBanco({ empresaId, periodoId, dadosLmc }) {
  let total = 0

  for (const [produtoNome, linhas] of Object.entries(dadosLmc)) {
    const produtoId = await obterOuCriarProduto(produtoNome)

    for (const linha of linhas) {
      const dataSql = dataBrParaSql(linha.data)

      const periodo = periodoId
        ? { id: periodoId }
        : await obterOuCriarPeriodoPorData({ empresaId, data: dataSql })

      await db.query(
        `INSERT INTO lmc_movimentos (
          empresa_id,
          periodo_id,
          data_movimento,
          produto_id,
          estoque_abertura,
          quantidade_vendas,
          valor_vendas,
          ajuste_quantidade,
          estoque_fechamento
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          estoque_abertura = VALUES(estoque_abertura),
          quantidade_vendas = VALUES(quantidade_vendas),
          valor_vendas = VALUES(valor_vendas),
          ajuste_quantidade = VALUES(ajuste_quantidade),
          estoque_fechamento = VALUES(estoque_fechamento),
          atualizado_em = NOW()`,
        [
          empresaId,
          periodo.id,
          dataSql,
          produtoId,
          linha.abertura,
          linha.quantVendas,
          linha.valorVendas,
          linha.ajustes,
          linha.fechamento,
        ]
      )

      total++
    }
  }

  return total
}

export async function obterOuCriarBanco(nomeBanco) {
  const nome = String(nomeBanco || '').trim().toUpperCase()

  await db.query(
    `INSERT INTO bancos (nome, codigo)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE codigo = VALUES(codigo)`,
    [nome, nome]
  )

  const [rows] = await db.query(
    'SELECT id FROM bancos WHERE nome = ? LIMIT 1',
    [nome]
  )

  return rows[0]?.id || null
}

export async function obterOuCriarContaBancaria({ empresaId, nomeBanco }) {
  const bancoId = await obterOuCriarBanco(nomeBanco)

  await db.query(
    `INSERT INTO contas_bancarias (
      empresa_id,
      banco_id,
      nome_conta
    )
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE atualizado_em = NOW()`,
    [empresaId, bancoId, nomeBanco]
  )

  const [rows] = await db.query(
    `SELECT id
     FROM contas_bancarias
     WHERE empresa_id = ?
       AND banco_id = ?
       AND nome_conta = ?
     LIMIT 1`,
    [empresaId, bancoId, nomeBanco]
  )

  return rows[0]?.id || null
}

export async function salvarExtratosBanco({
  empresaId,
  periodoId,
  origem,
  lancamentos,
}) {
  const contaBancariaId = await obterOuCriarContaBancaria({
    empresaId,
    nomeBanco: origem,
  })

  const lancamentosPreparados = []
  const periodosAfetados = new Map()

  for (const item of lancamentos) {
    const dataSql = dataBrParaSql(item.data)
    if (!dataSql) continue

    const periodo = periodoId
      ? { id: periodoId }
      : await obterOuCriarPeriodoPorData({ empresaId, data: dataSql })

    lancamentosPreparados.push({
      ...item,
      dataSql,
      periodoId: periodo.id,
    })

    periodosAfetados.set(periodo.id, true)
  }

  // Quando a regra de consolidação do Itaú muda, registros antigos individuais
  // podem continuar no banco por causa do INSERT IGNORE.
  // Por isso, antes de gravar o Itaú novamente, limpamos somente os períodos
  // afetados daquele banco e inserimos a versão consolidada correta.
  if (String(origem).toUpperCase() === 'ITAU' && periodosAfetados.size) {
    await db.query(
      `DELETE FROM extratos_bancarios
       WHERE empresa_id = ?
         AND origem = ?
         AND conta_bancaria_id = ?
         AND periodo_id IN (${Array.from(periodosAfetados).map(() => '?').join(',')})`,
      [empresaId, origem, contaBancariaId, ...Array.from(periodosAfetados.keys())]
    )
  }

  let total = 0

  for (const item of lancamentosPreparados) {
    const valor = item.valor ?? 0
    const saldo = item.saldo ?? null

    let natureza = 'SALDO'
    if (Number(valor) > 0) natureza = 'ENTRADA'
    if (Number(valor) < 0) natureza = 'SAIDA'

    const [resultado] = await db.query(
      `INSERT IGNORE INTO extratos_bancarios (
        empresa_id,
        periodo_id,
        conta_bancaria_id,
        data_lancamento,
        descricao_original,
        descricao_normalizada,
        tipo_lancamento,
        valor,
        saldo,
        natureza,
        origem
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId,
        item.periodoId,
        contaBancariaId,
        item.dataSql,
        item.descricao,
        item.descricao,
        item.descricao,
        valor,
        saldo,
        natureza,
        origem,
      ]
    )

    total += Number(resultado?.affectedRows || 0)
  }

  return total
}