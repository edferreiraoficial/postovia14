import ExcelJS from 'exceljs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse')

const NUMERO_BR_RE = /-?(?:\d{1,3}(?:\.\d{3})+|\d{1,3}),\d{2}/g
const DATA_RE = /^(\d{2}\/\d{2}\/\d{4})\s*(.+)$/

function brToNumber(valor) {
  if (valor === null || valor === undefined) return null
  const texto = String(valor)
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
  const numero = Number(texto)
  return Number.isFinite(numero) ? numero : null
}

function dataBrParaDate(dataBr) {
  const [dia, mes, ano] = String(dataBr).split('/').map(Number)
  return new Date(ano, mes - 1, dia)
}

function dataBrParaIso(dataBr) {
  const [dia, mes, ano] = String(dataBr).split('/')
  return `${ano}-${mes}-${dia}`
}

function normalizarTexto(texto = '') {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function limparTextoLinha(texto = '') {
  return String(texto)
    .replace(/[]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}



function corrigirValorGrudado(linha = '') {
  return String(linha)
    // Itaú: DEP DIN ATM N. 53512234620,00 -> DEP DIN ATM N. 535122346 20,00
    .replace(/(DEP\s+DIN\s+ATM\s+N\.\s*\d{9})(-?(?:\d{1,3}(?:\.\d{3})+|\d{1,3}),\d{2})/gi, '$1 $2')
    // Itaú: PIX QRS NOME31/0320,00 -> PIX QRS NOME31/03 20,00
    .replace(/(\d{2}\/\d{2})(-?(?:\d{1,3}(?:\.\d{3})+|\d{1,3}),\d{2})/g, '$1 $2')
    // Espaça saldo/valor colado após descrição.
    .replace(/(DIA)(-?\d{1,3}(?:\.\d{3})*,\d{2})/gi, '$1 $2')
    .replace(/([A-ZÇÃÕÁÉÍÓÚÜ]{2,})(-?\d{1,3}(?:\.\d{3})*,\d{2})/g, '$1 $2')
}

function deveEncerrarLeitura(linha = '') {
  const n = normalizarTexto(linha)
  return (
    n.includes('POSICAO CONSOLIDADA') ||
    n.includes('INFORMACOES ADICIONAIS') ||
    n.includes('HISTORICO DE UTILIZACAO') ||
    n.includes('LIMITES') ||
    n.includes('JUROS E IOF ACUMULADOS') ||
    n.includes('AVISO!')
  )
}

function separarLinhasDated(texto = '') {
  // Alguns PDFs textuais/OCR do Itaú e do SPOT chegam com mais de um lançamento na mesma linha.
  // Esta normalização quebra sempre antes de uma nova data dd/mm/aaaa, sem alterar a data ou valor.
  return String(texto)
    .replace(/\r/g, '')
    .replace(/[\t ]+/g, ' ')
    .replace(/(\d{2}\/\d{2}\/\d{4})/g, '\n$1')
    .split('\n')
    .map(limparTextoLinha)
    .map(corrigirValorGrudado)
    .filter(Boolean)
}

function obterNumerosMonetarios(texto = '') {
  // Captura somente valores em formato monetário brasileiro válido.
  // Importante: não aceitar sequências longas sem separador de milhar, pois em extratos OCR
  // o número do ATM pode grudar no valor: "53512234620,00" deve virar 20,00, não 53512234620,00.
  return [...String(texto).matchAll(NUMERO_BR_RE)]
}

async function extrairTextoPdf(arquivoPdf) {
  const buffer = arquivoPdf?.buffer || arquivoPdf
  const dados = await pdfParse(buffer)
  const texto = String(dados.text || '')
    .replace(/\r/g, '')
    .replace(/[\t ]+/g, ' ')

  if (!texto.trim() || texto.trim().length < 80) {
    throw new Error('O PDF não possui texto pesquisável suficiente para gerar Excel. Primeiro converta o PDF com OCR e tente novamente.')
  }

  return texto
}

function deveIgnorarLinha(linha) {
  const n = normalizarTexto(linha)
  if (!n) return true

  return (
    n === 'DATA LANCAMENTOS VALOR (R$) SALDO (R$)' ||
    n === 'DATA DESCRICAO VALOR (R$) TIPO REFERENCIA' ||
    n.includes('EXTRATO CONTA CORRENTE') ||
    n.includes('PERIODO DE VISUALIZACAO') ||
    n.includes('EMITIDO EM') ||
    n.includes('INFORMACOES ADICIONAIS') ||
    n.includes('POSICAO CONSOLIDADA') ||
    n.includes('LIMITES') ||
    n.includes('JUROS E IOF') ||
    n.includes('AVISO!') ||
    n.includes('SPOTBANK') ||
    n.includes('PAGINA:') ||
    /^HTTPS?:\/\//i.test(linha) ||
    /^ABOUT:BLANK/i.test(linha)
  )
}

function extrairLinhasComData(texto) {
  const linhasOriginais = separarLinhasDated(texto)
  const linhas = []
  let atual = null

  for (const linha of linhasOriginais) {
    if (deveEncerrarLeitura(linha)) break
    if (deveIgnorarLinha(linha)) continue

    const match = linha.match(DATA_RE)
    if (match) {
      if (atual) linhas.push(atual)
      atual = `${match[1]} ${match[2]}`.trim()
      continue
    }

    if (atual && !deveIgnorarLinha(linha)) {
      atual = `${atual} ${linha}`.trim()
    }
  }

  if (atual) linhas.push(atual)
  return linhas
}

function removerUltimoNumero(texto, numeroEncontrado) {
  const inicio = numeroEncontrado.index
  return `${texto.slice(0, inicio)} ${texto.slice(inicio + numeroEncontrado[0].length)}`
    .replace(/\s+/g, ' ')
    .trim()
}

function parseLinhaLancamento(linha) {
  const matchData = linha.match(DATA_RE)
  if (!matchData) return null

  const data = matchData[1]
  const resto = matchData[2].trim()
  const numeros = obterNumerosMonetarios(resto)
  if (!numeros.length) return null

  const normalizado = normalizarTexto(resto)
  const ultimoNumero = numeros.at(-1)
  const valorNumero = brToNumber(ultimoNumero[0])
  let descricao = removerUltimoNumero(resto, ultimoNumero)
    .replace(/^lançamentos\s+/i, '')
    .replace(/^descricao\s+/i, '')
    // Remove cabeçalhos/rodapés que alguns PDFs colam na mesma linha do lançamento.
    .replace(/\d{2}\/\d{2}\/\d{2},.*$/i, '')
    .replace(/extrato-lancamentos.*$/i, '')
    .replace(/data\s*lançamentos\s*valor.*$/i, '')
    .trim()

  if (/SALDO\s+ANTERIOR/i.test(normalizado)) {
    return { data, descricao: 'Saldo anterior', valor: null, saldo: valorNumero, tipo: 'SALDO_ANTERIOR', original: linha }
  }

  if (/SALDO\s+(TOTAL\s+)?DISPONIVEL\s+DIA|SALDO\s+DO\s+DIA|SALDO\s+FINAL/i.test(normalizado)) {
    return { data, descricao: 'Saldo do dia', valor: null, saldo: valorNumero, tipo: 'SALDO', original: linha }
  }

  if (!descricao) return null

  return {
    data,
    descricao,
    valor: valorNumero,
    saldo: null,
    tipo: valorNumero < 0 ? 'DEBITO' : 'CREDITO',
    original: linha,
  }
}

function extrairLancamentos(texto) {
  return extrairLinhasComData(texto)
    .map(parseLinhaLancamento)
    .filter(Boolean)
}

function ehPixDepositoVenda(lancamento) {
  const desc = normalizarTexto(lancamento.descricao)
  const valor = Number(lancamento.valor || 0)

  if (valor <= 0) return false
  if (desc.includes('TARIFA PIX')) return false

  return (
    desc.includes('PIX QRS') ||
    desc.includes('PIX TRANSF') ||
    desc.includes('CREDITO PIX') ||
    desc.includes('DEP DIN ATM') ||
    desc.includes('DEP DINHEIRO ATM') ||
    desc.includes('DEP CHEQUE ATM') ||
    desc.includes('CREDITO DE VENDAS') ||
    desc === 'DE VENDAS'
  )
}


function consolidarItauDiariamente(lancamentos) {
  const ordenados = [...lancamentos].sort((a, b) => {
    const dif = dataBrParaDate(a.data) - dataBrParaDate(b.data)
    return dif || 0
  })

  const saldoAnterior = ordenados.find(l => l.tipo === 'SALDO_ANTERIOR') || null
  const movimentos = ordenados.filter(l => l.tipo !== 'SALDO_ANTERIOR')
  const datas = [...new Set(movimentos.map(l => l.data))].sort((a, b) => dataBrParaDate(a) - dataBrParaDate(b))
  const saida = []
  const auditoria = []

  if (saldoAnterior) {
    saida.push({
      data: saldoAnterior.data,
      descricao: 'Saldo anterior',
      valor: null,
      saldo: saldoAnterior.saldo,
    })
  }

  for (const data of datas) {
    const linhasDia = movimentos.filter(l => l.data === data)
    const saldoFinalDia = linhasDia.find(l => l.tipo === 'SALDO') || null
    const movimentosDia = linhasDia.filter(l => l.tipo !== 'SALDO')
    const pixDepositos = movimentosDia.filter(ehPixDepositoVenda)
    const demais = movimentosDia.filter(l => !ehPixDepositoVenda(l))
    const inicioDia = saida.length
    const totalPixDepositos = pixDepositos.reduce((total, item) => total + Number(item.valor || 0), 0)

    if (pixDepositos.length) {
      saida.push({
        data,
        descricao: 'Pix e depositos Vendas',
        valor: totalPixDepositos,
        saldo: null,
      })
    }

    for (const item of demais) {
      saida.push({
        data,
        descricao: item.descricao,
        valor: item.valor,
        saldo: null,
      })
    }

    if (saldoFinalDia) {
      if (saida.length === inicioDia) {
        saida.push({ data, descricao: 'Saldo do dia', valor: null, saldo: saldoFinalDia.saldo })
      } else {
        saida[saida.length - 1].saldo = saldoFinalDia.saldo
      }
    }

    auditoria.push({
      data,
      qtdLancamentosOriginais: movimentosDia.length,
      qtdPixDepositosAgrupados: pixDepositos.length,
      totalPixDepositos,
      qtdDemaisLancamentos: demais.length,
      saldoFinal: saldoFinalDia?.saldo ?? null,
    })
  }

  return { linhas: saida, auditoria }
}

function ehCreditoPixMaquininhaSpot(lancamento) {
  const desc = normalizarTexto(lancamento.descricao)
  const valor = Number(lancamento.valor || 0)
  return valor > 0 && valor <= 2000 && desc.includes('CREDITO PIX')
}

function ehTarifaPixRecebimentoSpot(lancamento) {
  const desc = normalizarTexto(lancamento.descricao)
  return desc.includes('TARIFA PIX') && desc.includes('RECEBIMENTO')
}

function ehTarifaPixEnvioSpot(lancamento) {
  const desc = normalizarTexto(lancamento.descricao)
  return desc.includes('TARIFA PIX') && desc.includes('ENVIO')
}

function ehCreditoVendasCartaoSpot(lancamento) {
  const desc = normalizarTexto(lancamento.descricao)
  return desc.includes('CREDITO DE VENDAS') || desc === 'DE VENDAS'
}

function ehPixDepositoVendasSpot(lancamento) {
  const desc = normalizarTexto(lancamento.descricao)
  const valor = Number(lancamento.valor || 0)
  if (valor <= 0) return false
  if (ehCreditoPixMaquininhaSpot(lancamento)) return false
  if (ehCreditoVendasCartaoSpot(lancamento)) return false
  if (desc.includes('TARIFA PIX')) return false
  return (
    desc.includes('CREDITO PIX') ||
    desc.includes('PIX') ||
    desc.includes('ATM') ||
    desc.includes('DEPOSITO') ||
    desc.includes('DEP ')
  )
}

function somarGrupo(linhas) {
  return linhas.reduce((total, item) => total + Number(item.valor || 0), 0)
}

function consolidarSpotDiariamente(lancamentos) {
  const ordenados = [...lancamentos].sort((a, b) => {
    const dif = dataBrParaDate(a.data) - dataBrParaDate(b.data)
    return dif || 0
  })

  const saldoAnterior = ordenados.find(l => l.tipo === 'SALDO_ANTERIOR') || null
  const movimentos = ordenados.filter(l => l.tipo !== 'SALDO_ANTERIOR')
  const datas = [...new Set(movimentos.map(l => l.data))].sort((a, b) => dataBrParaDate(a) - dataBrParaDate(b))
  const saida = []
  const auditoria = []

  if (saldoAnterior) {
    saida.push({ data: saldoAnterior.data, descricao: 'Saldo anterior', valor: null, saldo: saldoAnterior.saldo })
  }

  for (const data of datas) {
    const linhasDia = movimentos.filter(l => l.data === data)
    const saldosDia = linhasDia.filter(l => l.tipo === 'SALDO')
    const saldoFinalDia = saldosDia.at(-1) || null
    const movimentosDia = linhasDia.filter(l => l.tipo !== 'SALDO')

    const usados = new Set()
    const addGrupo = (descricao, filtro) => {
      const grupo = movimentosDia.filter((item, idx) => !usados.has(idx) && filtro(item))
      grupo.forEach(item => usados.add(movimentosDia.indexOf(item)))
      if (grupo.length) {
        saida.push({ data, descricao, valor: somarGrupo(grupo), saldo: null })
      }
      return grupo
    }

    const inicioDia = saida.length
    const creditoPixMaquininha = addGrupo('Pix recebido maquininha', ehCreditoPixMaquininhaSpot)
    const tarifaRecebimento = addGrupo('Tarifa pix recebido maquininha', ehTarifaPixRecebimentoSpot)
    const tarifaEnvio = addGrupo('Tarifa pix enviado', ehTarifaPixEnvioSpot)
    const pixDepositos = addGrupo('Pix e depositos Vendas', ehPixDepositoVendasSpot)
    const creditoVendas = addGrupo('Credito Vendas Cartão', ehCreditoVendasCartaoSpot)

    const demais = movimentosDia.filter((_, idx) => !usados.has(idx))
    for (const item of demais) {
      saida.push({ data, descricao: item.descricao, valor: item.valor, saldo: null })
    }

    if (saldoFinalDia) {
      if (saida.length === inicioDia) {
        saida.push({ data, descricao: 'Saldo do dia', valor: null, saldo: saldoFinalDia.saldo })
      } else {
        saida[saida.length - 1].saldo = saldoFinalDia.saldo
      }
    }

    auditoria.push({
      data,
      qtdLancamentosOriginais: movimentosDia.length,
      qtdPixDepositosAgrupados: pixDepositos.length + creditoPixMaquininha.length,
      totalPixDepositos: somarGrupo(pixDepositos) + somarGrupo(creditoPixMaquininha),
      qtdDemaisLancamentos: demais.length,
      saldoFinal: saldoFinalDia?.saldo ?? null,
      totalTarifaPixRecebimento: somarGrupo(tarifaRecebimento),
      totalTarifaPixEnvio: somarGrupo(tarifaEnvio),
      totalCreditoVendasCartao: somarGrupo(creditoVendas),
    })
  }

  return { linhas: saida, auditoria }
}

function consolidarDiariamente(lancamentos, banco = 'itau') {
  if (String(banco).toLowerCase() === 'spot') return consolidarSpotDiariamente(lancamentos)
  return consolidarItauDiariamente(lancamentos)
}

function aplicarFormatacaoPlanilha(ws) {
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.columns = [
    { header: 'Data', key: 'data', width: 14 },
    { header: 'Descrição do lançamento', key: 'descricao', width: 52 },
    { header: 'Valor', key: 'valor', width: 18 },
    { header: 'Saldo', key: 'saldo', width: 18 },
  ]

  ws.getRow(1).font = { bold: true }

  const bordaPadrao = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  }

  // Aplica borda em A:D em todas as linhas geradas, inclusive na coluna D
  // quando o saldo estiver vazio. O ExcelJS não percorre células vazias com
  // row.eachCell(), por isso acessamos explicitamente as 4 colunas.
  for (let rowNumber = 1; rowNumber <= ws.rowCount; rowNumber++) {
    const row = ws.getRow(rowNumber)
    for (let colNumber = 1; colNumber <= 4; colNumber++) {
      const cell = row.getCell(colNumber)
      cell.border = bordaPadrao
      cell.alignment = { vertical: 'middle', wrapText: false }
    }
  }

  ws.getColumn('C').numFmt = '#,##0.00;[Red]-#,##0.00'
  ws.getColumn('D').numFmt = '#,##0.00;[Red]-#,##0.00'
}

function adicionarAbaAuditoria(wb, auditoria) {
  const ws = wb.addWorksheet('Auditoria')
  ws.columns = [
    { header: 'Data', key: 'data', width: 14 },
    { header: 'Qtd lançamentos originais', key: 'qtdLancamentosOriginais', width: 24 },
    { header: 'Qtd PIX/ATM agrupados', key: 'qtdPixDepositosAgrupados', width: 24 },
    { header: 'Total PIX/ATM', key: 'totalPixDepositos', width: 18 },
    { header: 'Qtd demais lançamentos', key: 'qtdDemaisLancamentos', width: 24 },
    { header: 'Saldo final', key: 'saldoFinal', width: 18 },
  ]
  ws.getRow(1).font = { bold: true }
  auditoria.forEach(item => ws.addRow(item))
  ws.getColumn('D').numFmt = '#,##0.00;[Red]-#,##0.00'
  ws.getColumn('F').numFmt = '#,##0.00;[Red]-#,##0.00'
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  ws.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      }
    })
  })
}



