import express from 'express';
import { obterEmpresaPadrao } from './backend/services/BancoService.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.get('/', (req, res) => {
  res.send('Servidor rodando com BancoService MySQL');
});

app.get('/health', async (req, res) => {
  try {
    const empresa = await obterEmpresaPadrao();
    res.json({ status: 'ok', empresa });
  } catch (error) {
    res.status(500).json({
      status: 'erro',
      message: error.message,
      code: error.code,
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});