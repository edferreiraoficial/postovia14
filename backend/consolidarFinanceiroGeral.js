import { db } from './db.js'

const CAMPOS_CONTAS = new Set(Array.from({ length: 30 }, (_, i) => `conta${String(i + 1).padStart(2, '0')}`))
const CAMPOS_PRODUTOS = ['prod1', 'prod2', 'prod3', 'prod4']

const ALIASES_PADRAO = [
  { campo: 'conta03', termos: ['SPOT LUCILA', 'LUCILA'] },
  { campo: 'conta02', termos: ['ITAU', 'ITAÚ'] },
  { campo: 'conta11', termos: ['CAIXA'] },
  { campo: 'conta12', termos: ['VENDAS A PRAZO', 'VENDAS PRAZO'] },
  { campo: 'conta13', termos: ['VENDAS NO CARTAO', 'VENDAS NO CARTÃO', 'VENDAS CARTAO', 'VENDAS CARTÃO', 'CARTAO', 'CARTÃO'] },
  { campo: 'conta14', termos: ['VENDAS TOTAL', 'VENDAS'] },
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


function extrairDataReferenciaCredito(descricao, dataPadrao = null) {
  const texto = String(descricao || '')
  const encontrados = [...texto.matchAll(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/g)]
  if (encontrados.length) {
    const [, d, m, aBruto] = encontrados[encontrados.length - 1]
    const ano = aBruto.length === 2 ? `20${aBruto}` : aBruto
    return `${ano}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return dataPadrao ? dataAnterior(String(dataPadrao).slice(0, 10)) : null
}

function escolherTaxaParaCredito({ credito, diaLancamento, detalhesPorData, usados }) {
  const dataReferencia = extrairDataReferenciaCredito(
    credito?.descricao_original || credito?.descricao_normalizada,
    diaLancamento
  )
  const candidatos = [...(detalhesPorData.get(dataReferencia) || [])]
    .filter((item) => !usados.has(Number(item.id)))
  if (!candidatos.length) return 0

  const valorCredito = Math.abs(numero(credito?.valor ?? credito?.conta01))
  candidatos.sort((a, b) => {
    const difA = Math.abs(Math.abs(numero(a.venda_liquida)) - valorCredito)
    const difB = Math.abs(Math.abs(numero(b.venda_liquida)) - valorCredito)
    return difA - difB || Number(a.id) - Number(b.id)
  })
  const escolhido = candidatos[0]
  usados.add(Number(escolhido.id))
  return arred2(-Math.abs(numero(escolhido.taxa)))
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
  if (ehTarifaPixRecebidoMaquininha(row)) return false
  return descricao.includes('PIX RECEBIDO MAQUININHA')
}

function ordemLancamentoSpot(row) {
  if (ehCreditoVendasCartao(row)) return 1
  if (String(row?.tipo_lancamento || '').toUpperCase() === 'TAXA_CARTAO') return 2
  if (ehPixRecebidoMaquininha(row)) return 3
  if (ehTarifaPixRecebidoMaquininha(row)) return 4
  return 10
}

function ehDepositoDinheiroAtm(row) {
  const descricao = normalizarTexto(row?.descricao_original || row?.descricao_normalizada)
  return descricao === 'DEPOSITO DINHEIRO ATM' || descricao.includes('DEP DIN ATM')
}

function ehPixRecebidoItau(row) {
  const descricao = normalizarTexto(row?.descricao_original || row?.descricao_normalizada)
  return descricao.includes('PIX RECEBIDO') || descricao.includes('PIX RECEB')
}

function ehEntradaItauComSaidaCaixa(row) {
  return ehDepositoDinheiroAtm(row) || ehPixRecebidoItau(row)
}

function ehPixDepositosVendas(row) {
  const descricao = normalizarTexto(row?.descricao_original || row?.descricao_normalizada)
  return descricao.includes('PIX E DEPOSITO') && descricao.includes('VENDAS')
}

function prioridadeColunaLancamento(row, campoMapeado = null) {
  // As quatro linhas especiais pertencem ao bloco SPOT, mesmo quando também
  // movimentam a coluna Cartão.
  if (ehCreditoVendasCartao(row)
      || String(row?.tipo_lancamento || '').toUpperCase() === 'TAXA_CARTAO'
      || ehPixRecebidoMaquininha(row)
      || ehTarifaPixRecebidoMaquininha(row)) return 1

  // Exceção à ordem das colunas: Separação de Vendas deve permanecer no
  // bloco de produtos, mesmo movimentando Caixa, Cartão ou outras contas.
  // Ela será ordenada depois do Resultado e antes do Ajuste de saldo/estoque.
  if (ehSeparacaoVendas(row)) return 9

  // Compras e vendas de produtos precisam permanecer no mesmo bloco de estoque.
  // A venda também movimenta conta14, mas não pode ser classificada antes como
  // lançamento financeiro, pois isso faria a baixa ocorrer antes da compra e do
  // recálculo do custo médio do próprio dia.
  const tipoProduto = String(row?.tipo_lancamento || '').toUpperCase()
  const possuiProduto = CAMPOS_PRODUTOS.some((p) =>
    numero(row?.[`${p}_quant`]) !== 0 || numero(row?.[`${p}_valor`]) !== 0 || numero(row?.[`${p}_total`]) !== 0
  )
  if (possuiProduto || ['COMPRA', 'VENDA', 'AJUSTE', 'RESULTADO'].includes(tipoProduto)) return 9

  const tem = (campo) => campoMapeado === campo || numero(row?.[campo]) !== 0
  if (tem('conta01')) return 1  // SPOT
  if (tem('conta02')) return 2  // ITAÚ
  if (tem('conta03')) return 3  // LUCILA
  if (tem('conta11')) return 4  // CAIXA
  if (tem('conta12')) return 5  // VENDAS A PRAZO
  if (tem('conta13')) return 6  // VENDAS NO CARTÃO
  if (tem('conta14')) return 7  // VENDAS TOTAL
  if (tem('conta21')) return 8  // ERALDO

  const possuiOutraConta = Array.from(CAMPOS_CONTAS).some((campo) => numero(row?.[campo]) !== 0)
  if (possuiOutraConta || (campoMapeado && CAMPOS_CONTAS.has(campoMapeado))) return 8

  return 99
}

function prioridadeInternaLancamento(row, campoMapeado = null) {
  const grupo = prioridadeColunaLancamento(row, campoMapeado)
  if (grupo === 1) return ordemLancamentoSpot(row)
  if (grupo === 2 && ehPixDepositosVendas(row)) return 1

  // Dentro do bloco de produtos, compras devem sempre ser processadas antes
  // das vendas do mesmo dia. Assim o estoque e o custo médio ponderado são
  // atualizados antes de calcular a baixa e o resultado das vendas.
  if (grupo === 9) {
    const tipo = String(row?.tipo_lancamento || '').toUpperCase()
    if (tipo === 'COMPRA') return 1
    if (tipo === 'VENDA') return 2
    if (tipo === 'RESULTADO') return 3
    if (ehSeparacaoVendas(row)) return 4
    if (tipo === 'AJUSTE') return 5
  }
  return 10
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
  return ['conta11', 'conta12', 'conta13', 'conta14'].some((campo) => Math.abs(numero(row?.[campo])) > 0.0000005)
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
    // Créditos liquidados no começo do período podem se referir a vendas de vários
    // dias anteriores (fins de semana, feriados e prazos da adquirente). Carrega uma
    // janela anterior suficiente para localizar cada taxa pela data da descrição.
    if (vendasCartaoDisponivel) {
      const [rowsCartao] = await conn.query(
        `SELECT id, DATE_FORMAT(data_lancamento, '%Y-%m-%d') AS data_venda,
                descricao_original, vendas_bruta, venda_liquida, taxa
         FROM vendas_cartao
         WHERE empresa_id = ? AND status = 'ATIVO'
           AND data_lancamento BETWEEN DATE_SUB(?, INTERVAL 60 DAY) AND ?
         ORDER BY data_lancamento ASC, id ASC`,
        [empresa, inicioLancamentos, fim]
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
    const vendasCartaoDetalhesPorData = new Map()
    for (const row of vendasCartao) {
      const dataVenda = String(row.data_venda).slice(0, 10)
      const acumulado = vendaCartaoPorData.get(dataVenda) || { vendas_bruta: 0, separacao_cartao: 0, taxa: 0 }
      const descricaoCartao = normalizarTexto(row.descricao_original)
      acumulado.vendas_bruta = arred2(numero(acumulado.vendas_bruta) + numero(row.vendas_bruta))

      // A linha de Separação usa somente Vendas Bruta das descrições permitidas
      // no próprio dia: Vendas no Cartão ou Pix recebido maquinin(h)a.
      if (descricaoCartao === 'VENDAS NO CARTAO'
        || descricaoCartao === 'PIX RECEBIDO MAQUININHA'
        || descricaoCartao === 'PIX RECEBIDO MAQUINHINHA') {
        acumulado.separacao_cartao = arred2(numero(acumulado.separacao_cartao) + numero(row.vendas_bruta))
      }

      // A linha "Desconto taxas Cartão" usa somente a taxa registrada na
      // tabela vendas_cartao do dia anterior ao lançamento, quando a descrição
      // for "Vendas no Cartão" ou "Crédito Vendas Cartão".
      if (descricaoCartao === 'VENDAS NO CARTAO' || descricaoCartao === 'CREDITO VENDAS CARTAO') {
        acumulado.taxa = arred2(numero(acumulado.taxa) + numero(row.taxa))
        if (!vendasCartaoDetalhesPorData.has(dataVenda)) vendasCartaoDetalhesPorData.set(dataVenda, [])
        vendasCartaoDetalhesPorData.get(dataVenda).push(row)
      }
      vendaCartaoPorData.set(dataVenda, acumulado)
    }
    // O saldo inicial da coluna Cartão deve vir exclusivamente do último
    // Saldo do dia/Saldo anterior já apurado. A venda bruta do dia anterior,
    // inclusive Pix recebido maquininha, é movimento daquele dia e não pode
    // substituir nem ser somada novamente à abertura do período seguinte.

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
      // O crédito de vendas no cartão é consolidado exclusivamente a partir do
      // lançamento real existente no extrato SPOT. A tabela vendas_cartao serve
      // apenas como informação auxiliar e não deve criar lançamentos financeiros,
      // evitando duplicidade de Crédito Vendas Cartão e Desconto taxas Cartão.

      const linhasBanco = extratosPorDia.get(dia) || []
      linhasBanco.sort((a, b) => {
        const campoA = mapeamentos.get(Number(a.conta_bancaria_id)) || null
        const campoB = mapeamentos.get(Number(b.conta_bancaria_id)) || null
        return prioridadeColunaLancamento(a, campoA) - prioridadeColunaLancamento(b, campoB)
          || prioridadeInternaLancamento(a, campoA) - prioridadeInternaLancamento(b, campoB)
          || Number(a.id) - Number(b.id)
      })

      // A linha Separação Vendas Cartão é obtida exclusivamente da tabela
      // vendas_cartao no próprio dia, somando vendas_bruta das descrições
      // "Vendas no Cartão" e "Pix recebido maquinin(h)a".
      const taxasVendasCartaoUsadas = new Set()
      for (const row of linhasBanco) {
        const campo = mapeamentos.get(Number(row.conta_bancaria_id))
        if (!campo) { ignorados += 1; semMapeamento.set(Number(row.conta_bancaria_id), row.nome_conta || row.instituicao); continue }
        const saldoCartaoInicial = numero(saldoContas.get('conta13'))
        // Linhas de saldo do PDF/extrato são conferências externas. Elas não podem
        // substituir o acumulado porque não aparecem como movimento no Financeiro Geral.
        if (ehSaldoExtrato(row)) continue
        const valor = numero(row.valor)
        saldoContas.set(campo, arred2(numero(saldoContas.get(campo)) + valor))
        const creditoCartao = campo === 'conta01' && ehCreditoVendasCartao(row)
        const pixMaquininha = campo === 'conta01' && ehPixRecebidoMaquininha(row)
        const valoresLinha = { [campo]: valor }
        const entradaItauComSaidaCaixa = campo === 'conta02' && valor > 0 && ehEntradaItauComSaidaCaixa(row)
        if (entradaItauComSaidaCaixa) {
          // Depósito dinheiro ATM e Pix recebido no Itaú representam entrada no
          // banco e saída do Caixa no mesmo valor.
          valoresLinha.conta11 = -Math.abs(valor)
          saldoContas.set('conta11', arred2(numero(saldoContas.get('conta11')) + valoresLinha.conta11))
        }
        if (creditoCartao) {
          // Crédito vendas cartão é um movimento: replica o valor do SPOT
          // na coluna Cartão com sinal negativo.
          valoresLinha.conta13 = -Math.abs(valor)
          saldoContas.set('conta13', arred2(saldoCartaoInicial + valoresLinha.conta13))
        } else if (pixMaquininha) {
          valoresLinha.conta13 = -Math.abs(valor)
          saldoContas.set('conta13', arred2(saldoCartaoInicial + valoresLinha.conta13))
        }
        contabilizar(await gravarLinhaSegura({
          empresa, data: dia, descricao: row.descricao_original, tipo: String(row.tipo_lancamento || row.natureza || 'LANÇAMENTO').slice(0, 100),
          origem: origemPermitida(row), tabelaOrigem: 'extratos_bancarios', registroOrigemId: row.id,
          chave: `${empresa}:extratos_bancarios:${row.id}:${campo}`, usuarioId, valores: valoresLinha,
        }))
        if (creditoCartao) {
          // A taxa vem exclusivamente da tabela vendas_cartao, referente ao dia
          // anterior ao lançamento e às descrições "Vendas no Cartão" ou
          // "Crédito Vendas Cartão". O valor é lançado negativamente em Cartão.
          const descontoTaxas = escolherTaxaParaCredito({
            credito: row,
            diaLancamento: dia,
            detalhesPorData: vendasCartaoDetalhesPorData,
            usados: taxasVendasCartaoUsadas,
          })
          saldoContas.set('conta13', arred2(numero(saldoContas.get('conta13')) + descontoTaxas))
          contabilizar(await gravarLinhaSegura({
            empresa, data: dia, descricao: 'Desconto taxas Cartão', tipo: 'TAXA_CARTAO', origem: 'SISTEMA',
            tabelaOrigem: 'extratos_bancarios', registroOrigemId: row.id,
            chave: `${empresa}:extratos_bancarios:${row.id}:taxa-cartao`, usuarioId,
            valores: { conta13: descontoTaxas },
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
              conta14: totalVenda,
            },
          }))
          saldoContas.set('conta14', arred2(numero(saldoContas.get('conta14')) + totalVenda))

          totalVendasDia = arred2(totalVendasDia + totalVenda)

          e.quantidade -= vendida
          resultados[`${p}_total`] = arred2((resultados[`${p}_total`] || 0) + vendida * (precoVenda - medioDia))
        }
        const ajuste = numero(row.ajuste_quantidade)
        if (ajuste !== 0) {
          // O ajuste de estoque deve conservar o preço médio real calculado no dia.
          // Não arredondar para duas casas: os campos de produto trabalham com 6 casas.
          const precoMedioDia = arred6(medioDia)
          ajustes[`${p}_quant`] = arred6((ajustes[`${p}_quant`] || 0) + ajuste)
          ajustes[`${p}_valor`] = precoMedioDia
          ajustes[`${p}_total`] = arred6((ajustes[`${p}_total`] || 0) + ajuste * precoMedioDia)
          e.quantidade = arred6(e.quantidade + ajuste)
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
        const vendaCartaoDoDia = vendaCartaoPorData.get(dia)
        const valorCartao = vendaCartaoDoDia ? Math.abs(arred2(vendaCartaoDoDia.separacao_cartao)) : 0

        // VENDAS A PRAZO (conta12): soma somente os movimentos positivos do próprio dia,
        // excluindo saldos e a própria linha de separação para não retroalimentar o cálculo.
        const [[vendasPrazoDia]] = await conn.query(
          `SELECT COALESCE(SUM(CASE WHEN conta12 > 0 THEN conta12 ELSE 0 END), 0) AS total_vendas_prazo
             FROM financeiro_geral
            WHERE empresa_id = ? AND data_lancamento = ? AND status = 'ATIVO'
              AND tipo_lancamento <> 'SALDO'
              AND tipo_lancamento <> 'SEPARACAO_VENDAS'`,
          [empresa, dia]
        )
        const valorVendasPrazo = Math.abs(arred2(vendasPrazoDia?.total_vendas_prazo))

        // Ordem e fórmula da Separação:
        // conta14 = VENDAS TOTAL (negativo), conta13 = VENDAS NO CARTÃO,
        // conta12 = VENDAS A PRAZO e conta11 = CAIXA.
        const valorVendasTotal = -Math.abs(arred2(totalVendasDia))
        const valorCaixa = arred2((-valorVendasTotal) - valorCartao - valorVendasPrazo)
        contabilizar(await gravarLinhaSegura({
          empresa, data: dia, descricao: 'Separação Vendas Cartão/dinheiro/etc', tipo: 'SEPARACAO_VENDAS', origem: 'SISTEMA',
          tabelaOrigem: 'lmc_movimentos', registroOrigemId: null,
          chave: `${empresa}:lmc:${dia}:separacao-vendas`, usuarioId,
          valores: { conta14: valorVendasTotal, conta13: valorCartao, conta12: valorVendasPrazo, conta11: valorCaixa },
        }))
        saldoContas.set('conta14', arred2(numero(saldoContas.get('conta14')) + valorVendasTotal))
        saldoContas.set('conta13', arred2(numero(saldoContas.get('conta13')) + valorCartao))
        // conta12 da linha de Separação é apenas informativa: ela já existe nos lançamentos
        // reais de VENDAS A PRAZO do dia e não deve ser somada novamente ao saldo.
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
      const somasContasSql = Array.from(CAMPOS_CONTAS, (campo) => campo === 'conta12'
        ? `COALESCE(SUM(CASE WHEN tipo_lancamento = 'SEPARACAO_VENDAS' THEN 0 ELSE conta12 END), 0) AS conta12`
        : `COALESCE(SUM(${campo}), 0) AS ${campo}`).join(', ')
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

      // A coluna Cartão possui recálculo independente e estritamente acumulativo:
      // saldo anterior do Cartão + todos os lançamentos ativos do próprio dia = saldo do dia.
      // As descrições de saldo também são excluídas para impedir que linhas antigas ou
      // importadas com tipo incorreto sejam somadas como movimento e dupliquem o fechamento.
      const [[movimentoCartaoDia]] = await conn.query(
        `SELECT COALESCE(SUM(conta13), 0) AS total_cartao
           FROM financeiro_geral
          WHERE empresa_id = ? AND data_lancamento = ? AND status = 'ATIVO'
            AND tipo_lancamento <> 'SALDO'
            AND UPPER(TRIM(COALESCE(descricao_normalizada, descricao_original, ''))) NOT LIKE 'SALDO DO DIA%'
            AND UPPER(TRIM(COALESCE(descricao_normalizada, descricao_original, ''))) NOT LIKE 'SALDO INICIAL DO DIA%'
            AND UPPER(TRIM(COALESCE(descricao_normalizada, descricao_original, ''))) NOT LIKE 'SALDO ANTERIOR%'`,
        [empresa, dia]
      )
      saldoContas.set(
        'conta13',
        arred2(numero(saldoContasInicioDia.get('conta13')) + numero(movimentoCartaoDia?.total_cartao))
      )

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

    // Carrega os registros individualizados de Vendas_Cartão. Além dos totais
    // usados na Separação, preserva cada venda líquida e sua própria taxa para
    // associar corretamente vários créditos lançados no mesmo dia.
    const vendaCartaoPorData = new Map()
    const vendasCartaoDetalhesPorData = new Map()
    if (await tabelaExiste(conn, 'vendas_cartao')) {
      // A atualização de saldos usa a mesma janela retroativa da consolidação,
      // evitando taxas vazias para créditos que referenciam dias anteriores ao período.
      const [vendasCartaoRows] = await conn.query(
        `SELECT id, DATE_FORMAT(data_lancamento, '%Y-%m-%d') AS data_venda,
                descricao_original, vendas_bruta, venda_liquida, taxa
           FROM vendas_cartao
          WHERE empresa_id = ? AND status = 'ATIVO'
            AND data_lancamento BETWEEN DATE_SUB(?, INTERVAL 60 DAY) AND ?
          ORDER BY data_lancamento ASC, id ASC`,
        [empresa, inicio, fim]
      )
      for (const row of vendasCartaoRows) {
        const dataVenda = String(row.data_venda).slice(0, 10)
        const descricaoCartao = normalizarTexto(row.descricao_original)
        const acumulado = vendaCartaoPorData.get(dataVenda) || { vendas_bruta: 0, separacao_cartao: 0, taxa: 0 }
        acumulado.vendas_bruta = arred2(numero(acumulado.vendas_bruta) + numero(row.vendas_bruta))
        if (['VENDAS NO CARTAO', 'PIX RECEBIDO MAQUININHA', 'PIX RECEBIDO MAQUINHINHA'].includes(descricaoCartao)) {
          acumulado.separacao_cartao = arred2(numero(acumulado.separacao_cartao) + numero(row.vendas_bruta))
        }
        if (['VENDAS NO CARTAO', 'CREDITO VENDAS CARTAO'].includes(descricaoCartao)) {
          acumulado.taxa = arred2(numero(acumulado.taxa) + numero(row.taxa))
          if (!vendasCartaoDetalhesPorData.has(dataVenda)) vendasCartaoDetalhesPorData.set(dataVenda, [])
          vendasCartaoDetalhesPorData.get(dataVenda).push(row)
        }
        vendaCartaoPorData.set(dataVenda, acumulado)
      }
    }

    // O saldo inicial de todas as contas, inclusive Cartão, vem exclusivamente
    // do último fechamento anterior ou da linha "Saldo anterior" existente na
    // própria data inicial. A venda bruta da tabela vendas_cartao é movimento do
    // dia e nunca deve substituir o saldo de abertura.

    const [rows] = await conn.query(
      `SELECT *, DATE_FORMAT(data_lancamento, '%Y-%m-%d') AS data_iso
       FROM financeiro_geral
       WHERE empresa_id = ? AND status = 'ATIVO' AND data_lancamento BETWEEN ? AND ?
       ORDER BY data_lancamento ASC,
         CASE tipo_lancamento WHEN 'COMPRA' THEN 10 WHEN 'VENDA' THEN 20 WHEN 'RESULTADO' THEN 30 WHEN 'SEPARACAO_VENDAS' THEN 40 WHEN 'AJUSTE' THEN 50 WHEN 'SALDO' THEN 90 ELSE 5 END,
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
      const taxasVendasCartaoUsadas = new Set()

      // A linha de abertura só pode definir a base no primeiro dia solicitado.
      // Nos dias seguintes, a abertura deve ser obrigatoriamente o "Saldo do dia"
      // recalculado do dia anterior, garantindo a propagação após inclusão,
      // alteração ou exclusão até o último dia com lançamentos.
      if (dia === inicio && saldoInicialRows.length) {
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

      // Mantém uma taxa individual para cada Crédito Vendas Cartão, vinculada
      // pelo registro de origem do crédito. Taxas órfãs ou duplicadas são removidas.
      const taxasCartao = linhas.filter((r) => String(r.tipo_lancamento) === 'TAXA_CARTAO')
      const taxaCartaoPorCredito = new Map()
      for (const taxa of taxasCartao) {
        const chaveCredito = Number(taxa.registro_origem_id || 0)
        if (chaveCredito && !taxaCartaoPorCredito.has(chaveCredito)) taxaCartaoPorCredito.set(chaveCredito, taxa)
        else await conn.query('DELETE FROM financeiro_geral WHERE id = ?', [taxa.id])
      }

      const linhasOrdenadas = [...linhas].sort((a, b) =>
        prioridadeColunaLancamento(a) - prioridadeColunaLancamento(b)
        || prioridadeInternaLancamento(a) - prioridadeInternaLancamento(b)
        || Number(a.id) - Number(b.id)
      )

      for (const row of linhasOrdenadas) {
        if (['SALDO', 'AJUSTE', 'RESULTADO', 'TAXA_CARTAO'].includes(String(row.tipo_lancamento))) continue
        if (ehSeparacaoVendas(row)) continue
        const creditoCartao = ehCreditoVendasCartao(row) && numero(row.conta01) !== 0
        const pixMaquininha = ehPixRecebidoMaquininha(row) && numero(row.conta01) !== 0
        const tarifaPixRecebido = ehTarifaPixRecebidoMaquininha(row)
        const entradaItauComSaidaCaixa = numero(row.conta02) > 0 && ehEntradaItauComSaidaCaixa(row)
        if (entradaItauComSaidaCaixa) {
          const caixaCorreto = -Math.abs(numero(row.conta02))
          if (arred2(row.conta11) !== arred2(caixaCorreto)) {
            row.conta11 = caixaCorreto
            await atualizarCamposLinha(conn, row.id, { conta11: caixaCorreto })
          }
        }
        // A tarifa pertence somente ao SPOT. Crédito de cartão e Pix recebido
        // pela maquininha são replicados em Cartão com o mesmo valor negativo.
        if (tarifaPixRecebido && numero(row.conta13) !== 0) {
          row.conta13 = 0
          await atualizarCamposLinha(conn, row.id, { conta13: 0 })
        }
        if (creditoCartao) {
          const valorSpot = numero(row.conta01)
          const saldoCartaoAntesCredito = numero(saldoContas.get('conta13'))
          // Crédito vendas cartão é um movimento negativo na coluna Cartão,
          // exatamente igual ao valor positivo lançado no SPOT.
          row.conta13 = -Math.abs(valorSpot)
          await atualizarCamposLinha(conn, row.id, { conta01: valorSpot, conta13: row.conta13 })
          for (const campo of CAMPOS_CONTAS) {
            saldoContas.set(campo, arred2(numero(saldoContas.get(campo)) + numero(row[campo])))
          }
          // Guarda na própria linha o saldo imediatamente anterior ao crédito,
          // que será a única base do cálculo da linha Desconto taxas Cartão.
          row.__saldoCartaoAntesCredito = saldoCartaoAntesCredito
        } else {
          if (pixMaquininha) {
            const valorSpot = numero(row.conta01)
            row.conta13 = -Math.abs(valorSpot)
            await atualizarCamposLinha(conn, row.id, { conta01: valorSpot, conta13: row.conta13 })
          }
          for (const campo of CAMPOS_CONTAS) saldoContas.set(campo, arred2(numero(saldoContas.get(campo)) + numero(row[campo])))
        }
        if (creditoCartao) {
          const idCreditoOrigem = Number(row.registro_origem_id || row.id)
          const descontoTaxas = escolherTaxaParaCredito({
            credito: row,
            diaLancamento: dia,
            detalhesPorData: vendasCartaoDetalhesPorData,
            usados: taxasVendasCartaoUsadas,
          })
          const taxaExistente = taxaCartaoPorCredito.get(idCreditoOrigem)
          if (taxaExistente) {
            taxaExistente.conta13 = descontoTaxas
            await atualizarCamposLinha(conn, taxaExistente.id, { conta13: descontoTaxas })
          } else if (descontoTaxas !== 0) {
            await gravarLinhaSegura({
              empresa, data: dia, descricao: 'Desconto taxas Cartão', tipo: 'TAXA_CARTAO', origem: 'SISTEMA',
              tabelaOrigem: 'extratos_bancarios', registroOrigemId: idCreditoOrigem,
              chave: `${empresa}:extratos_bancarios:${idCreditoOrigem}:taxa-cartao`, usuarioId,
              valores: { conta13: descontoTaxas },
            })
          }
          saldoContas.set('conta13', arred2(numero(saldoContas.get('conta13')) + descontoTaxas))
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
              conta14: totalVenda,
            })
            // A linha já entrou na soma com o valor anteriormente gravado; aplica somente a diferença editada.
            saldoContas.set('conta14', arred2(numero(saldoContas.get('conta14')) + totalVenda - numero(row.conta14)))

            totalVendasDia = arred2(totalVendasDia + totalVenda)

            const e = estoque.get(p)
            resultados[`${p}_total`] = arred2((resultados[`${p}_total`] || 0) + Math.abs(q) * (valor - e.medio))
            e.quantidade = arred6(e.quantidade + q)
          }
        }
      }

      if (totalVendasDia !== 0) {
        // Usa exclusivamente a soma de vendas_bruta da tabela vendas_cartao
        // para as descrições permitidas no próprio dia.
        const valorCartao = Math.abs(numero(vendaCartaoPorData.get(dia)?.separacao_cartao))
        const [[vendasPrazoDia]] = await conn.query(
          `SELECT COALESCE(SUM(CASE WHEN conta12 > 0 THEN conta12 ELSE 0 END), 0) AS total_vendas_prazo
             FROM financeiro_geral
            WHERE empresa_id = ? AND data_lancamento = ? AND status = 'ATIVO'
              AND tipo_lancamento <> 'SALDO'
              AND tipo_lancamento <> 'SEPARACAO_VENDAS'`,
          [empresa, dia]
        )
        const valorVendasPrazo = Math.abs(arred2(vendasPrazoDia?.total_vendas_prazo))
        const valorVendasTotal = -Math.abs(arred2(totalVendasDia))
        const valorCaixa = arred2((-valorVendasTotal) - valorCartao - valorVendasPrazo)
        await gravarLinhaSegura({
          empresa, data: dia, descricao: 'Separação Vendas Cartão/dinheiro/etc', tipo: 'SEPARACAO_VENDAS', origem: 'SISTEMA',
          tabelaOrigem: 'lmc_movimentos', registroOrigemId: null,
          chave: `${empresa}:lmc:${dia}:separacao-vendas`, usuarioId,
          valores: { conta14: valorVendasTotal, conta13: valorCartao, conta12: valorVendasPrazo, conta11: valorCaixa },
        })
        saldoContas.set('conta14', arred2(numero(saldoContas.get('conta14')) + valorVendasTotal))
        saldoContas.set('conta13', arred2(numero(saldoContas.get('conta13')) + valorCartao))
        // conta12 da linha de Separação é apenas informativa: ela já existe nos lançamentos
        // reais de VENDAS A PRAZO do dia e não deve ser somada novamente ao saldo.
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
      const somasContasSql = Array.from(CAMPOS_CONTAS, (campo) => campo === 'conta12'
        ? `COALESCE(SUM(CASE WHEN tipo_lancamento = 'SEPARACAO_VENDAS' THEN 0 ELSE conta12 END), 0) AS conta12`
        : `COALESCE(SUM(${campo}), 0) AS ${campo}`).join(', ')
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
