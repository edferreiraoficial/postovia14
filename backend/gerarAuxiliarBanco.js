import ExcelJS from 'exceljs'
import path from 'path'
import fs from 'fs'
import { db } from './db.js'

function formatarData(data) {
  if (!data) return null
  return new Date(data)
}

function criarAbaCombustivel(workbook, nome) {
  const ws = workbook.addWorksheet(nome)

  ws.columns = [
    { header: 'Data', key: 'data', width: 14 },
    { header: 'Produto', key: 'produto', width: 18 },
    { header: 'Abertura', key: 'abertura', width: 14 },
    { header: 'Quant Vendas', key: 'quantVendas', width: 16 },
    { header: 'Preço Venda', key: 'precoVenda', width: 14 },
    { header: 'Valor Vendas', key: 'valorVendas', width: 16 },
    { header: 'Estoque Esc', key: 'estoqueEsc', width: 14 },
    { header: 'Ajustes', key: 'ajustes', width: 14 },
    { header: 'Fechamento', key: 'fechamento', width: 14 },
  ]

  return ws
}

function criarAbaBanco(workbook, nome) {
  const ws = workbook.addWorksheet(nome)

  ws.columns = [
    { header: 'Data', key: 'data', width: 14 },
    { header: 'Descrição do lançamento', key: 'descricao', width: 57 },
    { header: 'Valor', key: 'valor', width: 18 },
    { header: 'Saldo', key: 'saldo', width: 18 },
  ]

  return ws
}

export async function gerarPlanilhaAuxiliarDoBanco({
  nomeArquivo = 'Planilha_Estoque_Banco_BD.xlsx',
  ano = 2026,
  mes = 3,
  dataInicial = null,
  dataFinal = null,
} = {}) {
  const workbook = new ExcelJS.Workbook()

  const abasCombustivel = {
    GASOLINA: criarAbaCombustivel(workbook, 'GASOLINA'),
    ETANOL: criarAbaCombustivel(workbook, 'ETANOL'),
    DIESEL: criarAbaCombustivel(workbook, 'DIESEL'),
  }

  const abaSpot = criarAbaBanco(workbook, 'SPOT')
  const abaItau = criarAbaBanco(workbook, 'ITAU')

  const filtroPeriodoLmc = dataInicial && dataFinal
    ? { where: 'DATE(l.data_movimento) BETWEEN ? AND ?', params: [dataInicial, dataFinal] }
    : { where: 'YEAR(l.data_movimento) = ? AND MONTH(l.data_movimento) = ?', params: [ano, mes] }

  const [lmc] = await db.query(
    `
    SELECT 
      l.data_movimento,
      p.nome AS produto,
      l.estoque_abertura,
      l.quantidade_vendas,
      l.valor_vendas,
      l.ajuste_quantidade,
      l.estoque_fechamento
    FROM lmc_movimentos l
    LEFT JOIN produtos p ON p.id = l.produto_id
    WHERE ${filtroPeriodoLmc.where}
    ORDER BY l.data_movimento, p.nome
    `,
    filtroPeriodoLmc.params
  )

  for (const item of lmc) {
    const produto = String(item.produto || '').toUpperCase()

    const aba =
      produto.includes('GASOLINA') ? abasCombustivel.GASOLINA :
      produto.includes('ETANOL') ? abasCombustivel.ETANOL :
      produto.includes('DIESEL') ? abasCombustivel.DIESEL :
      null

    if (!aba) continue

    const quantVendas = Number(item.quantidade_vendas || 0)
    const valorVendas = Number(item.valor_vendas || 0)
    const precoVenda = quantVendas ? valorVendas / quantVendas : 0

    aba.addRow({
      data: formatarData(item.data_movimento),
      produto,
      abertura: Number(item.estoque_abertura || 0),
      quantVendas,
      precoVenda,
      valorVendas,
      estoqueEsc: Number(item.estoque_fechamento || 0),
      ajustes: Number(item.ajuste_quantidade || 0),
      fechamento: Number(item.estoque_fechamento || 0),
    })
  }

  const filtroPeriodoBanco = dataInicial && dataFinal
    ? { where: 'DATE(data_lancamento) BETWEEN ? AND ?', params: [dataInicial, dataFinal] }
    : { where: 'YEAR(data_lancamento) = ? AND MONTH(data_lancamento) = ?', params: [ano, mes] }

  const [bancos] = await db.query(
    `
    SELECT
      data_lancamento,
      origem,
      descricao_original,
      valor,
      saldo
    FROM extratos_bancarios
    WHERE ${filtroPeriodoBanco.where}
    ORDER BY data_lancamento, origem, id
    `,
    filtroPeriodoBanco.params
  )

  for (const item of bancos) {
    const origem = String(item.origem || '').toUpperCase()
    const aba = origem === 'SPOT' ? abaSpot : origem === 'ITAU' ? abaItau : null

    if (!aba) continue

    aba.addRow({
      data: formatarData(item.data_lancamento),
      descricao: item.descricao_original,
      valor: Number(item.valor || 0),
      saldo: item.saldo === null ? null : Number(item.saldo),
    })
  }

  const pastaSaida = path.resolve('output')

  if (!fs.existsSync(pastaSaida)) {
    fs.mkdirSync(pastaSaida, { recursive: true })
  }

  const nomeFinal = nomeArquivo.endsWith('.xlsx')
    ? nomeArquivo
    : `${nomeArquivo}.xlsx`

  const caminhoArquivo = path.join(pastaSaida, nomeFinal)

  await workbook.xlsx.writeFile(caminhoArquivo)

  return caminhoArquivo
}