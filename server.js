import express from 'express';

const app = express();
const PORT = process.env.PORT || 3001;

app.get('/', (req, res) => {
  res.send('Servidor mínimo funcionando');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor mínimo rodando na porta ${PORT}`);
});