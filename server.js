import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import ExcelJS from 'exceljs';
import pdf from 'pdf-parse';
import pg from 'pg';

const app = express();
const PORT = process.env.PORT || 3001;
const upload = multer({ storage: multer.memoryStorage() });
dotenv.config();

console.log('ExcelJS carregado:', !!ExcelJS); 
console.log('PDF Parse carregado:', !!pdf);
console.log('PG carregado:', !!pg);

app.get('/', (req, res) => {
  res.send('Servidor mínimo funcionando com pdf parse');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor mínimo rodando na porta ${PORT}`);
});