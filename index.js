import express from 'express'
import mysql from 'mysql2/promise'
import ExcelJS from 'exceljs'
import pdf from 'pdf-parse'
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './backend/db.js';
import { gerarPlanilhaAuxiliarDoBanco } from './backend/gerarAuxiliarBanco.js'
import { importarPdfsBanco } from './backend/importarPdfsBanco.js'
import { processarPlanilhas } from './backend/processar.js'

const app = express()
const PORT = process.env.PORT || 3001
const upload = multer({ storage: multer.memoryStorage() })
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
})

app.use(express.static(path.join(__dirname, 'docs')))

app.get('/', (req, res) => {
  res.send('Backend Posto Via 14 online')
})

app.get('/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS teste')

    res.json({
      status: 'ok',
      mysql: true,
      resultado: rows[0]
    })
  } catch (error) {
    res.status(500).json({
      status: 'erro',
      mysql: false,
      erro: error.message
    })
  }
})

app.get('/teste-excel', async (req, res) => {
  const wb = new ExcelJS.Workbook()
  wb.addWorksheet('TESTE')
  res.json({ ok: true })
})

app.get('/teste-pdf', (req, res) => {
  res.json({
    ok: true,
    pdfCarregado: !!pdf
  })
})

app.get('/teste-gerador', (req, res) => {
  res.json({
    ok: true,
    tipo: typeof gerarPlanilhaAuxiliarDoBanco
  })
})

app.get('/api/teste-gerar-auxiliar', async (req, res) => {
  try {
    const arquivo = await gerarPlanilhaAuxiliarDoBanco({
      nomeArquivo: 'teste_auxiliar.xlsx',
      ano: 2026,
      mes: 3,
    })

    res.json({
      ok: true,
      arquivo
    })
  } catch (error) {
    console.error('ERRO TESTE GERAR AUXILIAR:', error)

    res.status(500).json({
      ok: false,
      erro: error.message,
      stack: error.stack
    })
  }
})

app.get('/teste-importador', (req, res) => {
  res.json({
    ok: true,
    tipo: typeof importarPdfsBanco
  })
})

app.get('/teste-processar', (req, res) => {
  res.json({
    ok: true,
    tipo: typeof processarPlanilhas
  })
}) 

/// rotas reais 
app.post('/api/gerar-auxiliar-banco', async (req, res) => {
  try {
    const arquivo = await gerarPlanilhaAuxiliarDoBanco({
      nomeArquivo: 'Planilha_Estoque_Banco_BD.xlsx',
      ano: 2026,
      mes: 3,
    })

    res.json({
      ok: true,
      arquivo,
    })
  } catch (error) {
    console.error('ERRO /api/gerar-auxiliar-banco:', error)

    res.status(500).json({
      ok: false,
      erro: error.message,
    })
  }
})

app.post('/api/importar-pdfs', upload.fields([
  { name: 'lmc', maxCount: 10 },
  { name: 'compras', maxCount: 10 },
  { name: 'spot', maxCount: 10 },
  { name: 'itau', maxCount: 10 },
]), async (req, res) => {
  try {
    const files = req.files || {}

    const arquivoLmc = files.lmc?.[0] || null
    const arquivoCompras = files.compras?.[0] || null
    const arquivoSpot = files.spot?.[0] || null
    const arquivoItau = files.itau?.[0] || null

    if (!arquivoLmc && !arquivoCompras && !arquivoSpot && !arquivoItau) {
      return res.status(400).json({
        ok: false,
        erro: 'Nenhum arquivo PDF foi recebido.',
      })
    }

    const resultado = await importarPdfsBanco({
      arquivoLmc,
      arquivoCompras,
      arquivoSpot,
      arquivoItau,
    })

    res.json({
      ok: true,
      mensagem: 'PDFs importados para o banco de dados com sucesso.',
      resultado,
      recebidos: {
        lmc: arquivoLmc ? 1 : 0,
        compras: arquivoCompras ? 1 : 0,
        spot: arquivoSpot ? 1 : 0,
        itau: arquivoItau ? 1 : 0,
      },
    })
  } catch (error) {
    console.error('ERRO /api/importar-pdfs:', error)

    res.status(500).json({
      ok: false,
      erro: error.message,
    })
  }
})

