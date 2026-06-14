import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';

const app = express();
const PORT = process.env.PORT || 3001;
const upload = multer({ storage: multer.memoryStorage() });
dotenv.config();

app.get('/', (req, res) => {
  res.send('Servidor mínimo funcionando com multer');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor mínimo rodando na porta ${PORT}`);
});