const DATA_COMPRA_RE = /^(\d{2}\/\d{2}\/\d{4})\s+(.+)$/
const PRODUTOS_COMBUSTIVEL_RE = /^(GASOLINA|ETANOL|DIESEL|ARLA|GNV|BIODIESEL|ÓLEO|OLEO|QUEROSENE|ADITIVO)/i

function parseLinhaCompra(linha, produtoAtual) {
  const limpa = limparTextoLinha(linha)
  if (!produtoAtual) return null

  // Modelo mais comum do pdf-parse neste relatório LINX:
  // 06/03/202647 - FORNECEDOR0000105195,2990000,00000010.000,0052.990,0006/03/2026061...
  const colado = limpa.match(/^(\d{2}\/\d{2}\/\d{4})(.+?)(\d{6,})(-?\d+,\d{6})(-?\d+,\d{6})(-?\d{1,3}(?:\.\d{3})*,\d{2})(-?\d{1,3}(?:\.\d{3})*,\d{2})(\d{2}\/\d{2}\/\d{4})/)
  if (colado) {
    return {
      data_movimento: colado[1],
      data_emissao: colado[8],
      produto: produtoAtual,
      fornecedor: colado[2].trim(),
      numero_nf: colado[3],
      custo: brToNumber(colado[4]),
      quantidade: brToNumber(colado[6]),
      valor_total: brToNumber(colado[7]),
      original: linha,
    }
  }

  const matchData = limpa.match(DATA_COMPRA_RE)
  if (!matchData) return null

  const dataMov = matchData[1]
  const resto = matchData[2]
  const matchEmissao = resto.match(/(\d{2}\/\d{2}\/\d{4})/)
  if (!matchEmissao) return null

  const fornecedor = resto.slice(0, matchEmissao.index).trim()
  const depoisEmissao = resto.slice((matchEmissao.index || 0) + matchEmissao[1].length).trim()
  const tokens = depoisEmissao.split(/\s+/).filter(Boolean)
  const nfIndex = tokens.findIndex(t => /^\d{6,}$/.test(t))

  if (!fornecedor || nfIndex < 0 || tokens.length < nfIndex + 4) return null

  const numeroNf = tokens[nfIndex]
  const depoisNf = tokens.slice(nfIndex + 1)
  const valoresBr = depoisNf.filter(t => /^-?\d{1,3}(?:\.\d{3})*,\d{2,6}$/.test(t) || /^-?\d+,\d{2,6}$/.test(t))
  if (valoresBr.length < 3) return null

  const custo = brToNumber(valoresBr[0])
  const quantidade = brToNumber(valoresBr[valoresBr.length - 2])
  const valorTotal = brToNumber(valoresBr[valoresBr.length - 1])

  if (custo === null || quantidade === null || valorTotal === null) return null

  return {
    data_movimento: dataMov,
    data_emissao: matchEmissao[1],
    produto: produtoAtual,
    fornecedor,
    numero_nf: numeroNf,
    custo,
    quantidade,
    valor_total: valorTotal,
    original: linha,
  }
}

