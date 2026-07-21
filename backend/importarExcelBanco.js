import ExcelJS from 'exceljs'
import { db } from './db.js'
import {
  obterEmpresaPadrao,
  salvarComprasNoBanco,
  salvarExtratosBanco,
  salvarLmcNoBanco,
  dataBrParaSql,
} from './services/BancoService.js'

const HEADER_ALIASES = {
  data: ['data'],
  descricao: ['descrição', 'descricao', 'descrição do lançamento', 'descricao do lançamento'],
  valor: ['valor'],
  saldo: ['saldo'],
  dataMovim: ['data movim.', 'data movim', 'dat. mov.', 'dat mov', 'data movimento'],
  dataEmissao: ['data emissão', 'data emissao', 'dat. emissão', 'dat. emissao', 'data emissao'],
  produto: ['produto'],
  fornecedor: ['fornecedor'],
  nf: ['nº nf', 'n° nf', 'no nf', 'numero nf', 'número nf', 'nf'],
  custo: ['custo', 'custo (r$)'],
  quantidade: ['quantidade', 'qtde (lts)', 'qtde', 'quant vendas'],
  valorTotal: ['valor total', 'valor total(r$)', 'valor total (r$)'],
  quantRec: ['quant. recebida', 'quant recebida', 'quantidade recebida', 'quant_rec'],
  precoPag: ['preço pago', 'preco pago', 'preco_pag'],
  valorPag: ['valor pago', 'valor_pag'],
  abertura: ['abertura'],
  quantVendas: ['quant vendas', 'quant. vendas', 'quantidade vendas'],
  precoVenda: ['preço venda', 'preco venda'],
  valorVendas: ['valor vendas', 'valor de vendas'],
  vendaBruta: ['venda_bruta', 'venda bruta'],
  vendaLiquida: ['venda_liquida', 'venda liquida'],
  taxas: ['taxas', 'taxa'],
  estoqueEsc: ['estoque esc', 'estoque escritural'],
  ajustes: ['ajustes', 'ajuste', 'perdas e ganhos'],
  fechamento: ['fechamento'],
}

function normalizarTexto(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[º°]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function valorCelula(cell) {
  const v = cell?.value
  if (v == null) return ''
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    if ('text' in v) return v.text
    if ('result' in v) return v.result
    if ('richText' in v) return v.richText.map((r) => r.text).join('')
  }
  return v
}

function numeroBR(valor) {
  if (valor == null || valor === '') return 0
  if (typeof valor === 'number') return valor
  if (valor instanceof Date) return 0

  let texto = String(valor)
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .trim()

  if (!texto) return 0

  const negativoParenteses = /^\(.*\)$/.test(texto)
  texto = texto.replace(/[()]/g, '')

  // Remove tudo exceto números, sinal, ponto e vírgula.
  texto = texto.replace(/[^0-9,.-]/g, '')

  const temVirgula = texto.includes(',')
  const temPonto = texto.includes('.')

  if (temVirgula && temPonto) {
    texto = texto.replace(/\./g, '').replace(',', '.')
  } else if (temVirgula) {
    texto = texto.replace(',', '.')
  }

  const n = Number(texto)
  if (Number.isNaN(n)) return 0
  return negativoParenteses ? -Math.abs(n) : n
}

function dataBR(valor) {
  if (!valor) return null

  if (valor instanceof Date) {
    const d = String(valor.getDate()).padStart(2, '0')
    const m = String(valor.getMonth() + 1).padStart(2, '0')
    const y = valor.getFullYear()
    return `${d}/${m}/${y}`
  }

  if (typeof valor === 'number') {
    // Excel serial date: days since 1899-12-30.
    const date = new Date(Math.round((valor - 25569) * 86400 * 1000))
    if (!Number.isNaN(date.getTime())) return dataBR(date)
  }

  const texto = String(valor).trim()
  let m = texto.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/)
  if (m) {
    const dia = m[1].padStart(2, '0')
    const mes = m[2].padStart(2, '0')
    const ano = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${dia}/${mes}/${ano}`
  }

  m = texto.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`

  return null
}

function celulaTexto(ws, rowNumber, colNumber) {
  return valorCelula(ws.getRow(rowNumber).getCell(colNumber))
}

function localizarCabecalho(ws, chavesObrigatorias) {
  for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
    const mapa = {}
    const row = ws.getRow(r)
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const texto = normalizarTexto(valorCelula(cell))
      for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
        if (aliases.map(normalizarTexto).includes(texto)) {
          mapa[key] = col
        }
      }
    })

    const ok = chavesObrigatorias.every((k) => mapa[k])
    if (ok) return { row: r, mapa }
  }

  throw new Error(`Cabeçalho inválido. Colunas obrigatórias não encontradas: ${chavesObrigatorias.join(', ')}.`)
}

