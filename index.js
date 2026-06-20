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

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
})

function log(...args) {
  console.log(
    `[${new Date().toISOString()}]`,
    ...args
  )
}

app.get('/', (req, res) => {
  res.send('Backend Posto Via 14 online')
})

app.get('/health', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT 1 AS teste')

    res.json({
      status: 'ok',
      mysql: true,
      timestamp: new Date(),
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

app.get('/api/status', async (req, res) => {
  try {
    const [[compras]] = await db.query(
      'SELECT COUNT(*) total FROM compras'
    )

    const [[lmc]] = await db.query(
      'SELECT COUNT(*) total FROM lmc_movimentos'
    )

    const [[extratos]] = await db.query(
      'SELECT COUNT(*) total FROM extratos_bancarios'
    )

    res.json({
      ok: true,
      compras: compras.total,
      lmc: lmc.total,
      extratos: extratos.total
    })
  } catch (error) {
    res.status(500).json({
      ok: false,
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
    const resultado = await importarPdfsBanco(req.files)

    res.json({
      ok: true,
      resultado,
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`)
})

process.on('uncaughtException', (err) => {
  console.error('ERRO NÃO TRATADO:', err)
})

process.on('unhandledRejection', (err) => {
  console.error('PROMISE NÃO TRATADA:', err)
})