function extrairComprasCombustivel(texto = '') {
  const linhas = String(texto)
    .replace(/\r/g, '')
    .split('\n')
    .map(limparTextoLinha)
    .filter(Boolean)

  const compras = []
  let produtoAtual = ''

  for (const linha of linhas) {
    const normalizada = normalizarTexto(linha)
    if (!normalizada || normalizada.includes('TOTAL DE ') || normalizada.includes('TOTAL DO PERIODO')) continue

    if (PRODUTOS_COMBUSTIVEL_RE.test(linha) && !/^\d{2}\/\d{2}\/\d{4}/.test(linha)) {
      produtoAtual = linha.trim()
      continue
    }

    const compra = parseLinhaCompra(linha, produtoAtual)
    if (compra) compras.push(compra)
  }

  return compras.sort((a, b) => dataBrParaDate(a.data_movimento) - dataBrParaDate(b.data_movimento) || a.produto.localeCompare(b.produto))
}

function aplicarFormatacaoCompras(ws) {
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.columns = [
    { header: 'Data Movim.', key: 'data_movimento', width: 14 },
    { header: 'Data Emissão', key: 'data_emissao', width: 14 },
    { header: 'Produto', key: 'produto', width: 18 },
    { header: 'Fornecedor', key: 'fornecedor', width: 52 },
    { header: 'Nº NF', key: 'numero_nf', width: 14 },
    { header: 'Quantidade', key: 'quantidade', width: 16 },
    { header: 'Custo', key: 'custo', width: 14 },
    { header: 'Valor Total', key: 'valor_total', width: 18 },
    { header: 'Quant. Recebida', key: 'quant_rec', width: 18 },
    { header: 'Preço Pago', key: 'preco_pag', width: 16 },
    { header: 'Valor Pago', key: 'valor_pag', width: 18 },
  ]
  ws.getRow(1).font = { bold: true }
  const bordaPadrao = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  }
  for (let rowNumber = 1; rowNumber <= ws.rowCount; rowNumber++) {
    const row = ws.getRow(rowNumber)
    for (let colNumber = 1; colNumber <= 11; colNumber++) {
      const cell = row.getCell(colNumber)
      cell.border = bordaPadrao
      cell.alignment = { vertical: 'middle', wrapText: false }
    }
  }
  ws.getColumn('F').numFmt = '#,##0.000;[Red]-#,##0.000'
  ws.getColumn('G').numFmt = '#,##0.000000;[Red]-#,##0.000000'
  ws.getColumn('H').numFmt = '#,##0.00;[Red]-#,##0.00'
  ws.getColumn('I').numFmt = '#,##0.000;[Red]-#,##0.000'
  ws.getColumn('J').numFmt = '#,##0.000000;[Red]-#,##0.000000'
  ws.getColumn('K').numFmt = '#,##0.00;[Red]-#,##0.00'
}