function faixaDatasSql(dados, campo = 'data') {
  const datas = dados.map((item) => dataBrParaSql(item[campo])).filter(Boolean).sort()
  if (!datas.length) return null
  return { inicio: datas[0], fim: datas[datas.length - 1] }
}

async function carregarWorkbook(arquivo, nomeTipo) {
  if (!arquivo) return null

  const nome = String(arquivo.originalname || '').toLowerCase()
  if (!nome.endsWith('.xlsx')) {
    throw new Error(`${nomeTipo}: envie um arquivo Excel .xlsx.`)
  }

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(arquivo.buffer)
  return wb
}

function extrairExtratoExcel(wb, banco) {
  if (!wb) return []
  const ws = wb.worksheets[0]
  if (!ws) return []

  const { row: headerRow, mapa } = localizarCabecalho(ws, ['data', 'descricao', 'valor', 'saldo'])
  const lancamentos = []

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const data = dataBR(celulaTexto(ws, r, mapa.data))
    const descricao = String(celulaTexto(ws, r, mapa.descricao) || '').trim()
    if (!data || !descricao) continue

    const valorRaw = celulaTexto(ws, r, mapa.valor)
    const saldoRaw = celulaTexto(ws, r, mapa.saldo)
    const valor = valorRaw === '' || valorRaw == null ? 0 : numeroBR(valorRaw)
    const saldo = saldoRaw === '' || saldoRaw == null ? null : numeroBR(saldoRaw)

    lancamentos.push({
      data,
      descricao,
      valor,
      saldo,
      origem: banco,
    })
  }

  return lancamentos
}

function extrairComprasExcel(wb) {
  if (!wb) return []
  const ws = wb.getWorksheet('COMPRAS') || wb.worksheets[0]
  if (!ws) return []

  const { row: headerRow, mapa } = localizarCabecalho(ws, [
    'dataMovim',
    'dataEmissao',
    'produto',
    'fornecedor',
    'nf',
    'custo',
    'quantidade',
    'valorTotal',
  ])

  const compras = []
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const dataMovimento = dataBR(celulaTexto(ws, r, mapa.dataMovim))
    const dataEmissao = dataBR(celulaTexto(ws, r, mapa.dataEmissao))
    const produto = String(celulaTexto(ws, r, mapa.produto) || '').trim()
    const fornecedor = String(celulaTexto(ws, r, mapa.fornecedor) || '').trim()
    const nf = String(celulaTexto(ws, r, mapa.nf) || '').trim()

    if (!dataMovimento && !dataEmissao && !produto && !fornecedor && !nf) continue
    if (!dataEmissao && !dataMovimento) continue

    const custo = numeroBR(celulaTexto(ws, r, mapa.custo))
    const quantidade = numeroBR(celulaTexto(ws, r, mapa.quantidade))
    const valorTotal = numeroBR(celulaTexto(ws, r, mapa.valorTotal))
    const quantRecInformada = mapa.quantRec ? numeroBR(celulaTexto(ws, r, mapa.quantRec)) : quantidade
    const precoPagInformado = mapa.precoPag ? numeroBR(celulaTexto(ws, r, mapa.precoPag)) : custo
    const valorPagInformado = mapa.valorPag ? numeroBR(celulaTexto(ws, r, mapa.valorPag)) : valorTotal

    compras.push({
      data: dataMovimento || dataEmissao,
      dataEmissao: dataEmissao || dataMovimento,
      produto,
      fornecedor,
      nf,
      quantidade,
      custo,
      valorTotal,
      quantRec: quantRecInformada,
      precoPag: precoPagInformado,
      valorPag: valorPagInformado,
    })
  }

  return compras.sort((a, b) => dataBrParaSql(a.data) < dataBrParaSql(b.data) ? -1 : 1)
}

