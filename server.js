import express from 'express';
import mysql from 'mysql2/promise';

const app = express();
const PORT = process.env.PORT || 3001;

console.log('mysql2 carregado:', !!mysql);

app.get('/', (req, res) => {
  res.send('Servidor com mysql2 funcionando');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', mysql2: !!mysql });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});