app.post('/api/processar', upload.fields([
  { name: 'principal', maxCount: 1 },
  { name: 'secundaria', maxCount: 1 },
]), async (req, res) => {
  try {
    const resultado = await processarPlanilhas(req.files, req.body)

    res.json({
      ok: true,
      resultado,
    })
  } catch (error) {
    console.error('ERRO /api/processar:', error)

    res.status(500).json({
      ok: false,
      erro: error.message,
    })
  }
})

app.get('/api/dashboard', async (req, res) => {
  try {
    const [vendas] = await db.query(`
      SELECT
        p.nome AS produto,
        SUM(l.quantidade_vendas) AS quantidade,
        SUM(l.valor_vendas) AS receita,
        CASE 
          WHEN SUM(l.quantidade_vendas) > 0 
          THEN SUM(l.valor_vendas) / SUM(l.quantidade_vendas)
          ELSE 0
        END AS preco_medio
      FROM lmc_movimentos l
      LEFT JOIN produtos p ON p.id = l.produto_id
      GROUP BY p.nome
      ORDER BY p.nome
    `)

    const [[total]] = await db.query(`
      SELECT
        SUM(quantidade_vendas) AS quantidade_total,
        SUM(valor_vendas) AS receita_total
      FROM lmc_movimentos
    `)

    res.json({
      ok: true,
      vendas,
      total
    })
  } catch (error) {
    res.status(500).json({
      ok: false,
      erro: error.message
    })
  }
})

app.get('/api/dashboard/mensal', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        DATE_FORMAT(l.data_movimento, '%Y-%m') AS mes,
        p.nome AS produto,
        SUM(l.quantidade_vendas) AS quantidade,
        SUM(l.valor_vendas) AS receita,
        CASE
          WHEN SUM(l.quantidade_vendas) > 0
          THEN SUM(l.valor_vendas) / SUM(l.quantidade_vendas)
          ELSE 0
        END AS preco_medio
      FROM lmc_movimentos l
      LEFT JOIN produtos p ON p.id = l.produto_id
      GROUP BY mes, p.nome
      ORDER BY mes ASC, p.nome ASC
    `)

    res.json({
      ok: true,
      dados: rows
    })
  } catch (error) {
    console.error('ERRO /api/dashboard/mensal:', error)

    res.status(500).json({
      ok: false,
      erro: error.message
    })
  }
})

app.get('/api/dashboard/financeiro', async (req, res) => {
  try {
    const [entradas] = await db.query(`
      SELECT
        origem,
        SUM(valor) total
      FROM extratos_bancarios
      WHERE valor > 0
      GROUP BY origem
      ORDER BY origem
    `)

    const [saidas] = await db.query(`
      SELECT
        origem,
        SUM(ABS(valor)) total
      FROM extratos_bancarios
      WHERE valor < 0
      GROUP BY origem
      ORDER BY origem
    `)

    const [[saldo]] = await db.query(`
      SELECT
        SUM(valor) saldo_total
      FROM extratos_bancarios
    `)

    res.json({
      ok: true,
      entradas,
      saidas,
      saldo: saldo.saldo_total || 0
    })
  } catch (error) {
    console.error('ERRO /api/dashboard/financeiro:', error)

    res.status(500).json({
      ok: false,
      erro: error.message
    })
  }
})

app.get('/api/competencias', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT DISTINCT
        DATE_FORMAT(data_movimento, '%b%y') AS competencia,
        YEAR(data_movimento) AS ano,
        MONTH(data_movimento) AS mes
      FROM lmc_movimentos
      ORDER BY ano, mes
    `)

    const competencias = rows.map(item => ({
      codigo: item.competencia,
      ano: item.ano,
      mes: item.mes
    }))

    res.json({
      ok: true,
      competencias
    })
  } catch (error) {
    console.error('ERRO /api/competencias:', error)

    res.status(500).json({
      ok: false,
      erro: error.message
    })
  }
})

