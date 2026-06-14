import express from 'express';
import { importarPdfsBanco } from './backend/importarPdfsBanco.js';

const app = express();
const PORT = process.env.PORT || 3001;

console.log('importarPdfsBanco carregado:', !!importarPdfsBanco);

app.get('/', (req, res) => {
  res.send('Importar PDFs carregado');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});