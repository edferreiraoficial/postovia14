import fs from 'fs';
import { db } from './db.js';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { processarPlanilhas } from './processar.js';
import { importarPdfsBanco } from './importarPdfsBanco.js';
import { gerarPlanilhaAuxiliarDoBanco } from './gerarAuxiliarBanco.js';

const app = express();
const uploadMemoria = multer({ storage: multer.memoryStorage() });
const uploadArquivos = multer({ dest: 'backend/uploads/' });
const PORT = process.env.PORT || 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.get('/', (req, res) => {
  res.send('Backend Posto Via 14 funcionando');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use(cors());
app.use(express.json());

function competenciaParaAnoMes(competencia = 'Mar26') {
  const mapa = {
    Jan: 1,
    Fev: 2,
    Mar: 3,
    Abr: 4,
    Mai: 5,
    Jun: 6,
    Jul: 7,
    Ago: 8,
    Set: 9,
    Out: 10,
    Nov: 11,
    Dez: 12,
  };

  const texto = String(competencia).trim();
  const mesTexto = texto.slice(0, 3);
  const anoTexto = texto.slice(3);

  const mes = mapa[mesTexto];
  const ano = 2000 + Number(anoTexto);

  if (!mes || !ano) {
    throw new Error(`Competência inválida: ${competencia}`);
  }

  return { ano, mes };
}

app.get('/api/status', (_req, res) => {
  res.json({ ok: true, app: 'Posto Via 14 Admin API' });
});

app.post('/api/periodos/criar-teste', async (_req, res) => {
  try {
    const empresa = await db.query(
      'SELECT id FROM empresas WHERE nome = $1 LIMIT 1',
      ['Posto Via 14']
    );

    if (empresa.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        erro: 'Empresa Posto Via 14 não encontrada no banco.',
      });
    }

    const empresaId = empresa.rows[0].id;

    const periodo = await db.query(
      `INSERT INTO periodos (empresa_id, ano, mes)
       VALUES ($1, $2, $3)
       ON CONFLICT (empresa_id, ano, mes)
       DO UPDATE SET atualizado_em = NOW()
       RETURNING *`,
      [empresaId, 2026, 1]
    );

    res.json({
      ok: true,
      mensagem: 'Período criado/conferido com sucesso.',
      periodo: periodo.rows[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      erro: error.message,
    });
  }
});

app.post(
  '/api/processar-financeiro',
  uploadMemoria.fields([
    { name: 'principal', maxCount: 1 },
    { name: 'secundaria', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const principal = req.files?.principal?.[0];
      const secundaria = req.files?.secundaria?.[0];

      if (!principal || !secundaria) {
        return res.status(400).json({ erro: 'Envie a planilha principal e a planilha secundária.' });
      }

      const abaMes = req.body?.abaMes;
      if (!abaMes) {
        return res.status(400).json({
        erro: 'Mês não informado.'
        });
      }

      const buffer = await processarPlanilhas(principal.buffer, secundaria.buffer, abaMes);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="Financeiro_Posto_Preenchido.xlsx"');
      res.send(buffer);
    } catch (err) {
      console.error(err);
      res.status(500).json({ erro: err.message || 'Erro ao processar planilhas.' });
    }
  }
);

app.post(
  '/api/gerar-estoque-banco',
  uploadArquivos.fields([
    { name: 'lmc', maxCount: 1 },
    { name: 'compras', maxCount: 1 },
    { name: 'spot', maxCount: 1 },
    { name: 'itau', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const nomeArquivo = req.body.nomeArquivo || 'Planilha_Estoque_Banco.xlsx';
      const arquivoLmc = req.files?.lmc?.[0];
      const arquivoCompras = req.files?.compras?.[0];
      const arquivoSpot = req.files?.spot?.[0];
      const arquivoItau = req.files?.itau?.[0];

      if (!arquivoLmc && !arquivoCompras && !arquivoSpot && !arquivoItau) {
        return res.status(400).json({
          message: 'Envie pelo menos um arquivo PDF: LMC, Compras, SPOT ou Itaú.',
        });
      }
      const resultado = await importarPdfsBanco({
        arquivoLmc,
        arquivoCompras,
        arquivoSpot,
        arquivoItau,
      });

      res.json({
        ok: true,
        mensagem: 'PDFs importados com sucesso.',
        resultado,
      });

    } catch (error) {
      console.error(error);
      res.status(500).json({ message: error.message || 'Erro ao gerar planilha Estoque + Banco.' });
    }
  }
);

app.get('/api/compras', async (req, res) => {
  try {
    const competencia = req.query?.competencia || 'Mar26';
    const { ano, mes } = competenciaParaAnoMes(competencia);
    const resultado = await db.query(`
      SELECT
        c.id,
        c.data_emissao,
        p.nome AS produto,
        f.nome AS fornecedor,
        c.numero_nf,
        c.custo,
        c.quantidade,
        c.valor_total
      FROM compras c
      LEFT JOIN produtos p ON p.id = c.produto_id
      LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
      WHERE EXTRACT(YEAR FROM c.data_emissao) = $1
        AND EXTRACT(MONTH FROM c.data_emissao) = $2
      ORDER BY c.data_emissao, c.id
    `, [ano, mes]);

    res.json({
      ok: true,
      total: resultado.rows.length,
      dados: resultado.rows,
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({
      ok: false,
      erro: error.message,
    })
  }
})

app.get('/api/lmc', async (req, res) => {
  try {
    const competencia = req.query?.competencia || 'Mar26';
    const { ano, mes } = competenciaParaAnoMes(competencia);
    const resultado = await db.query(`
      SELECT
        l.id,
        l.data_movimento,
        p.nome AS produto,
        l.estoque_abertura,
        l.quantidade_vendas,
        l.valor_vendas,
        l.ajuste_quantidade,
        l.estoque_fechamento
      FROM lmc_movimentos l
      LEFT JOIN produtos p ON p.id = l.produto_id
      WHERE EXTRACT(YEAR FROM l.data_movimento) = $1
        AND EXTRACT(MONTH FROM l.data_movimento) = $2
      ORDER BY l.data_movimento, p.nome
    `, [ano, mes]);

    res.json({
      ok: true,
      total: resultado.rows.length,
      dados: resultado.rows,
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({
      ok: false,
      erro: error.message,
    })
  }
})

app.get('/api/spot', async (req, res) => {
  try {
    const competencia = req.query?.competencia || 'Mar26';
    const { ano, mes } = competenciaParaAnoMes(competencia);
    const resultado = await db.query(`
      SELECT
        id,
        data_lancamento,
        descricao_original,
        valor,
        saldo,
        natureza,
        origem
      FROM extratos_bancarios
      WHERE origem = 'SPOT'
        AND EXTRACT(YEAR FROM data_lancamento) = $1
        AND EXTRACT(MONTH FROM data_lancamento) = $2
      ORDER BY data_lancamento, id
    `, [ano, mes]);

    res.json({
      ok: true,
      total: resultado.rows.length,
      dados: resultado.rows,
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ ok: false, erro: error.message })
  }
})

app.get('/api/itau', async (req, res) => {
  try {
    const competencia = req.query?.competencia || 'Mar26';
    const { ano, mes } = competenciaParaAnoMes(competencia);
    const resultado = await db.query(`
      SELECT
        id,
        data_lancamento,
        descricao_original,
        valor,
        saldo,
        natureza,
        origem
      FROM extratos_bancarios
      WHERE origem = 'ITAU'
        AND EXTRACT(YEAR FROM data_lancamento) = $1
        AND EXTRACT(MONTH FROM data_lancamento) = $2
      ORDER BY data_lancamento, id
    `)

    res.json({
      ok: true,
      total: resultado.rows.length,
      dados: resultado.rows,
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ ok: false, erro: error.message })
  }
})

app.get('/api/auditoria/resumo', async (req, res) => {
  try {
    const competencia = req.query?.competencia || 'Mar26';
    const { ano, mes } = competenciaParaAnoMes(competencia);
    const compras = await db.query(`
      SELECT COALESCE(SUM(valor_total),0) total
      FROM compras
      WHERE EXTRACT(YEAR FROM data_emissao) = $1
        AND EXTRACT(MONTH FROM data_emissao) = $2
    `, [ano, mes]);

    const vendas = await db.query(`
       SELECT COALESCE(SUM(valor_vendas),0) total
       FROM lmc_movimentos
       WHERE EXTRACT(YEAR FROM data_movimento) = $1
         AND EXTRACT(MONTH FROM data_movimento) = $2
     `, [ano, mes]);

    const entradasBanco = await db.query(`
      SELECT COALESCE(SUM(valor),0) total
      FROM extratos_bancarios
      WHERE natureza = 'ENTRADA'
        AND EXTRACT(YEAR FROM data_lancamento) = $1
        AND EXTRACT(MONTH FROM data_lancamento) = $2
    `, [ano, mes]);

    const saidasBanco = await db.query(`
      SELECT COALESCE(SUM(ABS(valor)),0) total
      FROM extratos_bancarios
      WHERE natureza = 'SAIDA'
        AND EXTRACT(YEAR FROM data_lancamento) = $1
        AND EXTRACT(MONTH FROM data_lancamento) = $2
    `, [ano, mes]);

    res.json({
      ok: true,
      compras: Number(compras.rows[0].total),
      vendas: Number(vendas.rows[0].total),
      entradasBanco: Number(entradasBanco.rows[0].total),
      saidasBanco: Number(saidasBanco.rows[0].total),
      diferenca:
        Number(vendas.rows[0].total) -
        Number(entradasBanco.rows[0].total),
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({
      ok: false,
      erro: error.message,
    })
  }
})

app.get('/api/auditoria/compras-lmc', async (req, res) => {
  try {
    const competencia = req.query?.competencia || 'Mar26';
    const { ano, mes } = competenciaParaAnoMes(competencia);    
    const resultado = await db.query(`
      SELECT
        p.nome produto,
        COALESCE((
          SELECT SUM(c.quantidade)
          FROM compras c
          WHERE c.produto_id = p.id
            AND EXTRACT(YEAR FROM c.data_emissao) = $1
            AND EXTRACT(MONTH FROM c.data_emissao) = $2
        ),0) comprado,
        COALESCE((
          SELECT SUM(l.volume_recebido)
          FROM lmc_movimentos l
          WHERE l.produto_id = p.id
            AND EXTRACT(YEAR FROM l.data_movimento) = $1
            AND EXTRACT(MONTH FROM l.data_movimento) = $2
        ),0) recebido_lmc

      FROM produtos p
      ORDER BY p.nome
    `, [ano, mes]);

    res.json({
      ok: true,
      dados: resultado.rows.map(item => ({
        ...item,
        diferenca:
          Number(item.comprado) -
          Number(item.recebido_lmc),
      })),
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({
      ok: false,
      erro: error.message,
    })
  }
})

app.get('/api/auditoria/vendas-bancos', async (req, res) => {
  try {
    const competencia = req.query?.competencia || 'Mar26';
    const { ano, mes } = competenciaParaAnoMes(competencia);    
    const resultado = await db.query(`
      SELECT
        l.data_movimento,
        COALESCE(SUM(l.valor_vendas), 0) AS vendas_lmc,
        COALESCE((
          SELECT SUM(e.valor)
          FROM extratos_bancarios e
          WHERE e.data_lancamento = l.data_movimento
            AND e.natureza = 'ENTRADA'
        ), 0) AS entradas_banco
      FROM lmc_movimentos l
      WHERE EXTRACT(YEAR FROM l.data_movimento) = $1
        AND EXTRACT(MONTH FROM l.data_movimento) = $2
      GROUP BY l.data_movimento
      ORDER BY l.data_movimento
    `, [ano, mes]);

    res.json({
      ok: true,
      dados: resultado.rows.map(item => ({
        ...item,
        diferenca:
          Number(item.vendas_lmc) -
          Number(item.entradas_banco),
      })),
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({
      ok: false,
      erro: error.message,
    })
  }
})

app.get('/api/gerar-auxiliar-banco', async (req, res) => {
  try {
    const abaMes = req.query?.abaMes || 'Mar26';
    const { ano, mes } = competenciaParaAnoMes(abaMes);

    const caminhoArquivo = await gerarPlanilhaAuxiliarDoBanco({
      nomeArquivo: 'Planilha_Estoque_Banco_BD.xlsx',
      ano,
      mes,
    });

    res.download(
      caminhoArquivo,
      'Planilha_Estoque_Banco_BD.xlsx',
      (err) => {
        if (err) console.error(err);

        try {
          fs.unlinkSync(caminhoArquivo);
        } catch (_) {}
      }
    );
  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      erro: error.message,
    });
  }
});

app.post(
  '/api/processar-financeiro-banco',
  uploadMemoria.fields([
    { name: 'principal', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const principal = req.files?.principal?.[0];

      if (!principal) {
        return res.status(400).json({ erro: 'Envie a planilha principal.' });
      }

      const abaMes = req.body?.abaMes || 'Mar26';
      const { ano, mes } = competenciaParaAnoMes(abaMes);

      const caminhoAuxiliar = await gerarPlanilhaAuxiliarDoBanco({
        nomeArquivo: 'Planilha_Estoque_Banco_BD.xlsx',
        ano,
        mes,
      });

      const secundariaBuffer = fs.readFileSync(caminhoAuxiliar);

      const buffer = await processarPlanilhas(
        principal.buffer,
        secundariaBuffer,
        abaMes
      );

      try {
        fs.unlinkSync(caminhoAuxiliar);
      } catch (_) {}

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="Financeiro_Posto_Preenchido_Banco.xlsx"'
      );

      res.send(buffer);
    } catch (err) {
      console.error(err);
      res.status(500).json({
        erro: err.message || 'Erro ao processar financeiro pelo banco.',
      });
    }
  }
);

app.get('/api/dashboard/resumo', async (req, res) => {
  try {
    const competencia = req.query?.competencia || 'Mar26';
    const { ano, mes } = competenciaParaAnoMes(competencia);

    const resumo = await db.query(`
      SELECT
        (SELECT COALESCE(SUM(valor_total), 0)
         FROM compras
         WHERE EXTRACT(YEAR FROM data_emissao) = $1
           AND EXTRACT(MONTH FROM data_emissao) = $2) AS compras,

        (SELECT COALESCE(SUM(valor_vendas), 0)
         FROM lmc_movimentos
         WHERE EXTRACT(YEAR FROM data_movimento) = $1
           AND EXTRACT(MONTH FROM data_movimento) = $2) AS vendas,

        (SELECT COALESCE(SUM(valor), 0)
         FROM extratos_bancarios
         WHERE natureza = 'ENTRADA'
           AND EXTRACT(YEAR FROM data_lancamento) = $1
           AND EXTRACT(MONTH FROM data_lancamento) = $2) AS entradas,

        (SELECT COALESCE(SUM(ABS(valor)), 0)
         FROM extratos_bancarios
         WHERE natureza = 'SAIDA'
           AND EXTRACT(YEAR FROM data_lancamento) = $1
           AND EXTRACT(MONTH FROM data_lancamento) = $2) AS saidas
    `, [ano, mes]);

    const dados = resumo.rows[0];

    res.json({
      ok: true,
      compras: Number(dados.compras),
      vendas: Number(dados.vendas),
      entradas: Number(dados.entradas),
      saidas: Number(dados.saidas),
      diferenca: Number(dados.vendas) - Number(dados.entradas),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, erro: error.message });
  }
});

app.get('/api/dashboard/vendas-produtos', async (req, res) => {
  try {
    const competencia = req.query?.competencia || 'Mar26';
    const { ano, mes } = competenciaParaAnoMes(competencia);

    const resultado = await db.query(`
      SELECT
        p.nome AS produto,
        SUM(l.valor_vendas) AS receita,
        SUM(l.quantidade_vendas) AS quantidade,
        COUNT(DISTINCT l.data_movimento) AS dias
      FROM lmc_movimentos l
      LEFT JOIN produtos p ON p.id = l.produto_id
      WHERE EXTRACT(YEAR FROM l.data_movimento) = $1
        AND EXTRACT(MONTH FROM l.data_movimento) = $2
      GROUP BY p.nome
      ORDER BY p.nome
    `, [ano, mes]);

    const mensal = await db.query(`
      SELECT
        TO_CHAR(l.data_movimento, 'DD/MM') AS dia,
        p.nome AS produto,
        SUM(l.valor_vendas) AS receita
      FROM lmc_movimentos l
      LEFT JOIN produtos p ON p.id = l.produto_id
      WHERE EXTRACT(YEAR FROM l.data_movimento) = $1
        AND EXTRACT(MONTH FROM l.data_movimento) = $2
      GROUP BY l.data_movimento, p.nome
      ORDER BY l.data_movimento, p.nome
    `, [ano, mes]);

    res.json({
      ok: true,
      produtos: resultado.rows,
      diario: mensal.rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, erro: error.message });
  }
});

app.get('/api/dashboard/completo', async (req, res) => {
  try {
    const competenciaInicio = req.query?.inicio || 'Set25';
    const competenciaFim = req.query?.fim || competenciaInicio;

    const inicio = competenciaParaAnoMes(competenciaInicio);
    const fim = competenciaParaAnoMes(competenciaFim);

    const dataInicio = `${inicio.ano}-${String(inicio.mes).padStart(2, '0')}-01`;

    const dataFimObj = new Date(fim.ano, fim.mes, 0);
    const dataFim = `${fim.ano}-${String(fim.mes).padStart(2, '0')}-${String(dataFimObj.getDate()).padStart(2, '0')}`;
   
    const produtos = await db.query(`
      SELECT
        p.nome AS produto,
        COALESCE(SUM(l.valor_vendas), 0) AS revenue,
        COALESCE(SUM(l.quantidade_vendas), 0) AS qty,
        COUNT(DISTINCT l.data_movimento) AS days
      FROM produtos p
      LEFT JOIN lmc_movimentos l
        ON l.produto_id = p.id
        AND l.data_movimento BETWEEN $1 AND $2
      GROUP BY p.nome
      ORDER BY p.nome
    `, [dataInicio, dataFim]);

    const diario = await db.query(`
      SELECT
        CASE EXTRACT(MONTH FROM DATE_TRUNC('month', l.data_movimento))
          WHEN 1 THEN 'Jan'
          WHEN 2 THEN 'Fev'
          WHEN 3 THEN 'Mar'
          WHEN 4 THEN 'Abr'
          WHEN 5 THEN 'Mai'
          WHEN 6 THEN 'Jun'
          WHEN 7 THEN 'Jul'
          WHEN 8 THEN 'Ago'
          WHEN 9 THEN 'Set'
          WHEN 10 THEN 'Out'
          WHEN 11 THEN 'Nov'
          WHEN 12 THEN 'Dez'
        END || '/' || TO_CHAR(DATE_TRUNC('month', l.data_movimento), 'YY') AS label,
        DATE_TRUNC('month', l.data_movimento) AS ordem,
        p.nome AS produto,
        COALESCE(SUM(l.valor_vendas), 0) AS revenue
      FROM lmc_movimentos l
      LEFT JOIN produtos p ON p.id = l.produto_id
      WHERE l.data_movimento BETWEEN $1 AND $2
      GROUP BY DATE_TRUNC('month', l.data_movimento), p.nome
      ORDER BY ordem, p.nome
    `, [dataInicio, dataFim]);

    const stats = {
      Gasolina: { revenue: 0, qty: 0, ticket: 0, margin: null, nps: null, days: 0 },
      Etanol: { revenue: 0, qty: 0, ticket: 0, margin: null, nps: null, days: 0 },
      Díesel: { revenue: 0, qty: 0, ticket: 0, margin: null, nps: null, days: 0 },
    };

    for (const item of produtos.rows) {
      const nome = String(item.produto || '').toUpperCase();

      const chave =
        nome.includes('GASOLINA') ? 'Gasolina' :
        nome.includes('ETANOL') ? 'Etanol' :
        nome.includes('DIESEL') ? 'Díesel' :
        null;

      if (!chave) continue;

      const revenue = Number(item.revenue || 0);
      const qty = Number(item.qty || 0);

      stats[chave] = {
        revenue,
        qty,
        ticket: qty ? revenue / qty : 0,
        margin: null,
        nps: null,
        days: Number(item.days || 0),
      };
    }

    const monthlyMap = new Map();

    for (const item of diario.rows) {
      const label = item.label;

      if (!monthlyMap.has(label)) {
        monthlyMap.set(label, {
          label,
          Gasolina: 0,
          Etanol: 0,
          Díesel: 0,
        });
      }

      const linha = monthlyMap.get(label);
      const nome = String(item.produto || '').toUpperCase();
      const revenue = Number(item.revenue || 0);

      if (nome.includes('GASOLINA')) linha.Gasolina += revenue;
      if (nome.includes('ETANOL')) linha.Etanol += revenue;
      if (nome.includes('DIESEL')) linha.Díesel += revenue;
    }

    const monthly = Array.from(monthlyMap.values());
    const baseRevenue = monthly.length
      ? monthly[monthly.length - 1].Gasolina +
        monthly[monthly.length - 1].Etanol +
        monthly[monthly.length - 1].Díesel
      : 0;

    res.json({
      ok: true,
      stats,
      monthly,
      baseRevenue,
      rows: diario.rows.length,
      source: 'PostgreSQL',
      updatedAt: new Date().toLocaleString('pt-BR'),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      erro: error.message,
    });
  }
});

app.delete('/api/competencia/limpar', async (req, res) => {
  const client = await db.connect();

  try {
    const competencia = req.body?.competencia;

    if (!competencia) {
      return res.status(400).json({
        ok: false,
        erro: 'Competência não informada.',
      });
    }

    const { ano, mes } = competenciaParaAnoMes(competencia);

    const dataInicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const dataFim = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;

    await client.query('BEGIN');

    const compras = await client.query(
      `
      DELETE FROM compras
      WHERE data_emissao BETWEEN $1 AND $2
      RETURNING id
      `,
      [dataInicio, dataFim]
    );

    const lmc = await client.query(
      `
      DELETE FROM lmc_movimentos
      WHERE data_movimento BETWEEN $1 AND $2
      RETURNING id
      `,
      [dataInicio, dataFim]
    );

    const extratos = await client.query(
      `
      DELETE FROM extratos_bancarios
      WHERE data_lancamento BETWEEN $1 AND $2
      RETURNING id
      `,
      [dataInicio, dataFim]
    );

    await client.query(
      `
      DELETE FROM auditoria_resultados
      WHERE data_movimento BETWEEN $1 AND $2
      `,
      [dataInicio, dataFim]
    );

    await client.query(
      `
      DELETE FROM divergencias_auditoria
      WHERE data_movimento BETWEEN $1 AND $2
      `,
      [dataInicio, dataFim]
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      mensagem: `Competência ${competencia} limpa com sucesso.`,
      removidos: {
        compras: compras.rowCount,
        lmc: lmc.rowCount,
        extratos: extratos.rowCount,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');

    console.error(error);

    res.status(500).json({
      ok: false,
      erro: error.message,
    });
  } finally {
    client.release();
  }
}); 

///////////////////teste
app.get('/api/teste-rota', (req, res) => {
  res.json({ ok: true, msg: 'rota funcionando' })
})

app.get('/api/teste-banco', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT 1 AS teste')
    res.json({ ok: true, banco: rows })
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message })
  }
})

app.get('/api/teste-excel', async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook()
    const ws = workbook.addWorksheet('TESTE')
    ws.addRow(['OK'])

    const caminho = path.resolve('output/teste.xlsx')

    if (!fs.existsSync('output')) {
      fs.mkdirSync('output', { recursive: true })
    }

    await workbook.xlsx.writeFile(caminho)

    res.json({ ok: true, arquivo: caminho })
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message })
  }
})
///////////////////////////////////
app.listen(PORT, () => {
  console.log(`Backend rodando em http://localhost:${PORT}`);
});
