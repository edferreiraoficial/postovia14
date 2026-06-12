import { db } from '../db.js'

export async function obterEmpresaPadrao() {
  const resultado = await db.query(
    'SELECT id FROM empresas WHERE nome = $1 LIMIT 1',
    ['Posto Via 14']
  )

  if (resultado.rows.length === 0) {
    throw new Error('Empresa Posto Via 14 não encontrada no banco.')
  }

  return resultado.rows[0]
}

export async function obterOuCriarPeriodo({ empresaId, ano, mes }) {
  const resultado = await db.query(
    `INSERT INTO periodos (empresa_id, ano, mes)
     VALUES ($1, $2, $3)
     ON CONFLICT (empresa_id, ano, mes)
     DO UPDATE SET atualizado_em = NOW()
     RETURNING *`,
    [empresaId, ano, mes]
  )

  return resultado.rows[0]
}

export async function obterOuCriarPeriodoPorData({ empresaId, data }) {
  if (!data) throw new Error('Data inválida para criação de período.');

  const d = new Date(`${data}T00:00:00`);
  const ano = d.getFullYear();
  const mes = d.getMonth() + 1;

  return obterOuCriarPeriodo({ empresaId, ano, mes });
}

export async function obterOuCriarFornecedor(nome) {
  const nomeLimpo = String(nome || '').trim()

  if (!nomeLimpo) return null

  const existe = await db.query(
    'SELECT id FROM fornecedores WHERE nome = $1 LIMIT 1',
    [nomeLimpo]
  )

  if (existe.rows.length) return existe.rows[0].id

  const novo = await db.query(
    `INSERT INTO fornecedores (nome)
     VALUES ($1)
     RETURNING id`,
    [nomeLimpo]
  )

  return novo.rows[0].id
}

export async function obterOuCriarProduto(nome) {
  const nomeLimpo = String(nome || '').trim().toUpperCase()

  if (!nomeLimpo) return null

  let produtoBase = nomeLimpo

  if (nomeLimpo.includes('GASOLINA')) produtoBase = 'GASOLINA'
  if (nomeLimpo.includes('ETANOL')) produtoBase = 'ETANOL'
  if (nomeLimpo.includes('DIESEL')) produtoBase = 'DIESEL'

  const existe = await db.query(
    'SELECT id FROM produtos WHERE nome = $1 LIMIT 1',
    [produtoBase]
  )

  if (existe.rows.length) return existe.rows[0].id

  const novo = await db.query(
    `INSERT INTO produtos (nome, tipo, unidade)
     VALUES ($1, 'COMBUSTIVEL', 'L')
     RETURNING id`,
    [produtoBase]
  )

  return novo.rows[0].id
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
      : await obterOuCriarPeriodoPorData({
          empresaId,
          data: dataSql,
        })
    await db.query(
      `INSERT INTO compras (
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
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (
        empresa_id,
        periodo_id,
        data_emissao,
        produto_id,
        fornecedor_id,
        numero_nf,
        quantidade,
        valor_total
      )
      DO NOTHING`,
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
        : await obterOuCriarPeriodoPorData({
            empresaId,
            data: dataSql,
          })
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
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (empresa_id, periodo_id, data_movimento, produto_id)
        DO UPDATE SET
          estoque_abertura = EXCLUDED.estoque_abertura,
          quantidade_vendas = EXCLUDED.quantidade_vendas,
          valor_vendas = EXCLUDED.valor_vendas,
          ajuste_quantidade = EXCLUDED.ajuste_quantidade,
          estoque_fechamento = EXCLUDED.estoque_fechamento,
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
  const nome = String(nomeBanco || '').trim().toUpperCase();

  const existe = await db.query(
    'SELECT id FROM bancos WHERE nome = $1 LIMIT 1',
    [nome]
  );

  if (existe.rows.length) return existe.rows[0].id;

  const novo = await db.query(
    `INSERT INTO bancos (nome, codigo)
     VALUES ($1, $1)
     RETURNING id`,
    [nome]
  );

  return novo.rows[0].id;
}

export async function obterOuCriarContaBancaria({ empresaId, nomeBanco }) {
  const bancoId = await obterOuCriarBanco(nomeBanco);

  const existe = await db.query(
    `SELECT id 
     FROM contas_bancarias 
     WHERE empresa_id = $1 
       AND banco_id = $2 
       AND nome_conta = $3
     LIMIT 1`,
    [empresaId, bancoId, nomeBanco]
  );

  if (existe.rows.length) return existe.rows[0].id;

  const nova = await db.query(
    `INSERT INTO contas_bancarias (
      empresa_id,
      banco_id,
      nome_conta
    )
    VALUES ($1, $2, $3)
    RETURNING id`,
    [empresaId, bancoId, nomeBanco]
  );

  return nova.rows[0].id;
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

  let total = 0

  for (const item of lancamentos) {
    const dataSql = dataBrParaSql(item.data)
    const valor = item.valor ?? 0
    const saldo = item.saldo ?? null

    const periodo = periodoId
      ? { id: periodoId }
      : await obterOuCriarPeriodoPorData({
          empresaId,
          data: dataSql,
        })

    let natureza = 'SALDO'

    if (Number(valor) > 0) natureza = 'ENTRADA'
    if (Number(valor) < 0) natureza = 'SAIDA'

    await db.query(
      `INSERT INTO extratos_bancarios (
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
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (
        empresa_id,
        periodo_id,
        origem,
        data_lancamento,
        descricao_original,
        valor,
        saldo
      )
      DO NOTHING`,
      [
        empresaId,
        periodo.id,
        contaBancariaId,
        dataSql,
        item.descricao,
        item.descricao,
        item.descricao,
        valor,
        saldo,
        natureza,
        origem,
      ]
    )

    total++
  }

  return total
}