app.get('/api/dashboard/resumo', async (req, res) => {
  try {
    const [produtos] = await db.query(`
      SELECT
        p.nome AS produto,
        SUM(l.quantidade_vendas) AS quantidade,
        SUM(l.valor_vendas) AS receita
      FROM lmc_movimentos l
      LEFT JOIN produtos p ON p.id = l.produto_id
      GROUP BY p.nome
    `)

    const [[vendas]] = await db.query(`
      SELECT
        SUM(quantidade_vendas) AS quantidade_total,
        SUM(valor_vendas) AS receita_total
      FROM lmc_movimentos
    `)

    const [[compras]] = await db.query(`
      SELECT
        SUM(valor_total) AS total_compras
      FROM compras
    `)

    const [[financeiro]] = await db.query(`
      SELECT
        SUM(valor) AS saldo_total
      FROM extratos_bancarios
    `)

    const resumo = {
      receitaTotal: Number(vendas.receita_total || 0),
      quantidadeTotal: Number(vendas.quantidade_total || 0),
      comprasTotal: Number(compras.total_compras || 0),
      saldoFinanceiro: Number(financeiro.saldo_total || 0),
      produtos
    }

    res.json({
      ok: true,
      resumo
    })
  } catch (error) {
    console.error('ERRO /api/dashboard/resumo:', error)

    res.status(500).json({
      ok: false,
      erro: error.message
    })
  }
})

function codigoCompetenciaParaAnoMes(codigo) {
  const meses = {
    Jan: 1, Fev: 2, Mar: 3, Abr: 4, Mai: 5, Jun: 6,
    Jul: 7, Ago: 8, Set: 9, Out: 10, Nov: 11, Dez: 12,
  }

  const texto = String(codigo || '').trim()
  const mesTexto = texto.slice(0, 3)
  const anoTexto = texto.slice(3)
  const mes = meses[mesTexto]
  const ano = 2000 + Number(anoTexto)

  if (!mes || !anoTexto || Number.isNaN(ano)) {
    throw new Error(`Competência inválida: ${codigo}`)
  }

  return { ano, mes, chave: ano * 100 + mes }
}

function obterIntervaloCompetencias(req) {
  const inicial = req.query.competenciaInicial || req.query.competencia || 'Mar26'
  const final = req.query.competenciaFinal || req.query.competencia || inicial
  const ini = codigoCompetenciaParaAnoMes(inicial)
  const fim = codigoCompetenciaParaAnoMes(final)

  if (ini.chave > fim.chave) {
    throw new Error('A competência inicial não pode ser maior que a competência final.')
  }

  const dataInicial = `${ini.ano}-${String(ini.mes).padStart(2, '0')}-01`
  const dataFinal = new Date(fim.ano, fim.mes, 0).toISOString().slice(0, 10)

  return {
    inicial,
    final,
    chaveInicial: ini.chave,
    chaveFinal: fim.chave,
    anoInicial: ini.ano,
    mesInicial: ini.mes,
    anoFinal: fim.ano,
    mesFinal: fim.mes,
    dataInicial,
    dataFinal,
  }
}

