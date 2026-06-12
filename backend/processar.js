import ExcelJS from 'exceljs'

const COL = {
  B: 2, C: 3, D: 4, E: 5, H: 8, I: 9, K: 11, L: 12, M: 13, N: 14, O: 15, P: 16, Q: 17, R: 18, S: 19, AQ: 43, AR: 44}

const FILL = {
  alterado: 'FFBFE3FF' // azul claro
}

function setFill(cell, color = FILL.alterado) {
  const estiloAtual = cell.style ? JSON.parse(JSON.stringify(cell.style)) : {}

  estiloAtual.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: color }
  }
  cell.style = estiloAtual
}

function setValor(cell, valor) {
  cell.value = valor
  setFill(cell)
}

function setValorSemCor(cell, valor) {
  cell.value = valor
} 

function texto(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && v.richText) return v.richText.map(x => x.text).join('')
  if (typeof v === 'object' && v.text) return String(v.text)
  return String(v)
}

function norm(v) {
  return texto(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase()
    .trim()
}

function dataKey(v) {
  if (!v) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)

  if (typeof v === 'object' && v.result) {
    return dataKey(v.result)
  }

  if (typeof v === 'string') {
    const m = v.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (m) {
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    }
  }

  return null
}

function ehNumero(v) {
  return v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v))
}

function num(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return v
  return Number(String(v).replace(/\./g, '').replace(',', '.'))
}

function clone(obj) {
  return obj ? JSON.parse(JSON.stringify(obj)) : obj
}


function obterMesclagensDaLinha(ws, linhaModelo) {
  const mesclagens = []
  const merges = ws._merges ? Object.values(ws._merges) : []

  for (const merge of merges) {
    const m = merge.model || merge

    if (m.top === linhaModelo && m.bottom === linhaModelo) {
      mesclagens.push({
        left: m.left,
        right: m.right,
      })
    }
  }

  return mesclagens
}

function aplicarMesclagensNaLinha(ws, linhaDestino, mesclagens) {
  for (const m of mesclagens) {
    try {
      ws.unMergeCells(linhaDestino, m.left, linhaDestino, m.right)
    } catch (_) {}

    try {
      ws.mergeCells(linhaDestino, m.left, linhaDestino, m.right)
    } catch (_) {}
  }
}

function inserirLinhaComModelo(ws, linhaModelo, linhaDestino) {
  const mesclagensModelo = obterMesclagensDaLinha(ws, linhaModelo)

  ws.spliceRows(linhaDestino, 0, [])

  copiarLinhaModelo(ws, linhaModelo, linhaDestino)
  limparLinhaLancamento(ws, linhaDestino)
  aplicarMesclagensNaLinha(ws, linhaDestino, mesclagensModelo)
}

function copiarLinhaModelo(ws, origem, destino) {
  const modelo = ws.getRow(origem)
  const nova = ws.getRow(destino)

  nova.height = modelo.height

  for (let c = 1; c <= ws.columnCount; c++) {
    const src = modelo.getCell(c)
    const dst = nova.getCell(c)

    dst.style = clone(src.style)

    if (src.numFmt) {
      dst.numFmt = src.numFmt
    }
  }
}

function copiarMesclagensDaLinhaModelo(ws, origem, destino) {
  aplicarMesclagensNaLinha(ws, destino, obterMesclagensDaLinha(ws, origem))
}

function limparLinhaLancamento(ws, rowNumber) {
  const row = ws.getRow(rowNumber)

  for (let c = 1; c <= ws.columnCount; c++) {
    row.getCell(c).value = null
  }
}

function encontrarLinha(ws, inicio, fim, termo) {
  const alvo = norm(termo)

  for (let r = inicio; r <= fim; r++) {
    if (norm(ws.getCell(r, COL.B).value).includes(alvo)) {
      return r
    }
  }

  return null
}

function linhasSaldoLiquido(ws) {
  const rows = []

  for (let r = 1; r <= ws.rowCount; r++) {
    if (norm(ws.getCell(r, COL.B).value).includes('saldo liquido do dia')) {
      rows.push(r)
    }
  }

  return rows
}

function getWorksheetObrigatoria(workbook, nomesPossiveis) {
  for (const nome of nomesPossiveis) {
    const ws = workbook.getWorksheet(nome)
    if (ws) return ws
  }

  const normalizados = nomesPossiveis.map(norm)

  const ws = workbook.worksheets.find(aba =>
    normalizados.some(n =>
      norm(aba.name).includes(n) || n.includes(norm(aba.name))
    )
  )

  if (ws) return ws

  throw new Error(`Aba não encontrada na planilha auxiliar. Procurei por: ${nomesPossiveis.join(', ')}`)
}