function extrairLmcExcel(wb) {
  if (!wb) return {}
  const dados = {}

  for (const ws of wb.worksheets) {
    const nomeAba = normalizarTexto(ws.name)
    if (nomeAba.includes('auditoria')) continue

    let header
    try {
      header = localizarCabecalho(ws, [
        'data',
        'produto',
        'abertura',
        'quantVendas',
        'valorVendas',
        'ajustes',
        'fechamento',
      ])
    } catch {
      continue
    }

    const { row: headerRow, mapa } = header
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const data = dataBR(celulaTexto(ws, r, mapa.data))
      const produto = String(celulaTexto(ws, r, mapa.produto) || ws.name || '').trim()
      if (!data || !produto) continue

      const linha = {
        data,
        abertura: numeroBR(celulaTexto(ws, r, mapa.abertura)),
        quantVendas: Math.abs(Number(numeroBR(celulaTexto(ws, r, mapa.quantVendas)) || 0)),
        valorVendas: numeroBR(celulaTexto(ws, r, mapa.valorVendas)),
        ajustes: numeroBR(celulaTexto(ws, r, mapa.ajustes)),
        fechamento: numeroBR(celulaTexto(ws, r, mapa.fechamento)),
      }

      if (!dados[produto]) dados[produto] = []
      dados[produto].push(linha)
    }
  }

  for (const produto of Object.keys(dados)) {
    dados[produto].sort((a, b) => dataBrParaSql(a.data) < dataBrParaSql(b.data) ? -1 : 1)
  }

  return dados
}

function extrairVendasCartaoExcel(wb) {
  if (!wb) return []

  const ws = wb.getWorksheet('Vendas_Cartao') || wb.worksheets[0]
  if (!ws) return []

  const { row: headerRow, mapa } = localizarCabecalho(ws, [
    'data',
    'descricao',
    'vendaBruta',
    'vendaLiquida',
    'taxas',
  ])

  const vendas = []
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const data = dataBR(celulaTexto(ws, r, mapa.data))
    const descricao = String(celulaTexto(ws, r, mapa.descricao) || '').trim()
    if (!data) continue

    const vendaBruta = Math.abs(numeroBR(celulaTexto(ws, r, mapa.vendaBruta)))
    const vendaLiquida = Math.abs(numeroBR(celulaTexto(ws, r, mapa.vendaLiquida)))
    const taxas = Math.abs(numeroBR(celulaTexto(ws, r, mapa.taxas)))
    if (!descricao && !vendaBruta && !vendaLiquida && !taxas) continue

    vendas.push({
      data,
      descricao: descricao || 'Crédito Vendas Cartão',
      vendaBruta,
      vendaLiquida,
      taxas,
    })
  }

  return vendas.sort((a, b) => dataBrParaSql(a.data) < dataBrParaSql(b.data) ? -1 : 1)
}

async function limparPeriodoVendasCartao({ empresaId, vendas }) {
  const faixa = faixaDatasSql(vendas)
  if (!faixa) return 0
  const [resultado] = await db.query(
    `DELETE FROM vendas_cartao
     WHERE empresa_id = ?
       AND data_lancamento BETWEEN ? AND ?`,
    [empresaId, faixa.inicio, faixa.fim]
  )
  return resultado.affectedRows || 0
}

async function salvarVendasCartao({ empresaId, vendas }) {
  let total = 0
  for (const venda of vendas) {
    const dataSql = dataBrParaSql(venda.data)
    const descricaoNormalizada = String(venda.descricao || '').trim().toUpperCase()
    await db.query(
      `INSERT INTO vendas_cartao (
        empresa_id, data_lancamento, descricao_original, descricao_normalizada,
        tipo_lancamento, vendas_bruta, venda_liquida, taxa, status
      ) VALUES (?, ?, ?, ?, 'CREDITO_VENDAS', ?, ?, ?, 'ATIVO')`,
      [
        empresaId, dataSql, venda.descricao, descricaoNormalizada,
        venda.vendaBruta, venda.vendaLiquida, venda.taxas,
      ]
    )
    total++
  }
  return total
}

async function limparPeriodoExtrato({ empresaId, contaBancariaId, origem, lancamentos }) {
  const faixa = faixaDatasSql(lancamentos)
  if (!faixa) return 0
  const [resultado] = await db.query(
    `DELETE FROM extratos_bancarios
     WHERE empresa_id = ?
       AND conta_bancaria_id = ?
       AND data_lancamento BETWEEN ? AND ?`,
    [empresaId, contaBancariaId, faixa.inicio, faixa.fim]
  )
  return resultado.affectedRows || 0
}

async function limparPeriodoCompras(compras) {
  const faixa = faixaDatasSql(compras, 'dataEmissao') || faixaDatasSql(compras, 'data')
  if (!faixa) return 0
  const [resultado] = await db.query(
    `DELETE FROM compras
     WHERE data_emissao BETWEEN ? AND ?`,
    [faixa.inicio, faixa.fim]
  )
  return resultado.affectedRows || 0
}