async function gerarExcelComprasCombustivel(arquivoPdf) {
  const texto = await extrairTextoPdf(arquivoPdf)
  const compras = extrairComprasCombustivel(texto)

  if (!compras.length) {
    throw new Error('Não foi possível identificar compras de combustível no PDF selecionado.')
  }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Posto Via 14'
  wb.created = new Date()

  // A aba COMPRAS é criada como aba principal deste arquivo de exportação.
  const ws = wb.addWorksheet('COMPRAS')
  ws.columns = [
    { header: 'Data Movim.', key: 'data_movimento', width: 14 },
    { header: 'Data Emissão', key: 'data_emissao', width: 14 },
    { header: 'Produto', key: 'produto', width: 18 },
    { header: 'Fornecedor', key: 'fornecedor', width: 52 },
    { header: 'Nº NF', key: 'numero_nf', width: 14 },
    { header: 'Quantidade', key: 'quantidade', width: 16 },
    { header: 'Custo', key: 'custo', width: 14 },
    { header: 'Valor Total', key: 'valor_total', width: 18 },
    { header: 'Quant. Recebida', key: 'quant_rec', width: 18 },
    { header: 'Preço Pago', key: 'preco_pag', width: 16 },
    { header: 'Valor Pago', key: 'valor_pag', width: 18 },
  ]

  compras.forEach(item => {
    ws.addRow({
      data_movimento: item.data_movimento,
      data_emissao: item.data_emissao,
      produto: item.produto,
      fornecedor: item.fornecedor,
      numero_nf: item.numero_nf,
      quantidade: item.quantidade,
      custo: item.custo,
      valor_total: item.valor_total,
      quant_rec: item.quantidade,
      preco_pag: item.custo,
      valor_pag: item.valor_total,
    })
  })

  aplicarFormatacaoCompras(ws)
  return wb.xlsx.writeBuffer()
}



