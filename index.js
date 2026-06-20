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

const app = express()
const PORT = process.env.PORT || 3001

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
})

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`)
})