async function limparPeriodoLmc(dadosLmc) {
  const linhas = Object.values(dadosLmc).flat()
  const faixa = faixaDatasSql(linhas)
  if (!faixa) return 0
  const [resultado] = await db.query(
    `DELETE FROM lmc_movimentos
     WHERE data_movimento BETWEEN ? AND ?`,
    [faixa.inicio, faixa.fim]
  )
  return resultado.affectedRows || 0
}

export async function importarExcelBanco({ arquivoLmc, arquivoCompras, arquivoVendasCartao, arquivoExtrato, contaBancariaId, arquivoSpot, arquivoItau }) {
  const empresa = await obterEmpresaPadrao()
  const resultado = {
    lmc: 0,
    compras: 0,
    extrato: 0,
    vendasCartao: 0,
    contaBancaria: null,
    removidos: {
      lmc: 0,
      compras: 0,
      extrato: 0,
      vendasCartao: 0,
    },
  }

  // Compatibilidade com versões anteriores da tela.
  const arquivoBancario = arquivoExtrato || arquivoItau || arquivoSpot || null
  let contaId = Number(contaBancariaId || 0) || null

  if (arquivoBancario) {
    if (!contaId) {
      // Somente para chamadas antigas: localiza a conta pelo banco recebido.
      const origemLegada = arquivoItau ? 'ITAU' : arquivoSpot ? 'SPOT' : ''
      if (!origemLegada) throw new Error('Selecione a conta bancária que receberá o extrato.')
      const [contasLegadas] = await db.query(
        `SELECT cb.id
         FROM contas_bancarias cb
         WHERE cb.empresa_id = ? AND UPPER(COALESCE(cb.instituicao, cb.nome_conta)) = ?
         ORDER BY cb.id
         LIMIT 1`,
        [empresa.id, origemLegada]
      )
      contaId = contasLegadas[0]?.id || null
    }

    if (!contaId) throw new Error('Selecione uma conta bancária válida.')

    const [contas] = await db.query(
      `SELECT cb.id, cb.nome_conta, cb.instituicao AS banco
       FROM contas_bancarias cb
       WHERE cb.id = ? AND cb.empresa_id = ?
       LIMIT 1`,
      [contaId, empresa.id]
    )
    const conta = contas[0]
    if (!conta) throw new Error('A conta bancária selecionada não foi encontrada para esta empresa.')

    const wb = await carregarWorkbook(arquivoBancario, `Excel ${conta.nome_conta}`)
    const lancamentos = extrairExtratoExcel(wb, conta.banco)
    if (!lancamentos.length) throw new Error(`Excel ${conta.nome_conta}: nenhum lançamento válido encontrado.`)

    resultado.removidos.extrato = await limparPeriodoExtrato({
      empresaId: empresa.id,
      contaBancariaId: conta.id,
      origem: conta.banco,
      lancamentos,
    })
    resultado.extrato = await salvarExtratosBanco({
      empresaId: empresa.id,
      contaBancariaId: conta.id,
      origem: conta.banco,
      lancamentos,
    })
    resultado.contaBancaria = { id: conta.id, nome: conta.nome_conta, banco: conta.banco }
  }

  if (arquivoCompras) {
    const wb = await carregarWorkbook(arquivoCompras, 'Excel Compras')
    const compras = extrairComprasExcel(wb)
    if (!compras.length) throw new Error('Excel Compras: nenhuma compra válida encontrada.')
    resultado.removidos.compras = await limparPeriodoCompras(compras)
    resultado.compras = await salvarComprasNoBanco({ empresaId: empresa.id, compras })
  }

  if (arquivoVendasCartao) {
    const wb = await carregarWorkbook(arquivoVendasCartao, 'Excel Vendas Cartão')
    const vendas = extrairVendasCartaoExcel(wb)
    if (!vendas.length) throw new Error('Excel Vendas Cartão: nenhum lançamento válido encontrado.')
    resultado.removidos.vendasCartao = await limparPeriodoVendasCartao({ empresaId: empresa.id, vendas })
    resultado.vendasCartao = await salvarVendasCartao({ empresaId: empresa.id, vendas })
  }

  if (arquivoLmc) {
    const wb = await carregarWorkbook(arquivoLmc, 'Excel Vendas/LMC')
    const dadosLmc = extrairLmcExcel(wb)
    const totalLinhas = Object.values(dadosLmc).reduce((s, linhas) => s + linhas.length, 0)
    if (!totalLinhas) throw new Error('Excel Vendas/LMC: nenhum movimento válido encontrado.')
    resultado.removidos.lmc = await limparPeriodoLmc(dadosLmc)
    resultado.lmc = await salvarLmcNoBanco({ empresaId: empresa.id, dadosLmc })
  }

  return resultado
}