function obterNumerosBr(texto = '') {
  return [...String(texto).matchAll(/-?(?:\d{1,3}(?:\.\d{3})+|\d{1,3}),\d{2}/g)].map(m => m[0])
}

function obterPrecoLmc(bloco = '') {
  const precos = [...String(bloco).matchAll(/(?:^|\s)(-?\d{1,3},\d{4})(?:\s|$)/g)].map(m => m[1])
  if (!precos.length) return null
  // O preço aparece próximo ao rodapé de cada folha, junto ao produto/data.
  return brToNumber(precos.at(-1))
}

function arredondarCentavosLmc(valor) {
  const numero = Number(valor)
  return Number.isFinite(numero) ? Math.round(numero * 100) / 100 : null
}

function extrairValorVendasDiaLmc(bloco = '', quantidadeVendas = null, precoVenda = null) {
  const quantidade = Math.abs(Number(quantidadeVendas || 0))

  // Regra obrigatória: se não houve venda/litros no dia, o valor de vendas do dia
  // também deve ser zero. Não aproveita valor encontrado no texto nem do dia anterior.
  if (quantidade <= 0) return 0

  const preco = Number(precoVenda || 0)
  const valorCalculadoDia = quantidade > 0 && preco > 0
    ? arredondarCentavosLmc(quantidade * preco)
    : null

  const trechoValorVendas = (String(bloco).match(/10\.1\)\s*Valor de vendas do dia([\s\S]*?)(?:10\.2\)|10\.2\s*\))/i) || [])[1] || ''
  const valoresVenda = obterNumerosBr(trechoValorVendas)
  const valorExtraido = brToNumber(valoresVenda.at(-1))

  if (valorCalculadoDia !== null) {
    if (valorExtraido === null || Math.abs(valorExtraido - valorCalculadoDia) > 0.05) {
      return valorCalculadoDia
    }
  }

  return valorExtraido
}

