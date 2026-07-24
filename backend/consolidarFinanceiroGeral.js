import { db } from './db.js'

const CAMPOS_CONTAS = new Set(Array.from({ length: 30 }, (_, i) => `conta${String(i + 1).padStart(2, '0')}`))
const CAMPOS_PRODUTOS = ['prod1', 'prod2', 'prod3', 'prod4']

const ALIASES_PADRAO = [
  { campo: 'conta03', termos: ['SPOT LUCILA', 'LUCILA'] },
  { campo: 'conta02', termos: ['ITAU', 'ITAÚ'] },
  { campo: 'conta11', termos: ['CAIXA'] },
  { campo: 'conta12', termos: ['CARTAO', 'CARTÃO'] },
  { campo: 'conta13', termos: ['VENDAS'] },
  { campo: 'conta21', termos: ['ERALDO'] },
  { campo: 'conta23', termos: ['EMPRESTIMO', 'EMPRÉSTIMO'] },
  { campo: 'conta24', termos: ['FORNECEDOR'] },
  { campo: 'conta01', termos: ['SPOT'] },
]

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}


function ehSaldoInicialLinha(row) {
  const descricao = normalizarTexto(row?.descricao_normalizada || row?.descricao_original)
  return descricao.startsWith('SALDO INICIAL DO DIA') || descricao.startsWith('SALDO ANTERIOR')
}

function ehSaldoDoDiaLinha(row) {
  return normalizarTexto(row?.descricao_normalizada || row?.descricao_original).startsWith('SALDO DO DIA')
}

function dataIsoValida(valor, nome) {
  const texto = String(valor || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) throw new Error(`${nome} inválida.`)
  return texto
}

function dataAnterior(dataIso) {
  const d = new Date(`${dataIso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function proximaData(dataIso) {
  const d = new Date(`${dataIso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function numero(valor) {
  const n = Number(valor || 0)
  return Number.isFinite(n) ? n : 0
}

function arred6(valor) {
  return Math.round((numero(valor) + Number.EPSILON) * 1e6) / 1e6
}

function arred2(valor) {
  return Math.round((numero(valor) + Number.EPSILON) * 100) / 100
}

function campoPorNomeConta(conta) {
  const texto = normalizarTexto([conta.nome_conta, conta.instituicao, conta.tipo].filter(Boolean).join(' '))
  return ALIASES_PADRAO.find((item) => item.termos.some((termo) => texto.includes(normalizarTexto(termo))))?.campo || null
}

function produtoDestino(nome) {
  const texto = normalizarTexto(nome)
  if (!texto) return null
  if (texto.includes('GASOLINA') && (texto.includes('ADITIV') || texto.includes('GRID'))) return 'prod4'
  if (texto.includes('GASOLINA')) return 'prod1'
  if (texto.includes('ETANOL') || texto.includes('ALCOOL')) return 'prod2'
  if (texto.includes('DIESEL')) return 'prod3'
  return null
}

function nomeProduto(campo) {
  return ({ prod1: 'Gasolina', prod2: 'Etanol', prod3: 'Diesel', prod4: 'Gasolina Aditivada' })[campo] || campo
}

async function tabelaExiste(conn, tabela) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS total FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tabela]
  )
  return Number(row?.total || 0) > 0
}

async function colunaExiste(conn, tabela, coluna) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS total FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tabela, coluna]
  )
  return Number(row?.total || 0) > 0
}

async function carregarMapeamentos(conn, empresaId) {
  const mapeamentos = new Map()
  if (await tabelaExiste(conn, 'financeiro_geral_mapeamentos')) {
    const [rows] = await conn.query(
      `SELECT campo_destino, conta_financeira_id
       FROM financeiro_geral_mapeamentos
       WHERE empresa_id = ? AND tipo = 'CONTA' AND ativo = 1 AND conta_financeira_id IS NOT NULL`,
      [empresaId]
    )
    for (const row of rows) {
      const campo = String(row.campo_destino || '').trim()
      if (CAMPOS_CONTAS.has(campo)) mapeamentos.set(Number(row.conta_financeira_id), campo)
    }
  }

  const [contas] = await conn.query(
    `SELECT id, nome_conta, instituicao, tipo FROM contas_bancarias
     WHERE empresa_id = ? AND ativo = 1 ORDER BY id ASC`,
    [empresaId]
  )
  for (const conta of contas) {
    if (!mapeamentos.has(Number(conta.id))) {
      const campo = campoPorNomeConta(conta)
      if (campo) mapeamentos.set(Number(conta.id), campo)
    }
  }
  return mapeamentos
}

function ehSaldoExtrato(row) {
  const natureza = normalizarTexto(row.natureza)
  const descricao = normalizarTexto(row.descricao_original || row.descricao_normalizada)
  return natureza === 'SALDO' || descricao.startsWith('SALDO DO DIA') || descricao.startsWith('SALDO INICIAL DO DIA') || descricao.startsWith('SALDO ANTERIOR') || descricao === 'SALDO'
}

function ehCreditoVendasCartao(row) {
  const descricao = normalizarTexto(row?.descricao_original || row?.descricao_normalizada)
  return descricao.includes('CREDITO VENDAS CARTAO')
}

function ehPixRecebidoMaquininha(row) {
  const descricao = normalizarTexto(row?.descricao_original || row?.descricao_normalizada)
  return descricao.includes('PIX RECEBIDO MAQUININHA')
}

function ehTarifaPixRecebidoMaquininha(row) {
  const descricao = normalizarTexto(row?.descricao_original || row?.descricao_normalizada)
  return descricao.includes('TARIFA PIX RECEBIDO MAQUININHA')
    || descricao.includes('TARIFA PIX RECEBIDO MAQUINHA')
    || descricao.includes('TARIFA PIX RECEBIMENTO')
}

function ehLancamentoCartaoSinteticoLegado(row) {
  const origem = normalizarTexto(row?.origem)
  const tabela = normalizarTexto(row?.tabela_origem)
  return origem === 'VENDAS_CARTAO' || tabela === 'VENDAS_CARTAO'
}

function ehSeparacaoVendas(row) {
  const descricao = normalizarTexto(row?.descricao_original || row?.descricao_normalizada)
  const tipo = String(row?.tipo_lancamento || '').toUpperCase()
  // Reconhece também descrições antigas, como "Separação Cartão/Outros",
  // para que linhas legadas ou duplicadas sejam consolidadas corretamente.
  return tipo === 'SEPARACAO_VENDAS'
    || (descricao.startsWith('SEPARACAO') && descricao.includes('CARTAO'))
}

function separacaoTemValores(row) {
  return ['conta11', 'conta12', 'conta13'].some((campo) => Math.abs(numero(row?.[campo])) > 0.0000005)
}

function origemPermitida(row) {
  const origem = normalizarTexto(row.origem)
  if (origem === 'SPOT') return 'SPOT'
  if (origem === 'ITAU') return 'ITAU'
  return 'SISTEMA'
}

