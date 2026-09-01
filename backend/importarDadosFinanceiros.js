import { db } from './db.js'
import { importarExcelBanco } from './importarExcelBanco.js'
import { gerarExcelExtratoBancario } from './pdfExtratoExcel.js'
import XLSX from 'xlsx'

function extensao(nome='') { return String(nome).toLowerCase().split('.').pop() || '' }
function arquivoExcelEmMemoria(buffer, originalname) {
  return { buffer: Buffer.from(buffer), originalname: String(originalname || 'arquivo').replace(/\.pdf$/i, '.xlsx'), mimetype:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
}
function parserBanco(valor='') {
  const n=String(valor).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  if (n.includes('valori')) return 'valori'
  if (n.includes('spot')) return 'spot'
  return 'itau'
}

export async function importarDadosFinanceiros({ arquivo, tipoDados, contaBancariaId, dataInicial, dataFinal }) {
  if (!arquivo) throw new Error('Nenhum arquivo foi recebido.')
  const ext=extensao(arquivo.originalname)
  if (!['pdf','xls','xlsx'].includes(ext)) throw new Error('Formato não suportado. Envie PDF, XLS ou XLSX.')
  const tipo=String(tipoDados||'extrato')
  if (!['extrato','compras','lmc','vendasCartao'].includes(tipo)) throw new Error('Tipo de dados inválido.')
  if (tipo==='extrato' && !Number(contaBancariaId)) throw new Error('Selecione a conta bancária de destino.')
  if (ext==='pdf' && tipo==='vendasCartao') throw new Error('Vendas de cartão em PDF ainda não possuem parser configurado. Use XLS ou XLSX.')

  let arquivoImportacao=arquivo
  if (ext==='xls') {
    const wbXls=XLSX.read(arquivo.buffer,{type:'buffer',cellDates:true})
    const bufferXlsx=XLSX.write(wbXls,{type:'buffer',bookType:'xlsx'})
    arquivoImportacao=arquivoExcelEmMemoria(bufferXlsx,arquivo.originalname)
  }
  if (ext==='pdf') {
    let banco='itau'
    if (tipo==='extrato') {
      const [contas]=await db.query('SELECT id,nome_conta,instituicao FROM contas_bancarias WHERE id=? LIMIT 1',[Number(contaBancariaId)])
      if (!contas[0]) throw new Error('Conta bancária selecionada não encontrada.')
      banco=parserBanco(`${contas[0].instituicao||''} ${contas[0].nome_conta||''}`)
    } else if (tipo==='compras') banco='compras'
    else if (tipo==='lmc') banco='lmc'
    const buffer=await gerarExcelExtratoBancario(arquivo,{banco})
    arquivoImportacao=arquivoExcelEmMemoria(buffer,arquivo.originalname)
  }

  const args={ dataInicial,dataFinal,contaBancariaId:Number(contaBancariaId)||null, arquivoLmc:null,arquivoCompras:null,arquivoVendasCartao:null,arquivoExtrato:null,arquivoSpot:null,arquivoItau:null }
  if (tipo==='extrato') args.arquivoExtrato=arquivoImportacao
  else if (tipo==='compras') args.arquivoCompras=arquivoImportacao
  else if (tipo==='lmc') args.arquivoLmc=arquivoImportacao
  else args.arquivoVendasCartao=arquivoImportacao
  return importarExcelBanco(args)
}
