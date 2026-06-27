import fs from 'fs';
import { createRequire } from 'module'
import {
  obterEmpresaPadrao,
  obterOuCriarPeriodo,
  salvarComprasNoBanco,
  salvarLmcNoBanco,
  salvarExtratosBanco,  
} from './services/BancoService.js'

const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse')
const NUMERO_BR_RE = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g
const PRODUTOS = ['GASOLINA', 'ETANOL', 'DIESEL']

function brToNumber(valor) {
  if (valor === null || valor === undefined) return null

  const texto = String(valor)
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')

  const numero = Number(texto)
  return Number.isFinite(numero) ? numero : null
}

function converterData(dataBr) {
  const [dia, mes, ano] = String(dataBr).split('/').map(Number)
  return new Date(ano, mes - 1, dia)
}

function ordenarPorData(a, b) {
  return converterData(a.data) - converterData(b.data)
}

function numerosDoTexto(texto) {
  return [...String(texto).matchAll(NUMERO_BR_RE)].map(m => brToNumber(m[0]))
}

function normalizarProduto(valor = '') {
  const texto = String(valor).toUpperCase()

  if (texto.includes('GASOLINA')) return 'GASOLINA'
  if (texto.includes('ETANOL')) return 'ETANOL'
  if (texto.includes('DIESEL')) return 'DIESEL'

  return String(valor).trim()
}

function normalizarDescricaoBanco(descricao = '') {
  return String(descricao)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function limparDescricaoLancamento(descricao = '') {
  return String(descricao)
    .replace(/\d{2}\/\d{2}\/\d{4}/g, '')
    .replace(/\d{2}\/\d{2}(?=\d|\s|-)/g, '')
    .replace(/\d{2}\/\d{2}/g, '')
    .replace(/\/\d{4}/g, '')
    .replace(/\d{2}:\d{2}:\d{2}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function lerPdf(arquivo) {
  const buffer = arquivo?.buffer
    ? arquivo.buffer
    : fs.readFileSync(arquivo)

  const dados = await pdfParse(buffer)

  return dados.text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
}

function pegarProximaLinhaValor(linhas, indice, regex) {
  for (let i = indice + 1; i < Math.min(linhas.length, indice + 15); i++) {
    const texto = linhas[i].trim()
    if (regex.test(texto)) return texto
  }

  return ''
}

function pegarNumeroDepoisDoMarcador(pagina, marcadorRegex) {
  const linhas = pagina.split('\n').map(l => l.trim()).filter(Boolean)
  const indice = linhas.findIndex(l => marcadorRegex.test(l))

  if (indice < 0) return null

  for (let i = indice + 1; i < Math.min(linhas.length, indice + 20); i++) {
    const match = linhas[i].match(NUMERO_BR_RE)
    if (match) return brToNumber(match[0])
  }

  return null
}

function extrairPaginasLmc(texto) {
  return texto
    .split(/LIVRO DE MOVIMENTAÇÃO DE COMBUSTÍVEIS \(LMC\)/i)
    .map(p => p.trim())
    .filter(p => /1\)\s*Produto/i.test(p) && /2\)\s*Data/i.test(p))
}

function extrairProdutoDataLmc(pagina) {
  const linhas = pagina.split('\n').map(l => l.trim()).filter(Boolean)
  const produtoDataLinha = pagina.match(/1\)\s*Produto\s+(.+?)\s+2\)\s*Data\s+(\d{2}\/\d{2}\/\d{4})/i)

  if (produtoDataLinha) {
    return {
      produtoOriginal: produtoDataLinha[1],
      data: produtoDataLinha[2],
    }
  }

  const idxProduto = linhas.findIndex(l => /^1\)\s*Produto$/i.test(l) || /^1\)\s*Produto/i.test(l))
  const idxData = linhas.findIndex(l => /^2\)\s*Data$/i.test(l) || /^2\)\s*Data/i.test(l))

  return {
    produtoOriginal: idxProduto >= 0
      ? pegarProximaLinhaValor(linhas, idxProduto, /(GASOLINA|ETANOL|DIESEL)/i)
      : '',
    data: idxData >= 0
      ? pegarProximaLinhaValor(linhas, idxData, /^\d{2}\/\d{2}\/\d{4}$/)
      : pagina.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || '',
  }
}