function parseCombustivel(ws) {
  const mapa = new Map()

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return

    const key = dataKey(row.getCell(1).value)
    const quant = row.getCell(4).value

    if (!key || quant === null || quant === undefined || quant === '') return

    mapa.set(key, {
      quant: -Math.abs(num(quant) ?? 0),
      preco: num(row.getCell(5).value) ?? 0,
      ajuste: num(row.getCell(8).value) ?? 0
    })
  })

  return mapa
}

function parseBanco(ws) {
  const mapa = new Map()

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return

    const key = dataKey(row.getCell(1).value)
    const desc = texto(row.getCell(2).value).trim()
    const valor = num(row.getCell(3).value)

    if (!key || !desc || valor === null) return

    if (!mapa.has(key)) {
      mapa.set(key, [])
    }

    mapa.get(key).push({ desc, valor })
  })

  return mapa
}

function buscarValor(entries, padrao) {
  const p = norm(padrao)
  const item = entries.find(e => norm(e.desc).includes(p))
  return item ? item.valor : null
}

function buscarValorLista(entries, padroes) {
  for (const padrao of padroes) {
    const valor = buscarValor(entries, padrao)

    if (valor !== null) {
      return valor
    }
  }

  return null
}

function somaValoresLista(entries, padroes) {
  const normalizados = padroes.map(norm)

  const encontrados = entries.filter(e =>
    normalizados.some(p => norm(e.desc).includes(p))
  )

  if (!encontrados.length) return null

  return encontrados.reduce((total, e) => total + Number(e.valor || 0), 0)
}

function correspondeAlgumPadrao(desc, padroes) {
  const d = norm(desc)

  return padroes.some(p => d.includes(norm(p)))
}

function outrosSpot(entries) {
  const essenciais = [
    'Credito Vendas Cartão',
    'Credito Vendas Cartao',
    'Crédito de Vendas',
    'Credito de Vendas',
    'Pix recebido maquininha',
    'Pix recebido na maquininha',
    'Tarifa pix recebido maquininha',
    'Tarifa pix recebido maquinha',
    'Tarifa Pix (RECEBIMENTO)',
    'Tarifa pix enviado',
    'Tarifa Pix (ENVIO)'
  ]

  return entries.filter(e => !correspondeAlgumPadrao(e.desc, essenciais))
}

function outrosItau(entries) {
  const essenciais = [
    'Pix e depositos Vendas',
    'Pix e depósitos Vendas',
    'Dep Din ATM',
    'Pix QRS',
    'Pix Transf'
  ]

  return entries.filter(e => !correspondeAlgumPadrao(e.desc, essenciais))
}

function preencherCombustivel(ws, rows, dados, cfg) {
  if (!dados || !rows.venda) return

  const rowVenda = ws.getRow(rows.venda)

  setValor(rowVenda.getCell(cfg.colQuant), dados.quant)
  setValor(rowVenda.getCell(cfg.colPreco), dados.preco)

  rowVenda.getCell(cfg.colTotal).value = {
    formula: `${cfg.letraQuant}${rows.venda}*${cfg.letraPreco}${rows.venda}`
  }

  if (rows.ajuste) {
    const rowAjuste = ws.getRow(rows.ajuste)
    setValor(rowAjuste.getCell(cfg.colQuant), dados.ajuste)
  }
}

function mapearLinhasDoDia(ws, inicio, fim) {
  return {
    creditoCartao: encontrarLinha(ws, inicio, fim, 'Credito Vendas Cartão'),
    descontoCartao: encontrarLinha(ws, inicio, fim, 'Desconto taxas Cartão'),
    pixMaquininha: encontrarLinha(ws, inicio, fim, 'Pix recebido maquininha'),
    tarifaPix: encontrarLinha(ws, inicio, fim, 'Tarifa pix recebido maquinha'),
    itauPix: encontrarLinha(ws, inicio, fim, 'Pix e depositos Vendas'),
    vendaGasolina: encontrarLinha(ws, inicio, fim, 'Venda de Gasolina'),
    vendaEtanol: encontrarLinha(ws, inicio, fim, 'Venda de Etanol'),
    vendaDiesel: encontrarLinha(ws, inicio, fim, 'Venda de Diesel'),
    ajuste: encontrarLinha(ws, inicio, fim, 'Ajuste estoque e valor diário')
  }
}