function nomeAbaProdutoLmc(produto = '') {
  const n = normalizarTexto(produto)
  if (n.includes('GASOLINA')) return 'GASOLINA'
  if (n.includes('ETANOL')) return 'ETANOL'
  if (n.includes('DIESEL')) return 'DIESEL'
  return produto.substring(0, 31).trim() || 'LMC'
}

function extrairRegistrosLmc(texto = '') {
  const normalizado = String(texto)
    .replace(/\r/g, '')
    .replace(/[\t ]+/g, ' ')

  const blocos = normalizado
    .split(/(?=LIVRO DE MOVIMENTA[ÇC][ÃA]O DE COMBUST[ÍI]VEIS \(LMC\))/i)
    .map(b => b.trim())
    .filter(Boolean)
  const registros = []

  for (const bloco of blocos) {
    const rodapeProduto = bloco.match(/1\)\s*Produto\s*2\)\s*Data\s*(\d{2}\/\d{2}\/\d{4})\s*([A-ZÁÉÍÓÚÃÕÇ0-9 ]+?)\s*-?\d{1,3},\d{4}/i)
    if (!rodapeProduto) continue
    const data = rodapeProduto[1]
    const produto = limparTextoLinha(rodapeProduto[2])

    const trechoAbertura = bloco.split(/4\)\s*Volume Recebido/i)[0] || bloco
    const aberturaMatch = trechoAbertura.match(/3\.1\)\s*Estoque Abertura\s*([\s\S]*?)4\)/i)
    const aberturaNumeros = obterNumerosBr(aberturaMatch?.[1] || trechoAbertura)
    const abertura = brToNumber(aberturaNumeros[0])

    const trechoVendas = (bloco.match(/5\.6\)\s*=\s*Vendas Bico([\s\S]*?)12\)/i) || [])[1] || ''
    const numerosVendas = obterNumerosBr(trechoVendas).map(brToNumber).filter(v => v !== null)
    if (numerosVendas.length < 4) continue

    const ultimos = numerosVendas.slice(-4)
    const quantVendas = Math.abs(Number(ultimos[0] || 0))
    const estoqueEsc = Number(ultimos[1] || 0)
    const fechamento = Number(ultimos[2] || 0)
    const ajustes = Number(ultimos[3] || 0)

    const precoVenda = obterPrecoLmc(bloco)
    const valorVendas = extrairValorVendasDiaLmc(bloco, quantVendas, precoVenda)

    if (!produto || !data || abertura === null) continue

    registros.push({
      data,
      produto,
      abertura,
      quant_vendas: quantVendas,
      preco_venda: precoVenda,
      valor_vendas: valorVendas,
      estoque_esc: estoqueEsc,
      ajustes,
      fechamento,
    })
  }

  return registros.sort((a, b) => {
    const dif = dataBrParaDate(a.data) - dataBrParaDate(b.data)
    return dif || nomeAbaProdutoLmc(a.produto).localeCompare(nomeAbaProdutoLmc(b.produto))
  })
}

