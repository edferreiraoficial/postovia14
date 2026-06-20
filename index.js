import express from 'express'

const app = express()
const PORT = process.env.PORT || 3001

app.get('/', (req, res) => {
  res.send('Backend Posto Via 14 online')
})

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    mensagem: 'Servidor mínimo funcionando'
  })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor mínimo rodando na porta ${PORT}`)
})