function encontrarDias(ws) {
  const linhas = []

  for (let r = 1; r <= ws.rowCount; r++) {
    if (norm(ws.getCell(r, COL.B).value).includes('bloco spot')) {
      linhas.push(r)
    }
  }

  let primeiraData = null

  for (const r of linhas) {
    const v = ws.getCell(r, 1).value
    const key = dataKey(v?.result ?? v)

    if (key) {
      primeiraData = new Date(`${key}T00:00:00`)
      break
    }
  }

  if (!primeiraData) {
    primeiraData = new Date('2026-03-01T00:00:00')
  }

  const dias = linhas.map((inicio, idx) => {
    const dt = new Date(primeiraData)
    dt.setDate(primeiraData.getDate() + idx)

    ws.getCell(inicio, 1).value = dt

    return {
      key: dt.toISOString().slice(0, 10),
      inicio
    }
  })

  for (let i = 0; i < dias.length; i++) {
    dias[i].fim = (dias[i + 1]?.inicio ?? (ws.rowCount + 1)) - 1
  }

  return dias
}

function preencherSpot(ws, dia, entries) {
  if (!entries?.length) return

  let rows = mapearLinhasDoDia(ws, dia.inicio, dia.fim)

  const credito = buscarValorLista(entries, [
    'Credito Vendas Cartão',
    'Credito Vendas Cartao',
    'Crédito de Vendas',
    'Credito de Vendas',
    'Crédito de Vendas no Cartão'
  ])

  const pix = buscarValorLista(entries, [
    'Pix recebido maquininha',
    'Pix recebido na maquininha'
  ])

  const tarifaRecebida = buscarValorLista(entries, [
    'Tarifa pix recebido maquininha',
    'Tarifa pix recebido maquinha',
    'Tarifa Pix (RECEBIMENTO)'
  ])

  if (rows.creditoCartao && ehNumero(credito)) {
    setValor(ws.getCell(rows.creditoCartao, COL.D), credito)
    setValor(ws.getCell(rows.creditoCartao, COL.I), -Math.abs(credito))
  }

  if (rows.descontoCartao && rows.creditoCartao) {
    ws.getCell(rows.descontoCartao, COL.I).value = {
      formula: `-I${dia.inicio - 1}-I${rows.creditoCartao}`
    }
  }

  if (rows.pixMaquininha && ehNumero(pix)) {
    setValor(ws.getCell(rows.pixMaquininha, COL.D), pix)
    setValor(ws.getCell(rows.pixMaquininha, COL.I), -Math.abs(pix))
  }

  if (rows.tarifaPix && ehNumero(tarifaRecebida)) {
    setValor(ws.getCell(rows.tarifaPix, COL.D), tarifaRecebida)
  }

  const extras = outrosSpot(entries)
  const linhaModelo = rows.tarifaPix || rows.pixMaquininha || rows.creditoCartao

  if (!linhaModelo) return

  let insertAt = linhaModelo + 1

  for (const e of extras.reverse()) {
    inserirLinhaComModelo(ws, linhaModelo, insertAt)

    setValorSemCor(ws.getCell(insertAt, COL.B), e.desc)
    setValor(ws.getCell(insertAt, COL.D), e.valor)

    dia.fim++
  }
}