function extrairConsolidadoLmc(pagina, abertura, totalRecebido) {
  const bloco = pagina.match(/5\.6\)\s*=\s*Vendas Bico([\s\S]*?)12\)/i)

  if (bloco) {
    const nums = numerosDoTexto(bloco[1])

    if (nums.length >= 4) {
      const [quantVendas, estoqueEsc, fechamento, ajustes] = nums.slice(-4)

      return {
        quantVendas: Math.abs(quantVendas || 0),
        estoqueEsc,
        fechamento,
        ajustes,
      }
    }
  }

  const disponivel = abertura !== null ? Number(abertura) + Number(totalRecebido || 0) : null

  if (disponivel === null) {
    return {
      quantVendas: null,
      estoqueEsc: null,
      fechamento: null,
      ajustes: null,
    }
  }

  const candidatos = numerosDoTexto(pagina).filter(n => n >= 0 && n <= disponivel)
  const fechamento = candidatos.at(-1) ?? null

  if (fechamento === null) {
    return {
      quantVendas: null,
      estoqueEsc: null,
      fechamento: null,
      ajustes: null,
    }
  }

  return {
    quantVendas: Math.abs(disponivel - fechamento),
    estoqueEsc: fechamento,
    fechamento,
    ajustes: 0,
  }
}

function extrairLinhaLmc(pagina) {
  const { produtoOriginal, data } = extrairProdutoDataLmc(pagina)
  const produto = normalizarProduto(produtoOriginal)

  if (!data || !PRODUTOS.includes(produto)) return null

  const abertura = pegarNumeroDepoisDoMarcador(pagina, /3\.1\)\s*Estoque Abertura/i)
  const totalRecebido = pegarNumeroDepoisDoMarcador(pagina, /4\.3\)\s*Total Recebido/i) || 0
  const consolidado = extrairConsolidadoLmc(pagina, abertura, totalRecebido)

  const precoVenda = brToNumber(pagina.match(/\d{1,3},\d{4}/)?.[0]) || 0
  const valorVendas = Math.abs(Number(consolidado.quantVendas || 0)) * Number(precoVenda || 0)

  return {
    data,
    produto,
    abertura,
    quantVendas: consolidado.quantVendas,
    precoVenda,
    valorVendas,
    estoqueEsc: consolidado.estoqueEsc,
    ajustes: consolidado.ajustes,
    fechamento: consolidado.fechamento,
  }
}

async function extrairDadosLmc(arquivoLmc) {
  const texto = await lerPdf(arquivoLmc)
  const dados = { GASOLINA: [], ETANOL: [], DIESEL: [] }

  for (const pagina of extrairPaginasLmc(texto)) {
    const linha = extrairLinhaLmc(pagina)

    if (linha && dados[linha.produto]) {
      dados[linha.produto].push(linha)
    }
  }

  for (const produto of PRODUTOS) {
    dados[produto].sort(ordenarPorData)
  }

  return dados
}

function normalizarTextoPdfCompras(texto = '') {
  return String(texto)
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
}

function extrairLinhasCompras(texto) {
  return normalizarTextoPdfCompras(texto)
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
}

