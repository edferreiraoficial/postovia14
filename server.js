import fs from 'fs';
import express from 'express';
import mysql from 'mysql2/promise';
/*import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import ExcelJS from 'exceljs';
import pdf from 'pdf-parse';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './backend/db.js';

import { processarPlanilhas } from './backend/processar.js';
//import { importarPdfsBanco } from './backend/importarPdfsBanco.js';

/*import fs from 'fs';
//import { db } from './db.js';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { processarPlanilhas } from './processar.js';
import { importarPdfsBanco } from './importarPdfsBanco.js';
import { gerarPlanilhaAuxiliarDoBanco } from './gerarAuxiliarBanco.js';*/


const app = express();
const PORT = process.env.PORT || 3001;
c//onst upload = multer({ storage: multer.memoryStorage() });
//const __filename = fileURLToPath(import.meta.url);
//const __dirname = path.dirname(__filename);
//dotenv.config();

console.log('FS carregado:', !!fs);
console.log('ExcelJS carregado:', !!ExcelJS); 
console.log('PDF Parse carregado:', !!pdf);
console.log('PG carregado:', !!pg);
console.log('processar.js carregado:', !!processarPlanilhas);


app.get('/', (req, res) => {
  res.send('Servidor rodando');
});

app.get('/health', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT 1 AS teste');
    res.json({ status: 'ok', banco: rows[0] });
  } catch (error) {
    console.error('ERRO MYSQL:', error);
    res.status(500).json({
      status: 'erro',
      mensagem: error.message,
      code: error.code,
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor mínimo rodando na porta ${PORT}`);
});