function preencherItau(ws, dia, entries) {
  if (!entries?.length) return

  let rows = mapearLinhasDoDia(ws, dia.inicio, dia.fim)

  const pixVenda = somaValoresLista(entries, [
    'Pix e depositos Vendas',
    'Pix e depósitos Vendas',
    'Dep Din ATM',
    'Pix QRS',
    'Pix Transf'
  ])

  if (rows.itauPix && ehNumero(pixVenda)) {
    setValor(ws.getCell(rows.itauPix, COL.E), pixVenda)
    setValor(ws.getCell(rows.itauPix, COL.H), -Math.abs(pixVenda))
  }

  const extras = outrosItau(entries)
  const linhaModelo = rows.itauPix

  if (!linhaModelo) return

  let insertAt = linhaModelo + 1

  for (const e of extras.reverse()) {
    inserirLinhaComModelo(ws, linhaModelo, insertAt)

    setValorSemCor(ws.getCell(insertAt, COL.B), e.desc)
    setValor(ws.getCell(insertAt, COL.E), e.valor)

    dia.fim++
  }
}
/********AJUSTE DAS FORMULAS NO CORPO DOS LANÇAMENTOS ****************************************/
function aplicarFormulasPadrao(ws) {
  const dias = encontrarDias(ws)
  const saldos = linhasSaldoLiquido(ws)

  for (let i = 0; i < dias.length; i++) {
    const dia = dias[i]
    const fim = (dias[i + 1]?.inicio ?? (ws.rowCount + 1)) - 1
    const rows = mapearLinhasDoDia(ws, dia.inicio, fim)
    const saldoAnterior = i === 0 ? 2 : saldos[i - 1]

    if (rows.descontoCartao && rows.creditoCartao) {
      ws.getCell(rows.descontoCartao, COL.I).value = {
        formula: `-I${saldoAnterior}-I${rows.creditoCartao}`
      }
    }

    if (rows.vendaGasolina) {
      ws.getCell(rows.vendaGasolina, COL.M).value = {
        formula: `K${rows.vendaGasolina}*L${rows.vendaGasolina}`
      }
    }

    if (rows.vendaEtanol) {
      ws.getCell(rows.vendaEtanol, COL.P).value = {
        formula: `N${rows.vendaEtanol}*O${rows.vendaEtanol}`
      }
    }

    if (rows.vendaDiesel) {
      ws.getCell(rows.vendaDiesel, COL.S).value = {
        formula: `Q${rows.vendaDiesel}*R${rows.vendaDiesel}`
      }
    }
  }
}
/********AJUSTE DAS FORMULAS COLUNA C SALDO GIRO NO DIA (SOMATORIA D+E+F+G+H+I+J+M+P+S)*********************************/
function aplicarFormulaColunaCSaldoGiro(ws) {
  for (let r = 1; r <= ws.rowCount; r++) {

    if (!norm(ws.getCell(r, COL.B).value).includes('saldo giro no dia')) {
      continue
    }

    const linhaBase = r + 1

    ws.getCell(r, COL.C).value = {
      formula: `D${linhaBase}+E${linhaBase}+F${linhaBase}+G${linhaBase}+H${linhaBase}+I${linhaBase}+J${linhaBase}+M${linhaBase}+P${linhaBase}+S${linhaBase}`
    }
  }
}

/********AJUSTE DAS FORMULAS DOS TOTAIS CADA COLUNA D,E,F,G,H,I,J,M,P,S,T...AQ)********************/
function aplicarFormulaColunaSaldoLiquido(ws) {
  const saldos = linhasSaldoLiquido(ws)

  for (let i = 0; i < saldos.length; i++) {
    const rowNum = saldos[i]
    const inicio = i === 0 ? 2 : saldos[i - 1]
    const fim = rowNum - 1
    const row = ws.getRow(rowNum)

    row.getCell(COL.C).value = {
      formula: `AR${rowNum}`
    }

    for (let c = COL.D; c <= COL.AQ; c++) {
      const letter = ws.getColumn(c).letter

      if ([COL.L, COL.O, COL.R].includes(c)) {
        const totalCol = c + 1
        const quantCol = c - 1

        row.getCell(c).value = {
          formula: `${ws.getColumn(totalCol).letter}${rowNum}/${ws.getColumn(quantCol).letter}${rowNum}`
        }
      } else if ([COL.M, COL.P, COL.S].includes(c)) {
        row.getCell(c).value = {
          formula: `ROUND(SUM(${letter}${inicio}:${letter}${fim}),2)`
        }
      } else {
        row.getCell(c).value = {
          formula: `SUM(${letter}${inicio}:${letter}${fim})`
        }
      }
    }
  }
}

/********AJUSTE DAS FORMULAS DOS TOTAIS LINHA SALDO LIQUIDO DO DIA (COLUNA AR=SOMATORIA D+E+F+G+H+I+J+M+P+S+T:AQ)****************/
function aplicarFormulaTotalLinhaSaldoLiquido(ws) {
  const linhas = linhasSaldoLiquido(ws)

  if (!linhas.length) return

  // Usa AR do primeiro Saldo Líquido como modelo, ex: AR19
  const primeiraLinha = linhas[0]
  const formulaModelo =
    typeof ws.getCell(primeiraLinha, COL.AR).value === 'object' &&
    ws.getCell(primeiraLinha, COL.AR).value?.formula
      ? ws.getCell(primeiraLinha, COL.AR).value.formula
      : null

  if (!formulaModelo) return

  for (const rowNum of linhas) {
    const novaFormula = formulaModelo.replace(
      /([A-Z]{1,3})\d+/g,
      `$1${rowNum}`
    )

    ws.getCell(rowNum, COL.AR).value = {
      formula: novaFormula
    }
  }
}