async function consultarResumoDadosGravados(req, res) {
  try {
    const { chaveInicial, chaveFinal } = obterIntervaloCompetencias(req)

    const [[compras]] = await db.query(`
      SELECT
        COUNT(*) AS registros,
        COALESCE(SUM(c.quantidade), 0) AS quantidade,
        COALESCE(SUM(c.valor_total), 0) AS valor_total
      FROM compras c
      INNER JOIN periodos p ON p.id = c.periodo_id
      WHERE (p.ano * 100 + p.mes) BETWEEN ? AND ?
    `, [chaveInicial, chaveFinal])

    const [[lmc]] = await db.query(`
      SELECT
        COUNT(*) AS registros,
        COALESCE(SUM(l.quantidade_vendas), 0) AS quantidade_vendas,
        COALESCE(SUM(l.valor_vendas), 0) AS valor_vendas
      FROM lmc_movimentos l
      INNER JOIN periodos p ON p.id = l.periodo_id
      WHERE (p.ano * 100 + p.mes) BETWEEN ? AND ?
    `, [chaveInicial, chaveFinal])

    const [[extratos]] = await db.query(`
      SELECT
        COUNT(*) AS registros,
        COALESCE(SUM(CASE WHEN e.valor > 0 THEN e.valor ELSE 0 END), 0) AS entradas,
        COALESCE(SUM(CASE WHEN e.valor < 0 THEN ABS(e.valor) ELSE 0 END), 0) AS saidas,
        COALESCE(SUM(e.valor), 0) AS saldo
      FROM extratos_bancarios e
      INNER JOIN periodos p ON p.id = e.periodo_id
      WHERE (p.ano * 100 + p.mes) BETWEEN ? AND ?
    `, [chaveInicial, chaveFinal])

    res.json({
      ok: true,
      resumo: {
        compras: {
          registros: Number(compras.registros || 0),
          quantidade: Number(compras.quantidade || 0),
          valorTotal: Number(compras.valor_total || 0),
        },
        lmc: {
          registros: Number(lmc.registros || 0),
          quantidadeVendas: Number(lmc.quantidade_vendas || 0),
          valorVendas: Number(lmc.valor_vendas || 0),
        },
        extratos: {
          registros: Number(extratos.registros || 0),
          entradas: Number(extratos.entradas || 0),
          saidas: Number(extratos.saidas || 0),
          saldo: Number(extratos.saldo || 0),
        },
      },
    })
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message })
  }
}

app.get('/api/dados-gravados', consultarResumoDadosGravados)

app.get('/api/compras', async (req, res) => {
  try {
    const { chaveInicial, chaveFinal } = obterIntervaloCompetencias(req)
    const [dados] = await db.query(`
      SELECT
        c.id,
        DATE_FORMAT(c.data_emissao, '%d/%m/%Y') AS data_emissao,
        pr.nome AS produto,
        f.nome AS fornecedor,
        c.numero_nf,
        c.custo,
        c.quantidade,
        c.valor_total
      FROM compras c
      INNER JOIN periodos p ON p.id = c.periodo_id
      LEFT JOIN produtos pr ON pr.id = c.produto_id
      LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
      WHERE (p.ano * 100 + p.mes) BETWEEN ? AND ?
      ORDER BY c.data_emissao ASC, pr.nome ASC, c.numero_nf ASC
    `, [chaveInicial, chaveFinal])

    res.json({ ok: true, dados })
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message })
  }
})

app.get('/api/lmc', async (req, res) => {
  try {
    const { chaveInicial, chaveFinal } = obterIntervaloCompetencias(req)
    const [dados] = await db.query(`
      SELECT
        l.id,
        DATE_FORMAT(l.data_movimento, '%d/%m/%Y') AS data_movimento,
        pr.nome AS produto,
        l.estoque_abertura,
        l.quantidade_vendas,
        l.valor_vendas,
        l.ajuste_quantidade,
        l.estoque_fechamento
      FROM lmc_movimentos l
      INNER JOIN periodos p ON p.id = l.periodo_id
      LEFT JOIN produtos pr ON pr.id = l.produto_id
      WHERE (p.ano * 100 + p.mes) BETWEEN ? AND ?
      ORDER BY l.data_movimento ASC, pr.nome ASC
    `, [chaveInicial, chaveFinal])

    res.json({ ok: true, dados })
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message })
  }
})

