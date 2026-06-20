import express from 'express';

const app = express();
const PORT = process.env.PORT || 3001;

let gerarOk = false;
let gerarErro = null;

try {
  const modulo = await import('./backend/gerarAuxiliarBanco.js');
  gerarOk = !!modulo.gerarPlanilhaAuxiliarDoBanco;
} catch (error) {
  gerarErro = {
    message: error.message,
    stack: error.stack,
  };
  console.error('ERRO AO IMPORTAR gerarAuxiliarBanco:', error);
}

app.get('/', (req, res) => {
  res.send('Servidor com teste dinâmico');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    gerarOk,
    gerarErro,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});