/********AJUSTE DAS FORMULAS SOMATORIA BLOCO T:AQ (TERCEIROS)****************/
function aplicarFormulaSaldoTerceiros(ws) {
  const dias = encontrarDias(ws)

  for (let i = 0; i < dias.length; i++) {
    const diaAtual = dias[i]
    const diaAnterior = dias[i - 1]

    const linhaGiro = encontrarLinha(
      ws,
      diaAtual.inicio,
      diaAtual.fim,
      'Saldo Giro no dia'
    )

    if (!linhaGiro) continue

    let linhaInicio = 2

    if (diaAnterior) {
      const saldoLiquidoAnterior = encontrarLinha(
        ws,
        diaAnterior.inicio,
        diaAnterior.fim,
        'Saldo Liquido do dia'
      )

      if (saldoLiquidoAnterior) {
        linhaInicio = saldoLiquidoAnterior
      }
    }

    ws.getCell(linhaGiro, COL.AR).value = {
      formula: `SUM(T${linhaInicio}:AQ${linhaGiro})`
    }
  }
}

/***********************************************************************************************************/
export async function processarPlanilhas(principalBuffer, secundariaBuffer, abaPrincipal = 'Mar26') {
  const principal = new ExcelJS.Workbook()
  await principal.xlsx.load(principalBuffer)

  const secundaria = new ExcelJS.Workbook()
  await secundaria.xlsx.load(secundariaBuffer)

  const ws = principal.getWorksheet(abaPrincipal)

if (!ws) {
  throw new Error(`A aba ${abaPrincipal} não foi encontrada na planilha principal.`)
}

  const gas = parseCombustivel(getWorksheetObrigatoria(secundaria, ['GASOLINA']))
  const eta = parseCombustivel(getWorksheetObrigatoria(secundaria, ['ETANOL']))
  const die = parseCombustivel(getWorksheetObrigatoria(secundaria, ['DIESEL']))
  const itau = parseBanco(getWorksheetObrigatoria(secundaria, ['ITAU']))
  const spot = parseBanco(getWorksheetObrigatoria(secundaria, ['SPOT']))

  const dias = encontrarDias(ws)

  for (const dia of dias.reverse()) {
    preencherSpot(ws, dia, spot.get(dia.key) || [])
    preencherItau(ws, dia, itau.get(dia.key) || [])

    const rows = mapearLinhasDoDia(ws, dia.inicio, dia.fim + 40)

    preencherCombustivel(ws, {
      venda: rows.vendaGasolina,
      ajuste: rows.ajuste
    }, gas.get(dia.key), {
      colQuant: COL.K,
      colPreco: COL.L,
      colTotal: COL.M,
      letraQuant: 'K',
      letraPreco: 'L'
    })

    preencherCombustivel(ws, {
      venda: rows.vendaEtanol,
      ajuste: rows.ajuste
    }, eta.get(dia.key), {
      colQuant: COL.N,
      colPreco: COL.O,
      colTotal: COL.P,
      letraQuant: 'N',
      letraPreco: 'O'
    })

    preencherCombustivel(ws, {
      venda: rows.vendaDiesel,
      ajuste: rows.ajuste
    }, die.get(dia.key), {
      colQuant: COL.Q,
      colPreco: COL.R,
      colTotal: COL.S,
      letraQuant: 'Q',
      letraPreco: 'R'
    })
  }

  aplicarFormulasPadrao(ws)           // formulas ao preencer corpo  ok
  aplicarFormulaColunaCSaldoGiro(ws)         // formulas coluna C saldo giro no dia
  aplicarFormulaColunaSaldoLiquido(ws)      // formulas colunas da linha saldo liquido por dia 
  aplicarFormulaTotalLinhaSaldoLiquido(ws) // formulas total soma linha saldo liquido do dia
  aplicarFormulaSaldoTerceiros(ws)       // formulas coluan AR soma saldo terceiros
    
  principal.calcProperties.fullCalcOnLoad = true

  return await principal.xlsx.writeBuffer()
}