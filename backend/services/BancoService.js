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

export async function salvarComprasNoBanco({ empresaId, compras }) {
  let total = 0

  for (const compra of compras) {
    const produtoId = await obterOuCriarProduto(compra.produto)
    const fornecedorId = await obterOuCriarFornecedor(compra.fornecedor)
    const dataSql = dataBrParaSql(compra.dataEmissao || compra.data)


    await db.query(
      `INSERT IGNORE INTO compras (
        empresa_id,
        data_emissao,
        produto_id,
        fornecedor_id,
        numero_nf,
        custo,
        quantidade,
        valor_total,
        quant_rec,
        preco_pag,
        valor_pag
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId,
        dataSql,
        produtoId,
        fornecedorId,
        compra.nf,
        compra.custo,
        compra.quantidade,
        compra.valorTotal,
        compra.quantRec ?? compra.quant_rec ?? compra.quantidade,
        compra.precoPag ?? compra.preco_pag ?? compra.custo,
        compra.valorPag ?? compra.valor_pag ?? compra.valorTotal,
      ]
    )

    total++
  }

  return total
}

export async function salvarLmcNoBanco({ empresaId, dadosLmc }) {
  let total = 0

  for (const [produtoNome, linhas] of Object.entries(dadosLmc)) {
    const produtoId = await obterOuCriarProduto(produtoNome)

    for (const linha of linhas) {
      const dataSql = dataBrParaSql(linha.data)


      await db.query(
        `INSERT INTO lmc_movimentos (
          empresa_id,
          data_movimento,
          produto_id,
          estoque_abertura,
          quantidade_vendas,
          valor_vendas,
          ajuste_quantidade,
          estoque_fechamento
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          estoque_abertura = VALUES(estoque_abertura),
          quantidade_vendas = VALUES(quantidade_vendas),
          valor_vendas = VALUES(valor_vendas),
          ajuste_quantidade = VALUES(ajuste_quantidade),
          estoque_fechamento = VALUES(estoque_fechamento),
          atualizado_em = NOW()`,
        [
          empresaId,
            dataSql,
          produtoId,
          linha.abertura,
          Math.abs(Number(linha.quantVendas || 0)),
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

export async function obterOuCriarContaBancaria({ empresaId, nomeBanco }) {
  const nome = String(nomeBanco || '').trim().toUpperCase()
  await db.query(
    `INSERT INTO contas_bancarias (empresa_id, instituicao, tipo, nome_conta, ativo)
     VALUES (?, ?, 'BANCARIA', ?, 1)
     ON DUPLICATE KEY UPDATE instituicao = VALUES(instituicao), atualizado_em = NOW()`,
    [empresaId, nome, nome]
  )
  const [rows] = await db.query(
    `SELECT id FROM contas_bancarias WHERE empresa_id = ? AND nome_conta = ? LIMIT 1`,
    [empresaId, nome]
  )
  return rows[0]?.id || null
}

export async function salvarExtratosBanco({
  empresaId,
  origem,
  contaBancariaId: contaBancariaIdInformada,
  lancamentos,
}) {
  let origemNormalizada = String(origem || '').trim().toUpperCase()
  let contaBancariaId = Number(contaBancariaIdInformada || 0) || null

  if (contaBancariaId) {
    const [contas] = await db.query(
      `SELECT cb.id, cb.nome_conta, cb.instituicao AS nome_banco
       FROM contas_bancarias cb
       WHERE cb.id = ? AND cb.empresa_id = ?
       LIMIT 1`,
      [contaBancariaId, empresaId]
    )

    if (!contas[0]) {
      throw new Error('Conta bancária inválida ou não vinculada à empresa selecionada.')
    }

    origemNormalizada = String(contas[0].nome_banco || contas[0].nome_conta || origemNormalizada)
      .trim()
      .toUpperCase()
  } else {
    contaBancariaId = await obterOuCriarContaBancaria({
      empresaId,
      nomeBanco: origemNormalizada,
    })
  }

  // Normaliza os extratos antes da gravação. Um saldo nunca deve permanecer
  // anexado à última movimentação do dia: ele é convertido em um lançamento
  // próprio, com valor zero, natureza SALDO e descrição "Saldo do dia".
  const movimentos = []
  const saldosPorDia = new Map()
  const saldosAnteriores = []

  for (const itemOriginal of lancamentos || []) {
    const item = { ...itemOriginal }
    const dataSql = dataBrParaSql(item.data)
    if (!dataSql) continue

    const descricao = String(item.descricao || '').trim()
    const descricaoNormalizada = descricao.toUpperCase()
    const saldoInformado = item.saldo !== null && item.saldo !== undefined && item.saldo !== ''
    const ehSaldoAnterior = descricaoNormalizada.includes('SALDO ANTERIOR')
    const ehSaldoDia = item.tipo === 'SALDO' ||
      descricaoNormalizada.includes('SALDO DO DIA') ||
      descricaoNormalizada.includes('SALDO TOTAL DISPON') ||
      (saldoInformado && (item.valor === null || item.valor === undefined || Number(item.valor) === 0))

    if (ehSaldoAnterior) {
      saldosAnteriores.push({
        ...item,
        dataSql,
        descricao: 'Saldo anterior',
        valor: 0,
        saldo: saldoInformado ? Number(item.saldo) : null,
      })
      continue
    }

    if (ehSaldoDia) {
      if (saldoInformado) {
        saldosPorDia.set(dataSql, Number(item.saldo))
      }
      continue
    }

    // Mesmo que o parser tenha colocado o saldo na última movimentação,
    // separamos o valor e limpamos o saldo do lançamento comum.
    if (saldoInformado) {
      saldosPorDia.set(dataSql, Number(item.saldo))
    }

    movimentos.push({
      ...item,
      dataSql,
      saldo: null,
    })
  }

  const lancamentosNormalizados = [
    ...saldosAnteriores,
    ...movimentos,
    ...Array.from(saldosPorDia.entries()).map(([dataSql, saldo]) => ({
      dataSql,
      data: dataSql.split('-').reverse().join('/'),
      descricao: 'Saldo do dia',
      valor: 0,
      saldo,
      tipo: 'SALDO',
    })),
  ]

  const lancamentosPreparados = []
  const datasAfetadas = new Set()

  for (const item of lancamentosNormalizados) {
    const dataSql = item.dataSql || dataBrParaSql(item.data)
    if (!dataSql) continue


    lancamentosPreparados.push({
      ...item,
      dataSql,
    })

    datasAfetadas.add(dataSql)
  }

  // Substitui somente os dias presentes no arquivo importado. Isso remove
  // registros antigos em que o saldo estava gravado na última movimentação,
  // sem apagar outros dias do mesmo mês que não estejam no PDF atual.
  if (datasAfetadas.size) {
    const datas = Array.from(datasAfetadas)
    await db.query(
      `DELETE FROM extratos_bancarios
       WHERE empresa_id = ?
         AND UPPER(origem) = ?
         AND conta_bancaria_id = ?
         AND data_lancamento IN (${datas.map(() => '?').join(',')})`,
      [empresaId, origemNormalizada, contaBancariaId, ...datas]
    )
  }

  // Mantém os saldos sempre depois das movimentações do mesmo dia.
  lancamentosPreparados.sort((a, b) => {
    const data = a.dataSql.localeCompare(b.dataSql)
    if (data !== 0) return data
    const aSaldo = String(a.descricao || '').toUpperCase().includes('SALDO DO DIA') ? 1 : 0
    const bSaldo = String(b.descricao || '').toUpperCase().includes('SALDO DO DIA') ? 1 : 0
    return aSaldo - bSaldo
  })

  let total = 0

  for (const item of lancamentosPreparados) {
    const valor = Number(item.valor ?? 0)
    const saldo = item.saldo === null || item.saldo === undefined || item.saldo === ''
      ? null
      : Number(item.saldo)

    let natureza = 'SALDO'
    if (valor > 0) natureza = 'ENTRADA'
    if (valor < 0) natureza = 'SAIDA'

    const [resultado] = await db.query(
      `INSERT INTO extratos_bancarios (
        empresa_id,
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
        contaBancariaId,
        item.dataSql,
        item.descricao,
        item.descricao,
        item.descricao,
        valor,
        saldo,
        natureza,
        origemNormalizada,
      ]
    )

    total += Number(resultado?.affectedRows || 0)
  }

  return total
}