function calcularTotal(valores) {
  let total = 0
  for (const [campo, valor] of Object.entries(valores)) {
    if (campo.startsWith('conta') || campo.endsWith('_total')) total += arred2(valor)
  }
  return arred2(total)
}

async function gravarLinha(conn, {
  empresa, data, descricao, tipo, origem, tabelaOrigem, registroOrigemId = null,
  chave, usuarioId, valores = {},
}) {
  const permitidos = new Set([
    ...CAMPOS_CONTAS,
    ...CAMPOS_PRODUTOS.flatMap((p) => [`${p}_quant`, `${p}_valor`, `${p}_total`]),
  ])
  const dados = Object.fromEntries(Object.entries(valores).filter(([k]) => permitidos.has(k)).map(([k, v]) => [k, arred6(v)]))
  const total = calcularTotal(dados)
  const descricaoOriginal = String(descricao || '').slice(0, 500) || null
  const descricaoNormalizada = descricaoOriginal ? normalizarTexto(descricaoOriginal).slice(0, 500) : null
  const campos = Object.keys(dados)
  const [existentes] = await conn.query('SELECT id FROM financeiro_geral WHERE chave_integracao = ? LIMIT 1', [chave])

  if (existentes[0]) {
    const zerar = [
      ...Array.from(CAMPOS_CONTAS),
      ...CAMPOS_PRODUTOS.flatMap((p) => [`${p}_quant`, `${p}_valor`, `${p}_total`]),
    ].filter((c) => !campos.includes(c))
    const sets = [
      'data_lancamento = ?', 'descricao_original = ?', 'descricao_normalizada = ?', 'tipo_lancamento = ?',
      'origem = ?', 'tabela_origem = ?', 'registro_origem_id = ?', 'usuario_id = ?', 'status = \'ATIVO\'',
      ...zerar.map((c) => `${c} = 0.000000`),
      ...campos.map((c) => `${c} = ?`),
      'total = ?', 'atualizado_em = NOW()',
    ]
    await conn.query(
      `UPDATE financeiro_geral SET ${sets.join(', ')} WHERE id = ?`,
      [data, descricaoOriginal, descricaoNormalizada, tipo, origem, tabelaOrigem, registroOrigemId,
        usuarioId || null, ...campos.map((c) => dados[c]), total, existentes[0].id]
    )
    return 'atualizado'
  }

  const colunas = campos.length ? `, ${campos.join(', ')}` : ''
  const placeholders = campos.length ? `, ${campos.map(() => '?').join(', ')}` : ''
  await conn.query(
    `INSERT INTO financeiro_geral
     (empresa_id, data_lancamento, descricao_original, descricao_normalizada, tipo_lancamento,
      total, origem, tabela_origem, registro_origem_id, chave_integracao, usuario_id, status${colunas})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ATIVO'${placeholders})`,
    [empresa, data, descricaoOriginal, descricaoNormalizada, tipo, total, origem, tabelaOrigem,
      registroOrigemId, chave, usuarioId || null, ...campos.map((c) => dados[c])]
  )
  return 'inserido'
}

