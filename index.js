import express from 'express'
import mysql from 'mysql2/promise'

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`)
})