function limparFornecedorCompra(fornecedor = '') {
  return String(fornecedor)
    .replace(/\b(?:DAT\.?\s*MOV\.?|DAT\.?\s*EMISS[AÃ]O|FORNECEDOR|N[º°]?\s*NF|CUSTO|QTDE|VALOR\s*TOTAL)\b/gi, '')
    // Remove o código inicial do cadastro do fornecedor quando vier antes do nome.
    // Ex.: "12345 AUTO POSTO LTDA" ou "12345 - AUTO POSTO LTDA" -> "AUTO POSTO LTDA"
    .replace(/^\s*\d{5}\s*(?:[-–—.]\s*)?/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function ehDataCompra(valor = '') {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(String(valor).trim())
}

function tokenNumeroBr(valor = '') {
  return /^-?\d+(?:\.\d{3})*,\d{2,6}$/.test(String(valor).trim())
}

function extrairRegistroCompra(textoRegistro = '') {
  const registro = String(textoRegistro).replace(/\s+/g, ' ').trim()

  // Formato comum retornado pelo pdf-parse: a linha vem compactada, sem espaços
  // entre DAT. MOV., FORNECEDOR, Nº NF, CUSTO, QTDE, VALOR TOTAL e DAT. EMISSÃO.
  // Exemplo: 06/01/202615 - FORNECEDOR0001614965,3000000,00000010.000,0053.000,0006/01/2026061 1652...
  const compacto = registro.match(/^(\d{2}\/\d{2}\/\d{4})(.+?)(\d{6,12})(-?\d+(?:\.\d{3})*,\d{4,6})(-?\d+(?:\.\d{3})*,\d{4,6})(-?\d+(?:\.\d{3})*,\d{2})(-?\d+(?:\.\d{3})*,\d{2})(\d{2}\/\d{2}\/\d{4})/)

  if (compacto) {
    return {
      data: compacto[1],
      dataEmissao: compacto[8],
      fornecedor: limparFornecedorCompra(compacto[2]),
      nf: compacto[3],
      custo: brToNumber(compacto[4]),
      quantidade: brToNumber(compacto[6]),
      valorTotal: brToNumber(compacto[7]),
    }
  }

  // Formato com espaços/colunas preservadas:
  // DAT. MOV. | DAT. EMISSÃO | FORNECEDOR | Nº NF | CUSTO | QTDE | VALOR TOTAL
  const datas = registro.match(/^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(.+)$/)
  if (!datas) return null

  const dataMov = datas[1]
  const dataEmissao = datas[2]
  const resto = datas[3]

  const numerosComVirgula = [...resto.matchAll(/-?\d+(?:\.\d{3})*,\d{2,6}/g)]
  if (numerosComVirgula.length < 3) return null

  // No relatório real, depois do Nº NF ainda podem existir colunas auxiliares
  // como CST/CFOP/ICMS/FRETE. Por isso não usamos os 3 últimos números da linha.
  // A compra é identificada por: CUSTO = número com 4 a 6 casas decimais,
  // seguido de QTDE e VALOR TOTAL com 2 casas decimais.
  let custoIndex = numerosComVirgula.findIndex(m => /,\d{4,6}$/.test(m[0]))
  if (custoIndex < 0) custoIndex = 0

  let quantidadeIndex = -1
  let valorTotalIndex = -1

  for (let i = custoIndex + 1; i < numerosComVirgula.length; i++) {
    if (/,-?\d{4,6}$/.test(numerosComVirgula[i][0])) continue
    if (/^-?\d+(?:\.\d{3})*,\d{2}$/.test(numerosComVirgula[i][0])) {
      quantidadeIndex = i
      break
    }
  }

  for (let i = quantidadeIndex + 1; i < numerosComVirgula.length; i++) {
    if (/^-?\d+(?:\.\d{3})*,\d{2}$/.test(numerosComVirgula[i][0])) {
      valorTotalIndex = i
      break
    }
  }

  if (quantidadeIndex < 0 || valorTotalIndex < 0) return null

  const custoTexto = numerosComVirgula[custoIndex][0]
  const quantidadeTexto = numerosComVirgula[quantidadeIndex][0]
  const valorTotalTexto = numerosComVirgula[valorTotalIndex][0]

  if (!tokenNumeroBr(custoTexto) || !tokenNumeroBr(quantidadeTexto) || !tokenNumeroBr(valorTotalTexto)) {
    return null
  }

  const prefixo = resto.slice(0, numerosComVirgula[custoIndex].index).trim()
  const notas = [...prefixo.matchAll(/\b(\d{5,12})\b/g)]
  if (!notas.length) return null

  // O Nº NF é o primeiro número longo antes do custo.
  // Isso evita confundir CST/CFOP com a nota fiscal.
  const nota = notas[0]
  const nf = nota[1]
  const fornecedor = limparFornecedorCompra(prefixo.slice(0, nota.index))

  if (!fornecedor || !nf) return null

  return {
    data: dataMov,
    dataEmissao,
    fornecedor,
    nf,
    custo: brToNumber(custoTexto),
    quantidade: brToNumber(quantidadeTexto),
    valorTotal: brToNumber(valorTotalTexto),
  }
}

function normalizarProdutoCompra(produto = '') {
  const texto = String(produto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()

  if (/GASOLINA/.test(texto)) return 'GASOLINA COMUM'
  if (/ETANOL|ALCOOL/.test(texto)) return 'ETANOL COMUM'
  if (/DIESEL.*S-?10|S-?10.*DIESEL/.test(texto)) return 'DIESEL S10'
  if (/DIESEL/.test(texto)) return 'DIESEL'

  return texto
}

function identificarProdutoCompra(linha = '') {
  const texto = String(linha)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()

  // O relatório de compras é totalizado por combustível e traz o nome do produto
  // em uma linha própria antes dos movimentos. Ex.: GASOLINA COMUM, ETANOL COMUM, DIESEL S10.
  if (/^TOTAL\s+DE\s+/.test(texto)) return null
  if (/\bGASOLINA\b/.test(texto) && !/^\d{2}\/\d{2}\/\d{4}/.test(texto)) return normalizarProdutoCompra(texto)
  if (/\bETANOL\b|\bALCOOL\b/.test(texto) && !/^\d{2}\/\d{2}\/\d{4}/.test(texto)) return normalizarProdutoCompra(texto)
  if (/\bDIESEL\b/.test(texto) && !/^\d{2}\/\d{2}\/\d{4}/.test(texto)) return normalizarProdutoCompra(texto)

  return null
}

function montarRegistrosCompras(linhas) {
  const registros = []
  let atual = ''
  let produtoAtual = ''

  for (const linhaOriginal of linhas) {
    const linha = linhaOriginal.trim()
    if (!linha) continue

    const produtoIdentificado = identificarProdutoCompra(linha)
    if (produtoIdentificado) {
      if (atual) registros.push({ texto: atual, produto: produtoAtual })
      atual = ''
      produtoAtual = produtoIdentificado
      continue
    }

    if (/^(TOTAL|SUBTOTAL)\b/i.test(linha)) {
      if (atual) registros.push({ texto: atual, produto: produtoAtual })
      atual = ''
      continue
    }

    // Ignora cabeçalhos, mas preserva linhas de dados que começam com data.
    if (!/^\d{2}\/\d{2}\/\d{4}/.test(linha) && /DAT\.?\s*MOV|DAT\.?\s*EMISS|FORNECEDOR|VALOR\s*TOTAL/i.test(linha)) {
      continue
    }

    if (/^\d{2}\/\d{2}\/\d{4}/.test(linha)) {
      if (atual) registros.push({ texto: atual, produto: produtoAtual })
      atual = linha
    } else if (atual) {
      atual += ' ' + linha
    }
  }

  if (atual) registros.push({ texto: atual, produto: produtoAtual })
  return registros
}

async function extrairDadosCompras(arquivoCompras) {
  if (!arquivoCompras) return []

  const texto = await lerPdf(arquivoCompras)
  const linhas = extrairLinhasCompras(texto)
  const registros = montarRegistrosCompras(linhas)
  const compras = []

  for (const registro of registros) {
    const compra = extrairRegistroCompra(registro.texto || registro)
    if (!compra) continue

    compra.produto = normalizarProdutoCompra(registro.produto || compra.produto || '')

    const existe = compras.some(c =>
      c.data === compra.data &&
      c.dataEmissao === compra.dataEmissao &&
      c.produto === compra.produto &&
      c.fornecedor === compra.fornecedor &&
      c.nf === compra.nf &&
      Math.abs(Number(c.quantidade || 0) - Number(compra.quantidade || 0)) < 0.01 &&
      Math.abs(Number(c.valorTotal || 0) - Number(compra.valorTotal || 0)) < 0.01
    )

    if (!existe) compras.push(compra)
  }

  compras.sort(ordenarPorData)

  console.log(`COMPRAS encontradas: ${compras.length}`)
  compras.forEach(c => {
    console.log(`${c.data} | ${c.dataEmissao} | ${c.produto || ''} | ${c.fornecedor} | NF ${c.nf} | ${c.custo} | ${c.quantidade} | ${c.valorTotal}`)
  })

  return compras
}

function limparLinhasPdf(texto) {
  return texto
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .filter(l => !l.startsWith('https://'))
    .filter(l => !l.includes('Página:'))
    .filter(l => !l.includes('about:blank'))
    .filter(l => !/^\d{2}\/\d{2}\/\d{2},/.test(l))
}

function unirLinhasBanco(linhas) {
  const unidas = []

  for (const linha of linhas) {
    if (/^\d{2}\/\d{2}(?:\/\d{4})?/.test(linha)) {
      unidas.push(linha)
    } else if (unidas.length) {
      unidas[unidas.length - 1] += ` ${linha}`
    }
  }

  return unidas
}

function prepararTextoBancoParaValor(texto = '') {
  return String(texto)
    .replace(/\d{2}\/\d{2}\/\d{4}/g, ' ')
    .replace(/\d{2}\/\d{2}(?=\d|\s|-)/g, ' ')
    .replace(/\d{2}\/\d{2}/g, ' ')
    .replace(/\/\d{4}/g, ' ')
    .replace(/\d{2}:\d{2}:\d{2}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function separarAtmDoValor(texto = '') {
  return String(texto)
    .replace(/(DEP DIN ATM N\.\s*\d{9})(?=-?\d{1,3}(?:\.\d{3})*,\d{2})/gi, '$1 ')
    .replace(/(DEP DIN ATM N\.\s*\d{9})(?=-?\d{1,3},\d{2})/gi, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extrairDataLinhaBanco(linha) {
  const match = String(linha).match(/^(\d{2}\/\d{2})(?:\/(\d{4}))?/)
  if (!match) return null

  return {
    data: `${match[1]}/${match[2] || '2026'}`,
    prefixoData: match[0],
  }
}

function extrairSaldoAnterior(linha, data) {
  const match = String(linha).match(/SALDO\s+ANTERIOR\s*R?\$?\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/i)
  const valores = match ? [match[1]] : [...String(linha).matchAll(NUMERO_BR_RE)].map(m => m[0])
  const saldo = valores.length ? brToNumber(valores.at(-1)) : null

  if (saldo === null) return null

  return {
    data,
    descricao: 'Saldo anterior',
    valor: null,
    saldo,
    tipo: 'SALDO_ANTERIOR',
  }
}

function extrairSaldoDia(linha, data, descricao) {
  const textoSaldo = prepararTextoBancoParaValor(linha)
  const valores = [...textoSaldo.matchAll(NUMERO_BR_RE)]

  if (!valores.length) return null

  return {
    data,
    descricao,
    valor: null,
    saldo: brToNumber(valores.at(-1)[0]),
    tipo: 'SALDO',
  }
}

function extrairMovimentoBanco(linha, data, prefixoData) {
  const restoOriginal = String(linha)
    .replace(new RegExp(`^${prefixoData.replace(/\//g, '\\/')}\\s*`), '')
    .replace(/^\d{2}:\d{2}:\d{2}\s*/, '')
    .trim()

  const textoParaValor = separarAtmDoValor(prepararTextoBancoParaValor(restoOriginal))
  const valores = [...textoParaValor.matchAll(NUMERO_BR_RE)]

  if (!valores.length) return null

  const ultimoValor = valores.at(-1)
  const valor = brToNumber(ultimoValor[0])
  const descricao = limparDescricaoLancamento(textoParaValor.slice(0, ultimoValor.index).trim())

  if (!descricao) return null

  return {
    data,
    descricao,
    valor,
    saldo: null,
    tipo: valor < 0 ? 'DÉBITO' : 'CRÉDITO',
  }
}

function parseLinhaSpot(linha) {
  if (/SALDO FINAL/i.test(linha)) return null

  const dataLinha = extrairDataLinhaBanco(linha)
  if (!dataLinha) return null

  const { data, prefixoData } = dataLinha

  if (/SALDO\s+ANTERIOR/i.test(linha)) {
    return extrairSaldoAnterior(linha, data)
  }

  if (/Saldo do dia/i.test(linha)) {
    return extrairSaldoDia(linha, data, 'Saldo do dia')
  }

  return extrairMovimentoBanco(linha, data, prefixoData)
}

function parseLinhaItau(linha) {
  const dataLinha = extrairDataLinhaBanco(linha)
  if (!dataLinha) return null

  const { data, prefixoData } = dataLinha

  if (/SALDO ANTERIOR/i.test(linha)) {
    return extrairSaldoAnterior(linha, data)
  }

  if (/SALDO TOTAL DISPON[IÍ]VEL DIA/i.test(linha)) {
    return extrairSaldoDia(linha, data, 'Saldo total disponível dia')
  }

  return extrairMovimentoBanco(linha, data, prefixoData)
}

function agruparPorData(lancamentos) {
  return lancamentos.reduce((acc, item) => {
    if (!acc[item.data]) acc[item.data] = []
    acc[item.data].push(item)
    return acc
  }, {})
}

function somar(linhas) {
  return linhas.reduce((total, item) => total + Number(item.valor || 0), 0)
}

function buscarSaldoAnteriorCorreto(lancamentos) {
  const saldosAnteriores = lancamentos
    .filter(l => l.tipo === 'SALDO_ANTERIOR')
    .sort(ordenarPorData)

  return saldosAnteriores[0] || null
}

function classificarMovimentosBanco(movimentos, banco, data) {
  const grupos = {
    creditoPix: [],
    tarifaRecebimento: [],
    tarifaEnvio: [],
    pixDepositos: [],
    creditoVendas: [],
    demais: [],
  }

  for (const item of movimentos) {
    const descricao = limparDescricaoLancamento(item.descricao)
    const desc = normalizarDescricaoBanco(descricao).toLowerCase()
    const valor = Number(item.valor || 0)
    const linha = { data, descricao, valor, saldo: null }

    if (banco === 'SPOT') {
      if (desc.includes('credito de vendas') || desc.includes('credito vendas') || desc === 'de vendas') {
        grupos.creditoVendas.push(linha)
        continue
      }

      if ((desc.includes('credito pix') || desc.startsWith('pix ')) && valor > 0 && valor <= 2000) {
        grupos.creditoPix.push(linha)
        continue
      }

      if (desc.includes('tarifa pix') && desc.includes('recebimento')) {
        grupos.tarifaRecebimento.push(linha)
        continue
      }

      if (desc.includes('tarifa pix') && desc.includes('envio')) {
        grupos.tarifaEnvio.push(linha)
        continue
      }

    }

    if (
      banco === 'ITAU' &&
      valor > 0 &&
      (desc.includes('pix qrs') || desc.includes('dep din atm'))
    ) {
      grupos.pixDepositos.push(linha)
      continue
    }

    grupos.demais.push(linha)
  }

  return grupos
}

function adicionarLinhaSeHouver(saida, data, descricao, linhas) {
  if (!linhas.length) return

  saida.push({
    data,
    descricao,
    valor: somar(linhas),
    saldo: null,
  })
}

function aplicarSaldoFinalDia(saida, inicioDia, data, saldoFinalDia) {
  if (!saldoFinalDia) return

  for (let i = saida.length - 1; i >= inicioDia; i--) {
    if (saida[i]?.data === data && saida[i]?.descricao !== 'Saldo anterior') {
      saida[i].saldo = saldoFinalDia.saldo
      return
    }
  }
}

function montarLinhasBancoAgrupado(lancamentos, banco) {
  const porData = agruparPorData(lancamentos)
  const datas = Object.keys(porData).sort((a, b) => converterData(a) - converterData(b))

  const saida = []
  let saldoAnteriorIncluido = false

  const saldoAnteriorCorreto = buscarSaldoAnteriorCorreto(lancamentos)

  for (const data of datas) {
    const linhas = porData[data]
    const saldoFinalDia = linhas.find(l => l.tipo === 'SALDO')
    const inicioDia = saida.length

    if (!saldoAnteriorIncluido && saldoAnteriorCorreto) {
      saida.push({
        data: saldoAnteriorCorreto.data,
        descricao: 'Saldo anterior',
        valor: null,
        saldo: saldoAnteriorCorreto.saldo,
      })

      saldoAnteriorIncluido = true
    }

    const movimentos = linhas.filter(l => l.tipo !== 'SALDO' && l.tipo !== 'SALDO_ANTERIOR')

    const creditoPix = []
    const tarifaRecebimento = []
    const tarifaEnvio = []
    const creditoVendas = []

    const depDinAtm = []
    const pixQrs = []
    const pixTransf = []

    const demais = []

    for (const item of movimentos) {
      const descricaoLimpa = limparDescricaoLancamento(item.descricao)
      const desc = normalizarDescricaoBanco(descricaoLimpa).toLowerCase()
      const valor = Number(item.valor || 0)

      const linha = {
        data,
        descricao: descricaoLimpa,
        valor,
        saldo: null,
      }

      if (banco === 'SPOT') {
        if (desc.includes('credito de vendas') || desc.includes('credito vendas') || desc === 'de vendas') {
          creditoVendas.push(linha)
          continue
        }

        if ((desc.includes('credito pix') || desc.startsWith('pix ')) && valor > 0 && valor <= 2000) {
          creditoPix.push(linha)
          continue
        }

        if (desc.includes('tarifa pix') && desc.includes('recebimento')) {
          tarifaRecebimento.push(linha)
          continue
        }

        if (desc.includes('tarifa pix') && desc.includes('envio')) {
          tarifaEnvio.push(linha)
          continue
        }
      }

      if (banco === 'ITAU') {
        if (valor > 0 && desc.includes('dep din atm')) {
          depDinAtm.push(linha)
          continue
        }

        if (valor > 0 && desc.includes('pix qrs')) {
          pixQrs.push(linha)
          continue
        }

        if (valor > 0 && desc.includes('pix transf')) {
          pixTransf.push(linha)
          continue
        }
      }

      demais.push(linha)
    }

    if (creditoVendas.length) {
      saida.push({
        data,
        descricao: 'Credito Vendas Cartão',
        valor: somar(creditoVendas),
        saldo: null,
      })
    }

    if (creditoPix.length) {
      saida.push({
        data,
        descricao: 'Pix recebido maquininha',
        valor: somar(creditoPix),
        saldo: null,
      })
    }

    if (tarifaRecebimento.length) {
      saida.push({
        data,
        descricao: 'Tarifa pix recebido maquininha',
        valor: somar(tarifaRecebimento),
        saldo: null,
      })
    }

    if (tarifaEnvio.length) {
      saida.push({
        data,
        descricao: 'Tarifa pix enviado',
        valor: somar(tarifaEnvio),
        saldo: null,
      })
    }

    if (banco === 'ITAU') {
      const totalPixDia = [...pixQrs, ...pixTransf]

      if (totalPixDia.length) {
        saida.push({
          data,
          descricao: 'Total Pix no dia',
          valor: somar(totalPixDia),
          saldo: null,
        })
      }

      if (depDinAtm.length) {
        saida.push({
          data,
          descricao: 'Total Dep Dinheiro ATM',
          valor: somar(depDinAtm),
          saldo: null,
        })
      }
    } else {
      if (depDinAtm.length) {
        saida.push({
          data,
          descricao: 'Dep Din ATM',
          valor: somar(depDinAtm),
          saldo: null,
        })
      }

      if (pixQrs.length) {
        saida.push({
          data,
          descricao: 'Pix QRS',
          valor: somar(pixQrs),
          saldo: null,
        })
      }

      if (pixTransf.length) {
        saida.push({
          data,
          descricao: 'Pix Transf',
          valor: somar(pixTransf),
          saldo: null,
        })
      }
    }

    demais.forEach(linha => {
      saida.push({
        data,
        descricao: linha.descricao,
        valor: linha.valor,
        saldo: null,
      })
    })

    if (saldoFinalDia) {
      saida.push({
        data,
        descricao: 'Saldo do dia',
        valor: null,
        saldo: saldoFinalDia.saldo,
      })
    }
  }

  return saida
}

function montarLinhasBancoSpot(lancamentos) {
  return montarLinhasBancoAgrupado(lancamentos, 'SPOT')
}

function montarLinhasBancoItau(lancamentos) {
  return montarLinhasBancoAgrupado(lancamentos, 'ITAU')
}

function limparLinhaItau(texto = '') {
  return String(texto)
    .replace(/[]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extrairValoresPaginaItau(pagina) {
  const linhas = String(pagina).split('\n')
  const indicesTabela = []

  linhas.forEach((linha, indice) => {
    if (/^Data\s*data\s*lançamentos$/i.test(limparLinhaItau(linha)) || /^Data\s*datalançamentos$/i.test(limparLinhaItau(linha))) {
      indicesTabela.push(indice)
    }
  })

  const inicioTabela = indicesTabela.length ? indicesTabela.at(-1) : linhas.length
  const antesTabela = linhas.slice(0, inicioTabela).join('\n')

  return [...antesTabela.matchAll(NUMERO_BR_RE)].map(m => brToNumber(m[0]))
}

function linhaIgnoradaItau(linha) {
  const texto = limparLinhaItau(linha)
  const normalizado = normalizarDescricaoBanco(texto)

  return !texto ||
    /^https?:\/\//i.test(texto) ||
    /extrato \| banco itau/i.test(texto) ||
    /^\d+\/\d+$/.test(texto) ||
    /^valor$/i.test(texto) ||
    /^\(R\$\)$/i.test(texto) ||
    /^saldo$/i.test(texto) ||
    /^detalhes$/i.test(texto) ||
    /^Data\s*data\s*lançamentos$/i.test(texto) ||
    /^Data\s*datalançamentos$/i.test(texto) ||
    /^entradas\/sa[ií]das$/i.test(texto) ||
    normalizado === 'TABELA CONTENDO OS LANCAMENTOS DA CONTA' ||
    /^(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+\d{4}$/i.test(texto)
}

function extrairLinhasTabelaItau(pagina) {
  const todasLinhas = String(pagina)
    .split('\n')
    .map(limparLinhaItau)
    .filter(Boolean)

  const indicesTabela = []

  todasLinhas.forEach((linha, indice) => {
    if (/^Data\s*data\s*lançamentos$/i.test(linha) || /^Data\s*datalançamentos$/i.test(linha)) {
      indicesTabela.push(indice)
    }
  })

  if (!indicesTabela.length) return []

  const linhas = todasLinhas.slice(indicesTabela.at(-1) + 1)

  const saida = []
  let atual = null

  for (const linha of linhas) {
    if (/^https?:\/\//i.test(linha) || /extrato \| banco itau/i.test(linha)) break
    if (linhaIgnoradaItau(linha)) continue

    const matchData = linha.match(/^(\d{2}\/\d{2}\/\d{4})(.*)$/)

    if (matchData) {
      if (atual) saida.push(atual)

      atual = {
        data: matchData[1],
        descricao: limparLinhaItau(matchData[2] || ''),
      }

      continue
    }

    if (atual && !linhaIgnoradaItau(linha)) {
      atual.descricao = limparLinhaItau(`${atual.descricao} ${linha}`)
    }
  }

  if (atual) saida.push(atual)

  return saida.filter(l => l.data && l.descricao)
}

function extrairPaginasItau(texto) {
  return String(texto)
    .split(/https:\/\/internetpf4\.itau\.com\.br\/router-app\/router#30horas\s*\d+\/\d+/i)
    .map(p => p.trim())
    .filter(p => /^Data\s*data\s*lançamentos$/im.test(p) || /^Data\s*datalançamentos$/im.test(p))
}

function extrairLancamentosItauPorPagina(texto) {
  const textoItau = String(texto).split(/posição consolidada/i)[0]
  const paginas = extrairPaginasItau(textoItau)
  const lancamentos = []

  for (const pagina of paginas) {
    const linhas = extrairLinhasTabelaItau(pagina)
    if (!linhas.length) continue

    let valores = extrairValoresPaginaItau(pagina)

    // Quando a página possui quadro de lançamentos futuros, o primeiro valor pertence
    // a esse quadro. Como as linhas extraídas são apenas da conta, mantemos os últimos
    // valores, que correspondem à tabela de entradas/saídas.
    if (valores.length > linhas.length) {
      valores = valores.slice(valores.length - linhas.length)
    }

    linhas.forEach((linha, indice) => {
      const numero = valores[indice]
      if (numero === null || numero === undefined) return

      if (/SALDO TOTAL DISPON[IÍ]VEL DIA/i.test(linha.descricao)) {
        lancamentos.push({
          data: linha.data,
          descricao: 'Saldo total disponível dia',
          valor: null,
          saldo: numero,
          tipo: 'SALDO',
        })
        return
      }

      if (/SALDO ANTERIOR/i.test(linha.descricao)) {
        lancamentos.push({
          data: linha.data,
          descricao: 'Saldo anterior',
          valor: null,
          saldo: numero,
          tipo: 'SALDO_ANTERIOR',
        })
        return
      }

      lancamentos.push({
        data: linha.data,
        descricao: limparDescricaoLancamento(linha.descricao),
        valor: numero,
        saldo: null,
        tipo: numero < 0 ? 'DÉBITO' : 'CRÉDITO',
      })
    })
  }

  return lancamentos
}

async function extrairDadosBanco(arquivoBanco, banco) {
  if (!arquivoBanco) return []

  let texto = await lerPdf(arquivoBanco)

  if (banco === 'ITAU') {
    const lancamentosItau = extrairLancamentosItauPorPagina(texto)
    return montarLinhasBancoItau(lancamentosItau)
  }

  const linhas = unirLinhasBanco(limparLinhasPdf(texto))
  const lancamentos = linhas
    .map(linha => parseLinhaSpot(linha))
    .filter(Boolean)

  return montarLinhasBancoSpot(lancamentos)
}

export async function importarPdfsBanco({
  arquivoLmc,
  arquivoCompras,
  arquivoSpot,
  arquivoItau,
}) {
  const empresa = await obterEmpresaPadrao()

  let totalLmc = 0
  let totalCompras = 0
  let totalSpot = 0
  let totalItau = 0

  if (arquivoLmc) {
    const dadosLmc = await extrairDadosLmc(arquivoLmc)

    totalLmc = await salvarLmcNoBanco({
      empresaId: empresa.id,
      dadosLmc,
    })
  }

  if (arquivoCompras) {
    const compras = await extrairDadosCompras(arquivoCompras)

    totalCompras = await salvarComprasNoBanco({
      empresaId: empresa.id,
      compras,
    })
  }

  if (arquivoSpot) {
    const dadosSpot = await extrairDadosBanco(arquivoSpot, 'SPOT')

    totalSpot = await salvarExtratosBanco({
      empresaId: empresa.id,
      origem: 'SPOT',
      lancamentos: dadosSpot,
    })
  }

  if (arquivoItau) {
    const dadosItau = await extrairDadosBanco(arquivoItau, 'ITAU')

    totalItau = await salvarExtratosBanco({
      empresaId: empresa.id,
      origem: 'ITAU',
      lancamentos: dadosItau,
    })
  }

  return {
    lmc: totalLmc,
    compras: totalCompras,
    spot: totalSpot,
    itau: totalItau,
  }
}