export async function consolidarFinanceiroGeral({
  empresaId, dataInicial, dataFinal, usuarioId = null, contaBancariaId = null,
  limparAntes = false, dataSaldoAnterior = null, dataInicioLancamentos = null, dataMinimaGravacao = null,
}) {
  const conn = await db.getConnection()
  try {
    const empresa = Number(empresaId)
    if (!Number.isInteger(empresa) || empresa <= 0) throw new Error('Empresa inválida.')
    const inicio = dataIsoValida(dataInicial, 'Data inicial')
    const fim = dataIsoValida(dataFinal, 'Data final')
    const diaSaldoInicial = dataSaldoAnterior ? dataIsoValida(dataSaldoAnterior, 'Data do saldo inicial') : inicio
    const inicioLancamentos = dataInicioLancamentos ? dataIsoValida(dataInicioLancamentos, 'Data inicial dos lançamentos') : inicio
    const dataMinimaPermitida = dataMinimaGravacao ? dataIsoValida(dataMinimaGravacao, 'Data mínima de gravação') : null
    if (inicio > fim) throw new Error('A data inicial não pode ser posterior à data final.')

    await conn.beginTransaction()
    // Proteção final da trava: nenhuma inclusão ou atualização gerada pela consolidação
    // pode atingir data anterior à data mínima liberada, mesmo em rotinas auxiliares.
    const gravarLinhaSegura = async (dadosLinha) => {
      const dataLinha = String(dadosLinha?.data || '').slice(0, 10)
      if (dataMinimaPermitida && dataLinha && dataLinha < dataMinimaPermitida) return 'ignorado'
      return gravarLinha(conn, dadosLinha)
    }
    for (const campo of ['tabela_origem', 'registro_origem_id', 'chave_integracao']) {
      if (!(await colunaExiste(conn, 'financeiro_geral', campo))) {
        throw new Error(`A coluna financeiro_geral.${campo} não foi encontrada.`)
      }
    }

    // Localiza uma abertura já existente na primeira data do período. Linhas antigas
    // "Saldo anterior" são aceitas e migradas para "Saldo inicial do dia".
    const [saldoInicialAntesLimpezaRows] = await conn.query(
      `SELECT * FROM financeiro_geral
       WHERE empresa_id = ? AND data_lancamento = ?
         AND (
           UPPER(TRIM(COALESCE(descricao_normalizada, descricao_original, ''))) LIKE 'SALDO INICIAL DO DIA%'
           OR UPPER(TRIM(COALESCE(descricao_normalizada, descricao_original, ''))) LIKE 'SALDO ANTERIOR%'
         )
       ORDER BY id ASC LIMIT 1`,
      [empresa, diaSaldoInicial]
    )
    const saldoInicialAntesLimpeza = saldoInicialAntesLimpezaRows[0] || null

    // Procura primeiro o fechamento exatamente do dia anterior ao início do período.
    // Quando ele existe, ele próprio é a abertura contábil do novo período e nenhuma
    // linha adicional de "Saldo anterior" deve ser criada na primeira data.
    const diaAnteriorAoPeriodo = dataAnterior(diaSaldoInicial)
    const [saldoDiaAnteriorRows] = await conn.query(
      `SELECT * FROM financeiro_geral
       WHERE empresa_id = ? AND data_lancamento = ? AND status = 'ATIVO'
         AND UPPER(TRIM(COALESCE(descricao_normalizada, descricao_original, ''))) LIKE 'SALDO DO DIA%'
       ORDER BY id DESC LIMIT 1`,
      [empresa, diaAnteriorAoPeriodo]
    )
    const saldoDiaAnterior = saldoDiaAnteriorRows[0] || null

    // Também reconhece uma abertura já existente no dia anterior. Em bases antigas,
    // o período pode ter sido encerrado apenas com uma linha "Saldo anterior", sem uma
    // linha separada de "Saldo do dia". Essa abertura deve ser reutilizada e nunca
    // provocar a criação de outra linha de saldo no início do novo período.
    const [saldoAnteriorDiaAnteriorRows] = await conn.query(
      `SELECT * FROM financeiro_geral
       WHERE empresa_id = ? AND data_lancamento = ? AND status = 'ATIVO'
         AND (
           UPPER(TRIM(COALESCE(descricao_normalizada, descricao_original, ''))) LIKE 'SALDO ANTERIOR%'
           OR UPPER(TRIM(COALESCE(descricao_normalizada, descricao_original, ''))) LIKE 'SALDO INICIAL DO DIA%'
         )
       ORDER BY id DESC LIMIT 1`,
      [empresa, diaAnteriorAoPeriodo]
    )
    const saldoAnteriorDiaAnterior = saldoAnteriorDiaAnteriorRows[0] || null

    // Se não houver fechamento exatamente no dia anterior, ainda podemos usar o último
    // fechamento histórico como valor-base para criar a abertura explícita do período.
    const [ultimoSaldoDoDiaRows] = await conn.query(
      `SELECT * FROM financeiro_geral
       WHERE empresa_id = ? AND data_lancamento < ? AND status = 'ATIVO'
         AND UPPER(TRIM(COALESCE(descricao_normalizada, descricao_original, ''))) LIKE 'SALDO DO DIA%'
       ORDER BY data_lancamento DESC, id DESC LIMIT 1`,
      [empresa, diaSaldoInicial]
    )
    const ultimoSaldoDoDia = ultimoSaldoDoDiaRows[0] || null

    // Ao recriar, uma abertura existente na primeira data só é preservada quando não há
    // fechamento no dia anterior. Se houver, remove-se todo o período, inclusive eventual
    // abertura duplicada, pois a base será a linha histórica do dia anterior.
    if (limparAntes) {
      if (!saldoDiaAnterior && !saldoAnteriorDiaAnterior && saldoInicialAntesLimpeza) {
        await conn.query(
          `DELETE FROM financeiro_geral
           WHERE empresa_id = ? AND data_lancamento BETWEEN ? AND ? AND id <> ?`,
          [empresa, diaSaldoInicial, fim, Number(saldoInicialAntesLimpeza.id)]
        )
      } else {
        await conn.query(
          `DELETE FROM financeiro_geral
           WHERE empresa_id = ? AND data_lancamento BETWEEN ? AND ?`,
          [empresa, diaSaldoInicial, fim]
        )
      }
    }

    // Ao recriar, reposiciona o próximo identificador exatamente após o maior id
    // ainda existente. Isso evita saltos herdados de registros apagados.
    if (limparAntes) {
      const [[sequencia]] = await conn.query(
        `SELECT COALESCE(MAX(id), 0) + 1 AS proximo_id FROM financeiro_geral`
      )
      const proximoId = Math.max(1, Number(sequencia?.proximo_id || 1))
      await conn.query(`ALTER TABLE financeiro_geral AUTO_INCREMENT = ${proximoId}`)
    }

    const mapeamentos = await carregarMapeamentos(conn, empresa)
    if (!mapeamentos.size) throw new Error('Nenhuma conta financeira está vinculada aos campos conta01 a conta30.')

    const paramsExtratos = [empresa, inicioLancamentos, fim]
    let filtroConta = ''
    if (contaBancariaId) { filtroConta = ' AND e.conta_bancaria_id = ?'; paramsExtratos.push(Number(contaBancariaId)) }
    const [extratos] = await conn.query(
      `SELECT e.id, e.conta_bancaria_id, DATE_FORMAT(e.data_lancamento, '%Y-%m-%d') AS data_lancamento,
              e.descricao_original, e.descricao_normalizada, e.tipo_lancamento, e.valor, e.saldo,
              e.natureza, e.origem, cb.nome_conta, cb.instituicao
       FROM extratos_bancarios e
       INNER JOIN contas_bancarias cb ON cb.id = e.conta_bancaria_id
       WHERE e.empresa_id = ? AND e.data_lancamento BETWEEN ? AND ?${filtroConta}
       ORDER BY e.data_lancamento ASC, e.id ASC`,
      paramsExtratos
    )

    const paramsAnterior = [empresa, inicioLancamentos]
    let filtroAnterior = ''
    if (contaBancariaId) { filtroAnterior = ' AND e.conta_bancaria_id = ?'; paramsAnterior.push(Number(contaBancariaId)) }
    const [anterioresBanco] = await conn.query(
      `SELECT e.id, e.conta_bancaria_id, DATE_FORMAT(e.data_lancamento, '%Y-%m-%d') AS data_lancamento, e.saldo
       FROM extratos_bancarios e
       WHERE e.empresa_id = ? AND e.data_lancamento < ? AND e.saldo IS NOT NULL${filtroAnterior}
       ORDER BY e.data_lancamento DESC, e.id DESC`,
      paramsAnterior
    )

    const [compras] = await conn.query(
      `SELECT c.id, DATE_FORMAT(c.data_emissao, '%Y-%m-%d') AS data_lancamento,
              c.numero_nf, c.preco_pag, c.quant_rec, c.valor_pag,
              pr.nome AS produto, f.nome AS fornecedor
       FROM compras c
       LEFT JOIN produtos pr ON pr.id = c.produto_id
       LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
       WHERE c.empresa_id = ? AND c.data_emissao BETWEEN ? AND ?
       ORDER BY c.data_emissao ASC, c.id ASC`,
      [empresa, inicioLancamentos, fim]
    )

    const [vendas] = await conn.query(
      `SELECT l.id, DATE_FORMAT(l.data_movimento, '%Y-%m-%d') AS data_lancamento,
              l.estoque_abertura, l.quantidade_vendas, l.valor_vendas,
              l.ajuste_quantidade, l.estoque_fechamento, pr.nome AS produto
       FROM lmc_movimentos l
       LEFT JOIN produtos pr ON pr.id = l.produto_id
       WHERE l.empresa_id = ? AND l.data_movimento BETWEEN ? AND ?
       ORDER BY l.data_movimento ASC, l.id ASC`,
      [empresa, inicioLancamentos, fim]
    )

    const vendasCartaoDisponivel = await tabelaExiste(conn, 'vendas_cartao')
    let vendasCartao = []
    if (vendasCartaoDisponivel) {
      const [rowsCartao] = await conn.query(
        `SELECT id, DATE_FORMAT(data_lancamento, '%Y-%m-%d') AS data_venda,
                descricao_original, vendas_bruta, venda_liquida, taxa
         FROM vendas_cartao
         WHERE empresa_id = ? AND status = 'ATIVO'
           AND data_lancamento BETWEEN ? AND ?
         ORDER BY data_lancamento ASC, id ASC`,
        [empresa, dataAnterior(inicioLancamentos), fim]
      )
      vendasCartao = rowsCartao
    }

    // A base do período segue esta ordem:
    // 1) fechamento exatamente do dia anterior; 2) abertura já existente na primeira
    // data; 3) último fechamento histórico anterior.
    let saldoInicialExistente = saldoInicialAntesLimpeza
    if (!saldoInicialExistente) {
      const [saldoInicialExistenteRows] = await conn.query(
        `SELECT * FROM financeiro_geral
         WHERE empresa_id = ? AND data_lancamento = ?
           AND (
             UPPER(TRIM(COALESCE(descricao_normalizada, descricao_original, ''))) LIKE 'SALDO INICIAL DO DIA%'
             OR UPPER(TRIM(COALESCE(descricao_normalizada, descricao_original, ''))) LIKE 'SALDO ANTERIOR%'
           )
         ORDER BY id ASC LIMIT 1`,
        [empresa, diaSaldoInicial]
      )
      saldoInicialExistente = saldoInicialExistenteRows[0] || null
    }
    const baseSaldoInicial = saldoDiaAnterior || saldoAnteriorDiaAnterior || saldoInicialExistente || ultimoSaldoDoDia

    // Saldos bancários anteriores.
    const saldoContas = new Map(Array.from(CAMPOS_CONTAS, (campo) => [campo, 0]))
    const saldosAnterioresEncontrados = new Set()
    for (const row of anterioresBanco) {
      const campo = mapeamentos.get(Number(row.conta_bancaria_id))
      if (campo && !saldosAnterioresEncontrados.has(campo)) {
        saldoContas.set(campo, arred2(row.saldo))
        saldosAnterioresEncontrados.add(campo)
      }
    }
    if (baseSaldoInicial) {
      for (const campo of CAMPOS_CONTAS) saldoContas.set(campo, numero(baseSaldoInicial[campo]))
    }
    const vendaCartaoPorData = new Map()
    for (const row of vendasCartao) {
      const dataVenda = String(row.data_venda).slice(0, 10)
      const acumulado = vendaCartaoPorData.get(dataVenda) || { vendas_bruta: 0, taxa: 0 }
      acumulado.vendas_bruta = arred2(numero(acumulado.vendas_bruta) + numero(row.vendas_bruta))
      acumulado.taxa = arred2(numero(acumulado.taxa) + numero(row.taxa))
      vendaCartaoPorData.set(dataVenda, acumulado)
    }
    const vendaCartaoAbertura = vendaCartaoPorData.get(dataAnterior(inicioLancamentos))
    if (vendaCartaoAbertura) saldoContas.set('conta12', arred2(vendaCartaoAbertura.vendas_bruta))

    // Estoque inicial: quantidade da abertura do primeiro LMC do período e custo da última compra anterior.
    const estoque = new Map(CAMPOS_PRODUTOS.map((p) => [p, { quantidade: 0, medio: 0 }]))
    for (const row of vendas) {
      const p = produtoDestino(row.produto)
      if (p && estoque.get(p).quantidade === 0 && numero(row.estoque_abertura) !== 0) estoque.get(p).quantidade = numero(row.estoque_abertura)
    }
    const [custosAnteriores] = await conn.query(
      `SELECT c.id, c.preco_pag, pr.nome AS produto
       FROM compras c LEFT JOIN produtos pr ON pr.id = c.produto_id
       WHERE c.empresa_id = ? AND c.data_emissao < ?
       ORDER BY c.data_emissao DESC, c.id DESC`,
      [empresa, inicioLancamentos]
    )
    for (const row of custosAnteriores) {
      const p = produtoDestino(row.produto)
      if (p && estoque.get(p).medio === 0 && numero(row.preco_pag) !== 0) estoque.get(p).medio = numero(row.preco_pag)
    }
    if (baseSaldoInicial) {
      for (const p of CAMPOS_PRODUTOS) {
        estoque.get(p).quantidade = numero(baseSaldoInicial[`${p}_quant`])
        estoque.get(p).medio = numero(baseSaldoInicial[`${p}_valor`])
      }
    }

    let inseridos = 0; let atualizados = 0; let ignorados = 0
    const semMapeamento = new Map()
    const contabilizar = (resultado) => { if (resultado === 'inserido') inseridos += 1; else atualizados += 1 }

    // Cria uma única linha de "Saldo anterior" na primeira data somente quando não
    // existe "Saldo do dia" exatamente no dia anterior. Quando esse fechamento existe,
    // ele é usado diretamente e nenhuma abertura duplicada é inserida no período.
    if (dataSaldoAnterior && !saldoDiaAnterior && !saldoAnteriorDiaAnterior) {
      const valores = {}
      for (const [campo, valor] of saldoContas.entries()) valores[campo] = valor
      for (const p of CAMPOS_PRODUTOS) {
        const e = estoque.get(p)
        valores[`${p}_quant`] = e.quantidade
        valores[`${p}_valor`] = e.medio
        valores[`${p}_total`] = e.quantidade * e.medio
      }
      if (saldoInicialExistente) {
        await conn.query(
          `UPDATE financeiro_geral SET descricao_original = 'Saldo anterior',
             descricao_normalizada = 'SALDO ANTERIOR', tipo_lancamento = 'SALDO',
             origem = 'SISTEMA', atualizado_em = NOW() WHERE id = ?`,
          [saldoInicialExistente.id]
        )
        await atualizarCamposLinha(conn, saldoInicialExistente.id, valores)
      } else {
        contabilizar(await gravarLinhaSegura({
          empresa, data: diaSaldoInicial, descricao: 'Saldo anterior', tipo: 'SALDO', origem: 'SISTEMA',
          tabelaOrigem: 'consolidacao', chave: `${empresa}:saldo:${diaSaldoInicial}:inicial`, usuarioId, valores,
        }))
      }
    }

    const extratosPorDia = new Map(); const comprasPorDia = new Map(); const vendasPorDia = new Map()
    const agrupar = (mapa, rows) => rows.forEach((r) => { const d = String(r.data_lancamento).slice(0, 10); if (!mapa.has(d)) mapa.set(d, []); mapa.get(d).push(r) })
    agrupar(extratosPorDia, extratos); agrupar(comprasPorDia, compras); agrupar(vendasPorDia, vendas)

    for (let dia = inicioLancamentos; dia <= fim; dia = proximaData(dia)) {
      const saldoContasInicioDia = new Map(Array.from(CAMPOS_CONTAS, (campo) => [campo, numero(saldoContas.get(campo))]))
      const cartaoDiaAnterior = vendaCartaoPorData.get(dataAnterior(dia)) || null
      // O crédito de vendas no cartão é consolidado exclusivamente a partir do
      // lançamento real existente no extrato SPOT. A tabela vendas_cartao serve
      // apenas como informação auxiliar e não deve criar lançamentos financeiros,
      // evitando duplicidade de Crédito Vendas Cartão e Desconto taxas Cartão.

      const linhasBanco = extratosPorDia.get(dia) || []
      linhasBanco.sort((a, b) => (mapeamentos.get(Number(a.conta_bancaria_id)) || 'conta99').localeCompare(mapeamentos.get(Number(b.conta_bancaria_id)) || 'conta99') || Number(a.id) - Number(b.id))

      for (const row of linhasBanco) {
        const campo = mapeamentos.get(Number(row.conta_bancaria_id))
        if (!campo) { ignorados += 1; semMapeamento.set(Number(row.conta_bancaria_id), row.nome_conta || row.instituicao); continue }
        const saldoCartaoInicial = numero(saldoContas.get('conta12'))
        // Linhas de saldo do PDF/extrato são conferências externas. Elas não podem
        // substituir o acumulado porque não aparecem como movimento no Financeiro Geral.
        if (ehSaldoExtrato(row)) continue
        const valor = numero(row.valor)
        saldoContas.set(campo, arred2(numero(saldoContas.get(campo)) + valor))
        const creditoCartao = campo === 'conta01' && ehCreditoVendasCartao(row)
        const pixRecebidoMaquininha = campo === 'conta01' && ehPixRecebidoMaquininha(row)
        const valoresLinha = { [campo]: valor }
        if (creditoCartao || pixRecebidoMaquininha) {
          valoresLinha.conta12 = -Math.abs(valor)
          saldoContas.set('conta12', arred2(saldoCartaoInicial + valoresLinha.conta12))
        }
        contabilizar(await gravarLinhaSegura({
          empresa, data: dia, descricao: row.descricao_original, tipo: String(row.tipo_lancamento || row.natureza || 'LANÇAMENTO').slice(0, 100),
          origem: origemPermitida(row), tabelaOrigem: 'extratos_bancarios', registroOrigemId: row.id,
          chave: `${empresa}:extratos_bancarios:${row.id}:${campo}`, usuarioId, valores: valoresLinha,
        }))
        if (creditoCartao) {
          const taxaInformada = Math.abs(numero(cartaoDiaAnterior?.taxa))
          const descontoTaxas = taxaInformada > 0
            ? -arred2(taxaInformada)
            : arred2(-(saldoCartaoInicial - Math.abs(valor)))
          saldoContas.set('conta12', arred2(numero(saldoContas.get('conta12')) + descontoTaxas))
          contabilizar(await gravarLinhaSegura({
            empresa, data: dia, descricao: 'Desconto taxas Cartão', tipo: 'TAXA_CARTAO', origem: 'SISTEMA',
            tabelaOrigem: 'extratos_bancarios', registroOrigemId: row.id,
            chave: `${empresa}:extratos_bancarios:${row.id}:taxa-cartao`, usuarioId,
            valores: { conta12: descontoTaxas },
          }))
        }
      }

      // Compras: uma linha por NF/produto e recálculo do preço médio ponderado.
      const comprasDia = (comprasPorDia.get(dia) || []).sort((a, b) => {
        const pa = produtoDestino(a.produto) || 'prod9'; const pb = produtoDestino(b.produto) || 'prod9'
        return pa.localeCompare(pb) || Number(a.id) - Number(b.id)
      })
      for (const row of comprasDia) {
        const p = produtoDestino(row.produto)
        if (!p) { ignorados += 1; continue }
        const q = Math.abs(numero(row.quant_rec))
        const custo = numero(row.preco_pag)
        const totalCompra = numero(row.valor_pag) || q * custo
        const e = estoque.get(p)
        const valorInicial = e.quantidade * e.medio
        const novaQuantidade = e.quantidade + q
        const novoMedio = novaQuantidade !== 0 ? (valorInicial + totalCompra) / novaQuantidade : custo
        const descricao = [row.produto || nomeProduto(p), row.numero_nf ? `NF ${row.numero_nf}` : '', row.fornecedor || ''].filter(Boolean).join(' - ')
        contabilizar(await gravarLinhaSegura({
          empresa, data: dia, descricao, tipo: 'COMPRA', origem: 'COMPRAS', tabelaOrigem: 'compras', registroOrigemId: row.id,
          chave: `${empresa}:compras:${row.id}:${p}`, usuarioId,
          valores: { [`${p}_quant`]: arred6(q), [`${p}_valor`]: arred6(custo), [`${p}_total`]: arred6(totalCompra) },
        }))
        e.quantidade = arred6(novaQuantidade); e.medio = arred6(novoMedio)
      }

      // Vendas: uma linha por produto. O campo valor_vendas da LMC é total diário;
      // o preço unitário é calculado por total / quantidade.
      const lmcDia = (vendasPorDia.get(dia) || []).sort((a, b) => (produtoDestino(a.produto) || 'prod9').localeCompare(produtoDestino(b.produto) || 'prod9') || Number(a.id) - Number(b.id))
      const ajustes = {}; const resultados = {}
      let totalVendasDia = 0
      for (const row of lmcDia) {
        const p = produtoDestino(row.produto)
        if (!p) { ignorados += 1; continue }
        const vendida = Math.abs(numero(row.quantidade_vendas))
        const totalVenda = Math.abs(numero(row.valor_vendas))
        const precoVenda = vendida > 0 ? totalVenda / vendida : 0
        const e = estoque.get(p)
        const medioDia = e.medio
        if (vendida > 0) {
          contabilizar(await gravarLinhaSegura({
            empresa, data: dia, descricao: `Venda de ${nomeProduto(p)}`, tipo: 'VENDA', origem: 'LMC', tabelaOrigem: 'lmc_movimentos', registroOrigemId: row.id,
            chave: `${empresa}:lmc:${row.id}:${p}:venda`, usuarioId,
            valores: {
              [`${p}_quant`]: -vendida,
              [`${p}_valor`]: precoVenda,
              [`${p}_total`]: -vendida * precoVenda,
              conta13: totalVenda,
            },
          }))
          saldoContas.set('conta13', arred2(numero(saldoContas.get('conta13')) + totalVenda))

          totalVendasDia = arred2(totalVendasDia + totalVenda)

          e.quantidade -= vendida
          resultados[`${p}_total`] = arred2((resultados[`${p}_total`] || 0) + vendida * (precoVenda - medioDia))
        }
        const ajuste = numero(row.ajuste_quantidade)
        if (ajuste !== 0) {
          ajustes[`${p}_quant`] = arred2((ajustes[`${p}_quant`] || 0) + ajuste)
          ajustes[`${p}_valor`] = arred2(medioDia)
          ajustes[`${p}_total`] = arred2((ajustes[`${p}_total`] || 0) + ajuste * medioDia)
          e.quantidade += ajuste
        }
      }

      // Elimina qualquer separação antiga ou duplicada do dia antes de gravar a linha correta.
      await conn.query(
        `DELETE FROM financeiro_geral
         WHERE empresa_id = ? AND data_lancamento = ? AND status = 'ATIVO'
           AND (
             tipo_lancamento = 'SEPARACAO_VENDAS'
             OR UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE 'SEPARA%Ç%O%CART%O%'
             OR UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE 'SEPARACAO%CARTAO%'
           )`,
        [empresa, dia]
      )

      if (totalVendasDia !== 0) {
        // A partir de 05/09/2025, a separação do próprio dia recebe a venda bruta
        // de cartão como entrada positiva. Esse valor compõe o saldo de Cartão do dia
        // e será liquidado pelas linhas Crédito/Taxa no bloco do dia seguinte.
        const vendaCartaoDoDia = dia >= '2025-09-05' ? vendaCartaoPorData.get(dia) : null
        const valorCartao = vendaCartaoDoDia ? Math.abs(arred2(vendaCartaoDoDia.vendas_bruta)) : 0
        const valorCaixa = arred2(totalVendasDia - valorCartao)
        contabilizar(await gravarLinhaSegura({
          empresa, data: dia, descricao: 'Separação Vendas Cartão/dinheiro/etc', tipo: 'SEPARACAO_VENDAS', origem: 'SISTEMA',
          tabelaOrigem: 'lmc_movimentos', registroOrigemId: null,
          chave: `${empresa}:lmc:${dia}:separacao-vendas`, usuarioId,
          valores: { conta13: -totalVendasDia, conta12: valorCartao, conta11: valorCaixa },
        }))
        saldoContas.set('conta13', arred2(numero(saldoContas.get('conta13')) - totalVendasDia))
        saldoContas.set('conta12', arred2(numero(saldoContas.get('conta12')) + valorCartao))
        saldoContas.set('conta11', arred2(numero(saldoContas.get('conta11')) + valorCaixa))
      }

      if (Object.keys(ajustes).length) {
        contabilizar(await gravarLinhaSegura({
          empresa, data: dia, descricao: 'Ajuste de saldo e valor estoque diário', tipo: 'AJUSTE', origem: 'LMC', tabelaOrigem: 'lmc_movimentos',
          chave: `${empresa}:lmc:${dia}:ajuste-estoque`, usuarioId, valores: ajustes,
        }))
      }
      if (Object.keys(resultados).length) {
        contabilizar(await gravarLinhaSegura({
          empresa, data: dia, descricao: 'Resultado líquido do produto', tipo: 'RESULTADO', origem: 'LMC', tabelaOrigem: 'lmc_movimentos',
          chave: `${empresa}:lmc:${dia}:resultado-produto`, usuarioId, valores: resultados,
        }))
      }

      // Linha única ao final de cada dia. O fechamento das contas é reconstruído
      // pelas linhas efetivamente gravadas, incluindo a Separação no Caixa.
      const somasContasSql = Array.from(CAMPOS_CONTAS, (campo) => `COALESCE(SUM(${campo}), 0) AS ${campo}`).join(', ')
      const [[movimentosContasDia]] = await conn.query(
        `SELECT ${somasContasSql}
           FROM financeiro_geral
          WHERE empresa_id = ? AND data_lancamento = ? AND status = 'ATIVO'
            AND tipo_lancamento <> 'SALDO'`,
        [empresa, dia]
      )
      for (const campo of CAMPOS_CONTAS) {
        saldoContas.set(campo, arred2(numero(saldoContasInicioDia.get(campo)) + numero(movimentosContasDia?.[campo])))
      }

      const valoresSaldo = {}
      for (const [campo, valor] of saldoContas.entries()) valoresSaldo[campo] = arred2(valor)
      for (const p of CAMPOS_PRODUTOS) {
        const e = estoque.get(p)
        valoresSaldo[`${p}_quant`] = e.quantidade
        valoresSaldo[`${p}_valor`] = e.medio
        valoresSaldo[`${p}_total`] = arred6(e.quantidade * e.medio)
      }
      contabilizar(await gravarLinhaSegura({
        empresa, data: dia, descricao: 'Saldo do dia', tipo: 'SALDO', origem: 'SISTEMA', tabelaOrigem: 'consolidacao',
        chave: `${empresa}:saldo:${dia}:dia`, usuarioId, valores: valoresSaldo,
      }))
    }

    await conn.commit()
    return {
      periodo: { dataInicial: inicio, dataFinal: fim },
      encontrados: { extratos: extratos.length, compras: compras.length, vendas: vendas.length, vendasCartao: vendasCartao.length },
      inseridos, atualizados, ignorados,
      contasSemMapeamento: Array.from(semMapeamento, ([id, nome]) => ({ id, nome })),
    }
  } catch (error) {
    await conn.rollback().catch(() => {})
    throw error
  } finally {
    conn.release()
  }
}