function aplicarFormatacaoLmc(ws) {
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.getRow(1).font = { bold: true }
  const bordaPadrao = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  }
  for (let rowNumber = 1; rowNumber <= ws.rowCount; rowNumber++) {
    const row = ws.getRow(rowNumber)
    for (let colNumber = 1; colNumber <= 9; colNumber++) {
      const cell = row.getCell(colNumber)
      cell.border = bordaPadrao
      cell.alignment = { vertical: 'middle', wrapText: false }
    }
  }
  for (const col of ['C', 'D', 'F', 'G', 'H', 'I']) {
    ws.getColumn(col).numFmt = '#,##0.00;[Red]-#,##0.00'
  }
  ws.getColumn('E').numFmt = '#,##0.000000;[Red]-#,##0.000000'
}

async function gerarExcelLmc(arquivoPdf) {
  const texto = await extrairTextoPdf(arquivoPdf)
  const registros = extrairRegistrosLmc(texto)

  if (!registros.length) {
    throw new Error('Não foi possível identificar movimentos do LMC no PDF selecionado.')
  }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Posto Via 14'
  wb.created = new Date()

  const abas = ['GASOLINA', 'ETANOL', 'DIESEL']
  for (const aba of abas) {
    const ws = wb.addWorksheet(aba)
    ws.columns = [
      { header: 'Data', key: 'data', width: 14 },
      { header: 'Produto', key: 'produto', width: 26 },
      { header: 'Abertura', key: 'abertura', width: 14 },
      { header: 'Quant Vendas', key: 'quant_vendas', width: 16 },
      { header: 'Preço Venda', key: 'preco_venda', width: 14 },
      { header: 'Valor Vendas', key: 'valor_vendas', width: 16 },
      { header: 'Estoque Esc', key: 'estoque_esc', width: 14 },
      { header: 'Ajustes', key: 'ajustes', width: 14 },
      { header: 'Fechamento', key: 'fechamento', width: 14 },
    ]

    registros
      .filter(item => nomeAbaProdutoLmc(item.produto) === aba)
      .forEach(item => ws.addRow(item))

    aplicarFormatacaoLmc(ws)
  }

  const auditoria = wb.addWorksheet('Auditoria')
  auditoria.columns = [
    { header: 'Produto', key: 'produto', width: 18 },
    { header: 'Linhas', key: 'linhas', width: 12 },
    { header: 'Aviso', key: 'aviso', width: 60 },
  ]
  auditoria.getRow(1).font = { bold: true }
  for (const aba of abas) {
    const linhas = registros.filter(item => nomeAbaProdutoLmc(item.produto) === aba)
    auditoria.addRow({
      produto: aba,
      linhas: linhas.length,
      aviso: 'Conferir fechamento de cada dia com abertura do movimento seguinte do mesmo produto.',
    })
  }
  aplicarFormatacaoLmc(auditoria)

  return wb.xlsx.writeBuffer()
}