async function consultarExtratosPorOrigem(req, res, origem) {
  try {
    const { chaveInicial, chaveFinal, dataInicial } = obterIntervaloCompetencias(req)

    const [saldoAnterior] = await db.query(`
      SELECT
        CONCAT('saldo-anterior-', e.id) AS id,
        DATE_FORMAT(e.data_lancamento, '%d/%m/%Y') AS data_lancamento,
        'Saldo anterior ao período' AS descricao_original,
        0 AS valor,
        e.saldo,
        'SALDO' AS natureza,
        e.origem,
        0 AS ordem_extra
      FROM extratos_bancarios e
      WHERE UPPER(e.origem) = ?
        AND e.data_lancamento < ?
        AND e.saldo IS NOT NULL
        AND e.saldo <> 0
      ORDER BY e.data_lancamento DESC, e.id DESC
      LIMIT 1
    `, [origem, dataInicial])

    const [dadosPeriodo] = await db.query(`
      SELECT
        e.id,
        DATE_FORMAT(e.data_lancamento, '%d/%m/%Y') AS data_lancamento,
        e.descricao_original,
        e.valor,
        e.saldo,
        e.natureza,
        e.origem,
        1 AS ordem_extra
      FROM extratos_bancarios e
      INNER JOIN periodos p ON p.id = e.periodo_id
      WHERE (p.ano * 100 + p.mes) BETWEEN ? AND ?
        AND UPPER(e.origem) = ?
      ORDER BY e.data_lancamento ASC, e.id ASC
    `, [chaveInicial, chaveFinal, origem])

    const dados = [...saldoAnterior, ...dadosPeriodo].map((item) => ({
      ...item,
      saldo: Number(item.saldo || 0) === 0 ? null : item.saldo,
    }))

    res.json({ ok: true, dados })
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message })
  }
}

app.get('/api/spot', (req, res) => consultarExtratosPorOrigem(req, res, 'SPOT'))
app.get('/api/itau', (req, res) => consultarExtratosPorOrigem(req, res, 'ITAU'))

app.delete('/api/competencia/limpar', async (req, res) => {
  const conn = await db.getConnection()

  try {
    const senhaInformada = String(req.body?.senha || '')
    const senhaCorreta = process.env.SENHA_LIMPAR_COMPETENCIA || process.env.ADMIN_DELETE_PASSWORD || 'posto14'

    if (senhaInformada !== senhaCorreta) {
      return res.status(401).json({ ok: false, erro: 'Senha inválida. Exclusão cancelada.' })
    }

    const reqFake = {
      query: {
        competenciaInicial: req.body?.competenciaInicial || req.body?.competencia,
        competenciaFinal: req.body?.competenciaFinal || req.body?.competencia,
      },
    }
    const { inicial, final, chaveInicial, chaveFinal } = obterIntervaloCompetencias(reqFake)

    await conn.beginTransaction()

    const [extratos] = await conn.query(`
      DELETE e FROM extratos_bancarios e
      INNER JOIN periodos p ON p.id = e.periodo_id
      WHERE (p.ano * 100 + p.mes) BETWEEN ? AND ?
    `, [chaveInicial, chaveFinal])

    const [lmc] = await conn.query(`
      DELETE l FROM lmc_movimentos l
      INNER JOIN periodos p ON p.id = l.periodo_id
      WHERE (p.ano * 100 + p.mes) BETWEEN ? AND ?
    `, [chaveInicial, chaveFinal])

    const [compras] = await conn.query(`
      DELETE c FROM compras c
      INNER JOIN periodos p ON p.id = c.periodo_id
      WHERE (p.ano * 100 + p.mes) BETWEEN ? AND ?
    `, [chaveInicial, chaveFinal])

    await conn.commit()

    res.json({
      ok: true,
      mensagem: `Período ${inicial} até ${final} limpo com sucesso.`,
      removidos: {
        compras: compras.affectedRows || 0,
        lmc: lmc.affectedRows || 0,
        extratos: extratos.affectedRows || 0,
      },
    })
  } catch (error) {
    await conn.rollback().catch(() => {})
    res.status(400).json({ ok: false, erro: error.message })
  } finally {
    conn.release()
  }
})

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'docs', 'index.html'))
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`)
})