function valoresLinhaSaldo(row) {
  const valores = {}
  for (const campo of CAMPOS_CONTAS) valores[campo] = numero(row?.[campo])
  for (const p of CAMPOS_PRODUTOS) {
    valores[`${p}_quant`] = numero(row?.[`${p}_quant`])
    valores[`${p}_valor`] = numero(row?.[`${p}_valor`])
    valores[`${p}_total`] = numero(row?.[`${p}_total`])
  }
  return valores
}

async function atualizarCamposLinha(conn, id, valores) {
  const permitidos = new Set([
    ...CAMPOS_CONTAS,
    ...CAMPOS_PRODUTOS.flatMap((p) => [`${p}_quant`, `${p}_valor`, `${p}_total`]),
  ])
  const dados = Object.fromEntries(Object.entries(valores).filter(([k]) => permitidos.has(k)))
  const campos = Object.keys(dados)
  if (!campos.length) return
  const total = calcularTotal(dados)
  await conn.query(
    `UPDATE financeiro_geral SET ${campos.map((c) => `${c} = ?`).join(', ')}, total = ?, atualizado_em = NOW() WHERE id = ?`,
    [...campos.map((c) => arred6(dados[c])), total, id]
  )
}

export async function recalcularFinanceiroGeralAPartirDe({ empresaId, dataInicial, usuarioId = null }) {
  const conn = await db.getConnection()
  try {
    const empresa = Number(empresaId)
    const inicio = dataIsoValida(dataInicial, 'Data inicial do recálculo')
    await conn.beginTransaction()

    // O recálculo é uma rotina independente da consolidação. Por isso precisa de
    // sua própria função de gravação no mesmo escopo, evitando ReferenceError ao
    // salvar uma linha e recalcular os saldos seguintes.
    const gravarLinhaSegura = async (dadosLinha) => gravarLinha(conn, dadosLinha)

    const [[limite]] = await conn.query(
      `SELECT DATE_FORMAT(MAX(data_lancamento), '%Y-%m-%d') AS data_final
       FROM financeiro_geral WHERE empresa_id = ? AND status = 'ATIVO'`,
      [empresa]
    )
    const fim = limite?.data_final
    if (!fim || inicio > fim) { await conn.commit(); return { dataInicial: inicio, dataFinal: fim || inicio, dias: 0 } }

    const [saldosAnteriores] = await conn.query(
      `SELECT * FROM financeiro_geral
       WHERE empresa_id = ? AND status = 'ATIVO' AND tipo_lancamento = 'SALDO'
         AND (
           data_lancamento < ?
           OR (
             data_lancamento = ?
             AND UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE 'SALDO INICIAL DO DIA%'
           )
         )
       ORDER BY data_lancamento DESC,
         CASE WHEN UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE 'SALDO INICIAL DO DIA%' THEN 0 ELSE 1 END,
         id DESC
       LIMIT 1`,
      [empresa, inicio, inicio]
    )
    const base = saldosAnteriores[0] || {}
    const saldoContas = new Map(Array.from(CAMPOS_CONTAS, (campo) => [campo, numero(base[campo])]))
    const estoque = new Map(CAMPOS_PRODUTOS.map((p) => [p, {
      quantidade: numero(base[`${p}_quant`]),
      medio: numero(base[`${p}_valor`]),
    }]))

    const [rows] = await conn.query(
      `SELECT *, DATE_FORMAT(data_lancamento, '%Y-%m-%d') AS data_iso
       FROM financeiro_geral
       WHERE empresa_id = ? AND status = 'ATIVO' AND data_lancamento BETWEEN ? AND ?
       ORDER BY data_lancamento ASC,
         CASE tipo_lancamento WHEN 'COMPRA' THEN 10 WHEN 'VENDA' THEN 20 WHEN 'SEPARACAO_VENDAS' THEN 25 WHEN 'AJUSTE' THEN 30 WHEN 'RESULTADO' THEN 40 WHEN 'SALDO' THEN 90 ELSE 5 END,
         id ASC`,
      [empresa, inicio, fim]
    )
    const porDia = new Map()
    for (const row of rows) {
      const dia = row.data_iso
      if (!porDia.has(dia)) porDia.set(dia, [])
      porDia.get(dia).push(row)
    }

    let dias = 0
    for (let dia = inicio; dia <= fim; dia = proximaData(dia)) {
      dias += 1
      const linhasOriginais = porDia.get(dia) || []
      const legadosCartao = linhasOriginais.filter(ehLancamentoCartaoSinteticoLegado)
      for (const legado of legadosCartao) {
        await conn.query('DELETE FROM financeiro_geral WHERE id = ?', [legado.id])
      }
      const linhas = linhasOriginais.filter((r) => !ehLancamentoCartaoSinteticoLegado(r))
      const ajustesRows = linhas.filter((r) => r.tipo_lancamento === 'AJUSTE')
      const resultadoRows = linhas.filter((r) => r.tipo_lancamento === 'RESULTADO')
      const saldoInicialRows = linhas.filter((r) => r.tipo_lancamento === 'SALDO' && ehSaldoInicialLinha(r))
      const saldosRows = linhas.filter((r) => r.tipo_lancamento === 'SALDO' && !ehSaldoInicialLinha(r))
      const resultados = {}
      const separacoesExistentes = linhas.filter(ehSeparacaoVendas)
      // Prioriza a única linha que efetivamente possui Caixa, Cartão ou Vendas.
      const separacaoExistenteDia = separacoesExistentes.find(separacaoTemValores) || separacoesExistentes[0] || null
      // Remove todas as separações antigas do dia e recria somente uma linha consolidada,
      // preservando o valor de Cartão informado na primeira linha existente.
      for (const separacao of separacoesExistentes) {
        await conn.query('DELETE FROM financeiro_geral WHERE id = ?', [separacao.id])
      }
      let totalVendasDia = 0

      // Se houver uma abertura explícita neste dia, ela é a base do próprio dia e nunca
      // pode ser transformada em "Saldo do dia" durante o recálculo.
      if (saldoInicialRows.length) {
        const abertura = saldoInicialRows[0]
        for (const campo of CAMPOS_CONTAS) saldoContas.set(campo, arred6(abertura[campo]))
        for (const p of CAMPOS_PRODUTOS) {
          const e = estoque.get(p)
          e.quantidade = numero(abertura[`${p}_quant`])
          e.medio = numero(abertura[`${p}_valor`])
        }
      }

      // Guarda a abertura efetiva do dia. No fechamento, os saldos das contas
      // serão reconstruídos pela soma das linhas realmente gravadas, evitando que
      // qualquer lançamento (inclusive Separação Cartão/Outros no Caixa) fique de fora.
      const saldoContasInicioDia = new Map(Array.from(CAMPOS_CONTAS, (campo) => [campo, numero(saldoContas.get(campo))]))

      // Mantém somente uma taxa real do Sistema. Taxas sintéticas antigas,
      // originadas em VENDAS_CARTAO, já foram removidas acima.
      const taxasCartao = linhas.filter((r) => String(r.tipo_lancamento) === 'TAXA_CARTAO')
      const taxaCartaoDia = taxasCartao.find((r) => normalizarTexto(r.origem) === 'SISTEMA') || taxasCartao[0] || null
      for (const taxaExtra of taxasCartao) {
        if (!taxaCartaoDia || Number(taxaExtra.id) !== Number(taxaCartaoDia.id)) {
          await conn.query('DELETE FROM financeiro_geral WHERE id = ?', [taxaExtra.id])
        }
      }

      for (const row of linhas) {
        if (['SALDO', 'AJUSTE', 'RESULTADO'].includes(String(row.tipo_lancamento))) continue
        if (String(row.tipo_lancamento) === 'TAXA_CARTAO' && (!taxaCartaoDia || Number(row.id) !== Number(taxaCartaoDia.id))) continue
        if (ehSeparacaoVendas(row)) continue
        const creditoCartao = ehCreditoVendasCartao(row) && numero(row.conta01) !== 0
        const tarifaPixRecebido = ehTarifaPixRecebidoMaquininha(row)
        const saldoCartaoInicial = numero(saldoContas.get('conta12'))
        // A tarifa de Pix recebido pela maquininha pertence somente à conta SPOT.
        // Zera explicitamente Cartão para corrigir também lançamentos antigos já gravados.
        if (tarifaPixRecebido && numero(row.conta12) !== 0) {
          row.conta12 = 0
          await atualizarCamposLinha(conn, row.id, { conta12: 0 })
        }
        if (creditoCartao) {
          const valorSpot = numero(row.conta01)
          row.conta12 = -Math.abs(valorSpot)
          await atualizarCamposLinha(conn, row.id, { conta01: valorSpot, conta12: row.conta12 })
        }
        for (const campo of CAMPOS_CONTAS) saldoContas.set(campo, arred2(numero(saldoContas.get(campo)) + numero(row[campo])))
        if (creditoCartao && !taxaCartaoDia) {
          const descontoTaxas = arred2(-(saldoCartaoInicial - Math.abs(numero(row.conta01))))
          saldoContas.set('conta12', arred2(numero(saldoContas.get('conta12')) + descontoTaxas))
          await gravarLinhaSegura({
            empresa, data: dia, descricao: 'Desconto taxas Cartão', tipo: 'TAXA_CARTAO', origem: 'SISTEMA',
            tabelaOrigem: 'recalculo', registroOrigemId: row.registro_origem_id || row.id,
            chave: `${empresa}:extratos_bancarios:${row.registro_origem_id || row.id}:taxa-cartao`, usuarioId,
            valores: { conta12: descontoTaxas },
          })
        }

        for (const p of CAMPOS_PRODUTOS) {
          const q = numero(row[`${p}_quant`])
          const valor = numero(row[`${p}_valor`])
          if (String(row.tipo_lancamento) === 'COMPRA' && (q !== 0 || valor !== 0)) {
            const totalCompra = arred6(q * valor)
            await atualizarCamposLinha(conn, row.id, { [`${p}_quant`]: q, [`${p}_valor`]: valor, [`${p}_total`]: totalCompra })
            const e = estoque.get(p)
            const quantidadeNova = e.quantidade + q
            e.medio = quantidadeNova !== 0 ? arred6(((e.quantidade * e.medio) + totalCompra) / quantidadeNova) : arred6(valor)
            e.quantidade = arred6(quantidadeNova)
          } else if (String(row.tipo_lancamento) === 'VENDA' && (q !== 0 || valor !== 0)) {
            const totalVendaProduto = arred6(q * valor)
            const totalVenda = arred2(Math.abs(totalVendaProduto))
            await atualizarCamposLinha(conn, row.id, {
              [`${p}_quant`]: q,
              [`${p}_valor`]: valor,
              [`${p}_total`]: totalVendaProduto,
              conta13: totalVenda,
            })
            // A linha já entrou na soma com o valor anteriormente gravado; aplica somente a diferença editada.
            saldoContas.set('conta13', arred2(numero(saldoContas.get('conta13')) + totalVenda - numero(row.conta13)))

            totalVendasDia = arred2(totalVendasDia + totalVenda)

            const e = estoque.get(p)
            resultados[`${p}_total`] = arred2((resultados[`${p}_total`] || 0) + Math.abs(q) * (valor - e.medio))
            e.quantidade = arred6(e.quantidade + q)
          }
        }
      }

      if (totalVendasDia !== 0) {
        const valorCartao = arred2(Math.max(0, numero(separacaoExistenteDia?.conta12)))
        const valorCaixa = arred2(totalVendasDia - valorCartao)
        await gravarLinhaSegura({
          empresa, data: dia, descricao: 'Separação Vendas Cartão/dinheiro/etc', tipo: 'SEPARACAO_VENDAS', origem: 'SISTEMA',
          tabelaOrigem: 'lmc_movimentos', registroOrigemId: null,
          chave: `${empresa}:lmc:${dia}:separacao-vendas`, usuarioId,
          valores: { conta13: -totalVendasDia, conta12: valorCartao, conta11: valorCaixa },
        })
        saldoContas.set('conta13', arred2(numero(saldoContas.get('conta13')) - totalVendasDia))
        saldoContas.set('conta12', arred2(numero(saldoContas.get('conta12')) + valorCartao))
        saldoContas.set('conta11', arred2(numero(saldoContas.get('conta11')) + valorCaixa))
      }
      for (const row of ajustesRows) {
        const valores = {}
        for (const p of CAMPOS_PRODUTOS) {
          const q = arred6(row[`${p}_quant`])
          const e = estoque.get(p)
          valores[`${p}_quant`] = q
          valores[`${p}_valor`] = arred6(e.medio)
          valores[`${p}_total`] = arred6(q * e.medio)
          e.quantidade = arred6(e.quantidade + q)
        }
        await atualizarCamposLinha(conn, row.id, valores)
      }

      if (resultadoRows.length) {
        const principal = resultadoRows[0]
        const valores = {}
        for (const p of CAMPOS_PRODUTOS) valores[`${p}_total`] = arred2(resultados[`${p}_total`] || 0)
        await atualizarCamposLinha(conn, principal.id, valores)
        for (const extra of resultadoRows.slice(1)) await conn.query('DELETE FROM financeiro_geral WHERE id = ?', [extra.id])
      } else if (Object.values(resultados).some((v) => numero(v) !== 0)) {
        await gravarLinhaSegura({
          empresa, data: dia, descricao: 'Resultado líquido do produto', tipo: 'RESULTADO', origem: 'LMC', tabelaOrigem: 'recalculo',
          chave: `${empresa}:lmc:${dia}:resultado-produto`, usuarioId, valores: resultados,
        })
      }

      // Reconstrói o fechamento financeiro usando as linhas visíveis do próprio dia.
      // Regra: saldo anterior/abertura + lançamentos do dia = saldo do dia.
      const somasContasSql = Array.from(CAMPOS_CONTAS, (campo) => `COALESCE(SUM(${campo}), 0) AS ${campo}`).join(', ')
      const [[movimentosContasDia]] = await conn.query(
        `SELECT ${somasContasSql}
           FROM financeiro_geral
          WHERE empresa_id = ? AND data_lancamento = ? AND status = 'ATIVO'
            AND tipo_lancamento <> 'SALDO'`,
        [empresa, dia]
      )
      for (const campo of CAMPOS_CONTAS) {
        saldoContas.set(campo, arred2(numero(saldoContasInicioDia.get(campo)) + numero(movimentosContasDia?.[campo])))
      }

      const valoresSaldo = {}
      for (const campo of CAMPOS_CONTAS) valoresSaldo[campo] = arred2(saldoContas.get(campo))
      for (const p of CAMPOS_PRODUTOS) {
        const e = estoque.get(p)
        valoresSaldo[`${p}_quant`] = numero(e.quantidade)
        valoresSaldo[`${p}_valor`] = numero(e.medio)
        valoresSaldo[`${p}_total`] = arred6(e.quantidade * e.medio)
      }
      if (saldosRows.length) {
        const saldoDia = saldosRows.find(ehSaldoDoDiaLinha) || saldosRows[0]
        await atualizarCamposLinha(conn, saldoDia.id, valoresSaldo)
        await conn.query(
          `UPDATE financeiro_geral
           SET descricao_original = 'Saldo do dia', descricao_normalizada = 'SALDO DO DIA',
               tipo_lancamento = 'SALDO', origem = 'SISTEMA', atualizado_em = NOW()
           WHERE id = ?`,
          [saldoDia.id]
        )
        for (const extra of saldosRows.filter((r) => Number(r.id) !== Number(saldoDia.id))) {
          await conn.query('DELETE FROM financeiro_geral WHERE id = ?', [extra.id])
        }
      } else {
        await gravarLinhaSegura({
          empresa, data: dia, descricao: 'Saldo do dia', tipo: 'SALDO', origem: 'SISTEMA', tabelaOrigem: 'recalculo',
          chave: `${empresa}:saldo:${dia}:dia`, usuarioId, valores: valoresSaldo,
        })
      }
    }

    await conn.commit()
    return { dataInicial: inicio, dataFinal: fim, dias }
  } catch (error) {
    await conn.rollback().catch(() => {})
    throw error
  } finally {
    conn.release()
  }
}