export async function gerarExcelExtratoBancario(arquivoPdf, opcoes = {}) {
  const banco = typeof opcoes === 'string' ? opcoes : (opcoes?.banco || 'itau')
  if (String(banco).toLowerCase() === 'compras') {
    return gerarExcelComprasCombustivel(arquivoPdf)
  }
  if (String(banco).toLowerCase() === 'lmc') {
    return gerarExcelLmc(arquivoPdf)
  }
  const texto = await extrairTextoPdf(arquivoPdf)
  const lancamentos = extrairLancamentos(texto)

  if (!lancamentos.length) {
    throw new Error('Não foi possível identificar lançamentos bancários no PDF. Verifique se o arquivo é um extrato bancário com texto pesquisável/OCR.')
  }

  const { linhas, auditoria } = consolidarDiariamente(lancamentos, banco)

  if (!linhas.length) {
    throw new Error('Nenhum lançamento válido foi encontrado para gerar a planilha.')
  }

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Posto Via 14'
  wb.created = new Date()

  const ws = wb.addWorksheet('Extrato Consolidado')
  ws.columns = [
    { header: 'Data', key: 'data', width: 14 },
    { header: 'Descrição do lançamento', key: 'descricao', width: 52 },
    { header: 'Valor', key: 'valor', width: 18 },
    { header: 'Saldo', key: 'saldo', width: 18 },
  ]

  linhas.forEach(item => {
    ws.addRow({
      data: item.data,
      descricao: item.descricao,
      valor: item.valor === null || item.valor === undefined ? null : Number(item.valor),
      saldo: item.saldo === null || item.saldo === undefined ? null : Number(item.saldo),
    })
  })

  aplicarFormatacaoPlanilha(ws)
  adicionarAbaAuditoria(wb, auditoria)

  return wb.xlsx.writeBuffer()
}
