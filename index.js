import express from 'express'
import mysql from 'mysql2/promise'
import ExcelJS from 'exceljs'
import pdf from 'pdf-parse'
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { db } from './backend/db.js';
import { gerarPlanilhaAuxiliarDoBanco } from './backend/gerarAuxiliarBanco.js'
import { importarPdfsBanco } from './backend/importarPdfsBanco.js'
import { importarExcelBanco } from './backend/importarExcelBanco.js'
import { processarPlanilhas } from './backend/processar.js'
import { gerarExcelExtratoBancario } from './backend/pdfExtratoExcel.js'
import { migrarContasFinanceiras, garantirMapeamentosContasFinanceiras } from './backend/migrarContasFinanceiras.js'
import { consolidarFinanceiroGeral, recalcularFinanceiroGeralAPartirDe } from './backend/consolidarFinanceiroGeral.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001
const upload = multer({ storage: multer.memoryStorage() })
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))


const JWT_SECRET = String(process.env.JWT_SECRET || process.env.SENHA_ADMIN || 'troque-esta-chave-jwt-em-producao')
const JWT_EXPIRES_IN = String(process.env.JWT_EXPIRES_IN || '8h')

function criarToken(usuario) {
  return jwt.sign(
    {
      sub: usuario.id,
      usuario: usuario.usuario,
      perfil: usuario.perfil,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  )
}

function extrairToken(req) {
  const authorization = String(req.headers.authorization || '')
  if (!authorization.toLowerCase().startsWith('bearer ')) return null
  return authorization.slice(7).trim() || null
}

async function autenticarRequisicao(req, res, next) {
  try {
    const token = extrairToken(req)
    if (!token) return res.status(401).json({ ok: false, erro: 'Sessão não autenticada.' })

    const payload = jwt.verify(token, JWT_SECRET)
    const [usuarios] = await db.query(
      `SELECT id, nome, usuario, email, perfil, ativo
       FROM usuarios
       WHERE id = ?
       LIMIT 1`,
      [Number(payload.sub)]
    )

    const usuario = usuarios[0]
    if (!usuario || !Number(usuario.ativo)) {
      return res.status(401).json({ ok: false, erro: 'Usuário inexistente ou desativado.' })
    }

    req.usuario = usuario
    next()
  } catch (error) {
    const mensagem = error?.name === 'TokenExpiredError'
      ? 'Sua sessão expirou. Entre novamente.'
      : 'Sessão inválida.'
    return res.status(401).json({ ok: false, erro: mensagem })
  }
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const identificador = String(req.body?.usuario || req.body?.username || '').trim()
    const senha = String(req.body?.senha || req.body?.password || '')

    if (!identificador || !senha) {
      return res.status(400).json({ ok: false, erro: 'Informe usuário e senha.' })
    }

    const [usuarios] = await db.query(
      `SELECT id, nome, usuario, email, senha, perfil, ativo
       FROM usuarios
       WHERE usuario = ? OR email = ?
       LIMIT 1`,
      [identificador, identificador]
    )

    const usuario = usuarios[0]
    if (!usuario || !Number(usuario.ativo)) {
      return res.status(401).json({ ok: false, erro: 'Usuário ou senha inválidos.' })
    }

    const senhaValida = await bcrypt.compare(senha, String(usuario.senha || ''))
    if (!senhaValida) {
      return res.status(401).json({ ok: false, erro: 'Usuário ou senha inválidos.' })
    }

    const [permissoes] = await db.query(
      `SELECT dashboard, dados_gravados, importar_pdf, importar_excel,
              pdf_excel, lancamentos, auditoria, cadastros, configuracoes,
              incluir, editar, excluir, imprimir, numero_lancamento
       FROM permissoes
       WHERE usuario_id = ?
       LIMIT 1`,
      [usuario.id]
    )

    await db.query(
      `UPDATE usuarios
       SET ultimo_login = NOW(), ultimo_ip = ?
       WHERE id = ?`,
      [String(req.ip || req.socket?.remoteAddress || '').slice(0, 45), usuario.id]
    )

    const usuarioPublico = {
      id: usuario.id,
      nome: usuario.nome,
      usuario: usuario.usuario,
      email: usuario.email,
      perfil: usuario.perfil,
      permissoes: permissoes[0] || null,
    }

    res.json({ ok: true, token: criarToken(usuario), usuario: usuarioPublico })
  } catch (error) {
    console.error('ERRO /api/auth/login:', error)
    res.status(500).json({ ok: false, erro: error.message || 'Erro ao autenticar usuário.' })
  }
})

app.get('/api/auth/me', autenticarRequisicao, async (req, res) => {
  try {
    const [permissoes] = await db.query(
      `SELECT dashboard, dados_gravados, importar_pdf, importar_excel,
              pdf_excel, lancamentos, auditoria, cadastros, configuracoes,
              incluir, editar, excluir, imprimir, numero_lancamento
       FROM permissoes
       WHERE usuario_id = ?
       LIMIT 1`,
      [req.usuario.id]
    )

    res.json({
      ok: true,
      usuario: { ...req.usuario, permissoes: permissoes[0] || null },
    })
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message || 'Erro ao validar sessão.' })
  }
})

// Protege todas as demais rotas administrativas da API.
app.use('/api', autenticarRequisicao)

const CAMPOS_PERMISSAO = [
  'dashboard', 'dados_gravados', 'importar_pdf', 'importar_excel',
  'pdf_excel', 'lancamentos', 'auditoria', 'cadastros', 'configuracoes',
  'incluir', 'editar', 'excluir', 'imprimir', 'numero_lancamento',
]

async function podeGerenciarUsuarios(req, res, next) {
  try {
    if (String(req.usuario?.perfil || '').toUpperCase() === 'ADMIN') return next()

    const [rows] = await db.query(
      `SELECT configuracoes
       FROM permissoes
       WHERE usuario_id = ?
       LIMIT 1`,
      [req.usuario.id]
    )

    if (Number(rows[0]?.configuracoes) === 1) return next()
    return res.status(403).json({ ok: false, erro: 'Você não possui permissão para gerenciar usuários.' })
  } catch (error) {
    return res.status(500).json({ ok: false, erro: error.message || 'Erro ao validar permissão.' })
  }
}

function normalizarPermissoes(valor = {}) {
  return Object.fromEntries(
    CAMPOS_PERMISSAO.map((campo) => [campo, Number(Boolean(valor?.[campo]))])
  )
}

async function salvarPermissoes(connection, usuarioId, permissoes) {
  const dados = normalizarPermissoes(permissoes)
  const [existentes] = await connection.query(
    'SELECT id FROM permissoes WHERE usuario_id = ? LIMIT 1',
    [usuarioId]
  )

  if (existentes[0]) {
    await connection.query(
      `UPDATE permissoes SET
        dashboard = ?, dados_gravados = ?, importar_pdf = ?, importar_excel = ?,
        pdf_excel = ?, lancamentos = ?, auditoria = ?, cadastros = ?, configuracoes = ?,
        incluir = ?, editar = ?, excluir = ?, imprimir = ?, numero_lancamento = ?
       WHERE usuario_id = ?`,
      [...CAMPOS_PERMISSAO.map((campo) => dados[campo]), usuarioId]
    )
  } else {
    await connection.query(
      `INSERT INTO permissoes
        (usuario_id, dashboard, dados_gravados, importar_pdf, importar_excel,
         pdf_excel, lancamentos, auditoria, cadastros, configuracoes,
         incluir, editar, excluir, imprimir, numero_lancamento)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [usuarioId, ...CAMPOS_PERMISSAO.map((campo) => dados[campo])]
    )
  }
}

app.get('/api/usuarios', podeGerenciarUsuarios, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.nome, u.usuario, u.email, u.perfil, u.ativo,
              u.ultimo_login, u.criado_em, u.atualizado_em,
              p.dashboard, p.dados_gravados, p.importar_pdf, p.importar_excel,
              p.pdf_excel, p.lancamentos, p.auditoria, p.cadastros, p.configuracoes,
              p.incluir, p.editar, p.excluir, p.imprimir, p.numero_lancamento
       FROM usuarios u
       LEFT JOIN permissoes p ON p.usuario_id = u.id
       ORDER BY u.criado_em ASC, u.id ASC`
    )
    res.json({ ok: true, usuarios: rows })
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message || 'Erro ao listar usuários.' })
  }
})

app.post('/api/usuarios', podeGerenciarUsuarios, async (req, res) => {
  const connection = await db.getConnection()
  try {
    const nome = String(req.body?.nome || '').trim()
    const usuario = String(req.body?.usuario || '').trim()
    const email = String(req.body?.email || '').trim() || null
    const senha = String(req.body?.senha || '')
    const perfil = String(req.body?.perfil || 'OPERADOR').toUpperCase()
    const ativo = Number(req.body?.ativo !== false)

    if (!nome || !usuario || senha.length < 6) {
      return res.status(400).json({ ok: false, erro: 'Informe nome, usuário e uma senha com pelo menos 6 caracteres.' })
    }

    await connection.beginTransaction()
    const hash = await bcrypt.hash(senha, 10)
    const [result] = await connection.query(
      `INSERT INTO usuarios (nome, usuario, email, senha, perfil, ativo)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nome, usuario, email, hash, perfil, ativo]
    )
    await salvarPermissoes(connection, result.insertId, perfil === 'ADMIN' ? { ...(req.body?.permissoes || {}), numero_lancamento: true } : (req.body?.permissoes || {}))
    await connection.commit()
    res.status(201).json({ ok: true, id: result.insertId })
  } catch (error) {
    await connection.rollback()
    const duplicado = error?.code === 'ER_DUP_ENTRY'
    res.status(duplicado ? 409 : 500).json({
      ok: false,
      erro: duplicado ? 'Usuário ou e-mail já cadastrado.' : (error.message || 'Erro ao cadastrar usuário.'),
    })
  } finally {
    connection.release()
  }
})

app.put('/api/usuarios/:id', podeGerenciarUsuarios, async (req, res) => {
  const connection = await db.getConnection()
  try {
    const id = Number(req.params.id)
    const nome = String(req.body?.nome || '').trim()
    const usuario = String(req.body?.usuario || '').trim()
    const email = String(req.body?.email || '').trim() || null
    const perfil = String(req.body?.perfil || 'OPERADOR').toUpperCase()
    const ativo = Number(req.body?.ativo !== false)

    if (!id || !nome || !usuario) {
      return res.status(400).json({ ok: false, erro: 'Dados do usuário incompletos.' })
    }
    if (id === Number(req.usuario.id) && !ativo) {
      return res.status(400).json({ ok: false, erro: 'Você não pode desativar o próprio usuário.' })
    }

    await connection.beginTransaction()
    await connection.query(
      `UPDATE usuarios
       SET nome = ?, usuario = ?, email = ?, perfil = ?, ativo = ?
       WHERE id = ?`,
      [nome, usuario, email, perfil, ativo, id]
    )
    await salvarPermissoes(connection, id, perfil === 'ADMIN' ? { ...(req.body?.permissoes || {}), numero_lancamento: true } : (req.body?.permissoes || {}))
    await connection.commit()
    res.json({ ok: true })
  } catch (error) {
    await connection.rollback()
    const duplicado = error?.code === 'ER_DUP_ENTRY'
    res.status(duplicado ? 409 : 500).json({
      ok: false,
      erro: duplicado ? 'Usuário ou e-mail já cadastrado.' : (error.message || 'Erro ao atualizar usuário.'),
    })
  } finally {
    connection.release()
  }
})

app.put('/api/usuarios/:id/senha', podeGerenciarUsuarios, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const senha = String(req.body?.senha || '')
    if (!id || senha.length < 6) {
      return res.status(400).json({ ok: false, erro: 'A nova senha deve possuir pelo menos 6 caracteres.' })
    }
    const hash = await bcrypt.hash(senha, 10)
    await db.query('UPDATE usuarios SET senha = ? WHERE id = ?', [hash, id])
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message || 'Erro ao alterar senha.' })
  }
})


async function obterPermissoesUsuario(usuarioId) {
  const [rows] = await db.query(
    `SELECT dashboard, dados_gravados, importar_pdf, importar_excel,
            pdf_excel, lancamentos, auditoria, cadastros, configuracoes,
            incluir, editar, excluir, imprimir, numero_lancamento
     FROM permissoes
     WHERE usuario_id = ?
     LIMIT 1`,
    [usuarioId]
  )
  return rows[0] || {}
}

function possuiPermissao(usuario, permissoes, campo) {
  if (String(usuario?.perfil || '').toUpperCase() === 'ADMIN') return true
  return Number(permissoes?.[campo] || 0) === 1
}

function possuiAlgumaPermissao(usuario, permissoes, campos) {
  return campos.some((campo) => possuiPermissao(usuario, permissoes, campo))
}

// Bloqueia também a API, pois ocultar menus no frontend não é proteção suficiente.
async function autorizarApiPorPermissao(req, res, next) {
  try {
    if (String(req.usuario?.perfil || '').toUpperCase() === 'ADMIN') return next()

    const caminho = String(req.path || '').toLowerCase()
    const metodo = String(req.method || 'GET').toUpperCase()
    const permissoes = await obterPermissoesUsuario(req.usuario.id)

    let permitido = true
    let mensagem = 'Seu usuário não possui permissão para executar esta operação.'

    if (caminho.startsWith('/dashboard')) {
      permitido = possuiPermissao(req.usuario, permissoes, 'dashboard')
    } else if (caminho.startsWith('/auditoria')) {
      permitido = possuiPermissao(req.usuario, permissoes, 'auditoria')
    } else if (caminho === '/competencias') {
      permitido = possuiAlgumaPermissao(req.usuario, permissoes, ['dashboard', 'auditoria'])
    } else if (caminho.startsWith('/importar-pdfs')) {
      permitido = possuiPermissao(req.usuario, permissoes, 'importar_pdf')
    } else if (caminho.startsWith('/importar-excel-banco')) {
      permitido = possuiPermissao(req.usuario, permissoes, 'importar_excel')
    } else if (caminho.startsWith('/pdf-extrato-excel')) {
      permitido = possuiPermissao(req.usuario, permissoes, 'pdf_excel')
    } else if (
      caminho.startsWith('/processar-financeiro-banco') ||
      caminho.startsWith('/gerar-auxiliar-banco') ||
      caminho === '/processar'
    ) {
      permitido = possuiPermissao(req.usuario, permissoes, 'lancamentos')
    } else if (caminho === '/contas-bancarias') {
      permitido = possuiAlgumaPermissao(req.usuario, permissoes, ['dados_gravados', 'importar_excel'])
    } else if (
      caminho === '/dados-gravados' || caminho === '/compras' || caminho === '/lmc' ||
      caminho === '/spot' || caminho === '/itau' || caminho === '/extratos-conta' || caminho === '/vendas-cartao' ||
      caminho === '/cadastros-edicao'
    ) {
      // As consultas também são usadas na tela Importar Dados para exibir os resultados importados.
      permitido = possuiAlgumaPermissao(req.usuario, permissoes, ['dados_gravados', 'importar_pdf'])
    } else if (caminho.startsWith('/configuracoes-financeiro')) {
      permitido = metodo === 'GET'
        ? possuiAlgumaPermissao(req.usuario, permissoes, ['dados_gravados', 'configuracoes'])
        : possuiPermissao(req.usuario, permissoes, 'configuracoes')
    } else if (caminho.startsWith('/financeiro-geral')) {
      permitido = possuiPermissao(req.usuario, permissoes, 'dados_gravados')
    } else if (caminho.startsWith('/dados-gravados/')) {
      const permissaoAcao = metodo === 'POST' ? 'incluir' : metodo === 'PUT' ? 'editar' : metodo === 'DELETE' ? 'excluir' : null
      permitido = possuiPermissao(req.usuario, permissoes, 'dados_gravados') &&
        (!permissaoAcao || possuiPermissao(req.usuario, permissoes, permissaoAcao))
    } else if (caminho === '/periodo/limpar') {
      permitido = possuiPermissao(req.usuario, permissoes, 'excluir') &&
        possuiAlgumaPermissao(req.usuario, permissoes, ['dados_gravados', 'importar_pdf'])
    }

    if (!permitido) return res.status(403).json({ ok: false, erro: mensagem })
    req.permissoes = permissoes
    next()
  } catch (error) {
    console.error('ERRO ao validar permissão da API:', error)
    return res.status(500).json({ ok: false, erro: 'Erro ao validar as permissões do usuário.' })
  }
}

app.use('/api', autorizarApiPorPermissao)

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
})

app.use(express.static(path.join(__dirname, 'docs')))

app.get('/', (req, res) => {
  res.send('Backend Posto Via 14 online')
})

app.get('/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS teste')

    res.json({
      status: 'ok',
      mysql: true,
      resultado: rows[0]
    })
  } catch (error) {
    res.status(500).json({
      status: 'erro',
      mysql: false,
      erro: error.message
    })
  }
})

app.get('/teste-excel', async (req, res) => {
  const wb = new ExcelJS.Workbook()
  wb.addWorksheet('TESTE')
  res.json({ ok: true })
})

app.get('/teste-pdf', (req, res) => {
  res.json({
    ok: true,
    pdfCarregado: !!pdf
  })
})

app.get('/teste-gerador', (req, res) => {
  res.json({
    ok: true,
    tipo: typeof gerarPlanilhaAuxiliarDoBanco
  })
})

app.get('/api/teste-gerar-auxiliar', async (req, res) => {
  try {
    const arquivo = await gerarPlanilhaAuxiliarDoBanco({
      nomeArquivo: 'teste_auxiliar.xlsx',
      ano: 2026,
      mes: 3,
    })

    res.json({
      ok: true,
      arquivo
    })
  } catch (error) {
    console.error('ERRO TESTE GERAR AUXILIAR:', error)

    res.status(500).json({
      ok: false,
      erro: error.message,
      stack: error.stack
    })
  }
})

app.get('/teste-importador', (req, res) => {
  res.json({
    ok: true,
    tipo: typeof importarPdfsBanco
  })
})

app.get('/teste-processar', (req, res) => {
  res.json({
    ok: true,
    tipo: typeof processarPlanilhas
  })
}) 

/// rotas reais 
app.post('/api/gerar-auxiliar-banco', async (req, res) => {
  try {
    const arquivo = await gerarPlanilhaAuxiliarDoBanco({
      nomeArquivo: 'Planilha_Estoque_Banco_BD.xlsx',
      ano: 2026,
      mes: 3,
    })

    res.json({
      ok: true,
      arquivo,
    })
  } catch (error) {
    console.error('ERRO /api/gerar-auxiliar-banco:', error)

    res.status(500).json({
      ok: false,
      erro: error.message,
    })
  }
})


app.get('/api/contas-bancarias', async (req, res) => {
  try {
    const empresaId = Number(req.query.empresaId || 1)
    const [dados] = await db.query(
      `SELECT cb.id, cb.empresa_id, cb.nome_conta, cb.instituicao AS banco, cb.instituicao, cb.tipo, cb.agencia, cb.numero_conta, cb.observacoes, cb.ativo, cb.criado_em
       FROM contas_bancarias cb
       WHERE cb.empresa_id = ?
       ORDER BY
         (cb.criado_em IS NULL) ASC,
         cb.criado_em ASC,
         cb.id ASC`,
      [empresaId]
    )
    res.json({ ok: true, dados })
  } catch (error) {
    console.error('ERRO /api/contas-bancarias:', error)
    res.status(500).json({ ok: false, erro: error.message || 'Erro ao listar contas bancárias.' })
  }
})

app.post('/api/importar-excel-banco', upload.fields([
  { name: 'lmc', maxCount: 1 },
  { name: 'compras', maxCount: 1 },
  { name: 'vendasCartao', maxCount: 1 },
  { name: 'extrato', maxCount: 1 },
  { name: 'spot', maxCount: 1 },
  { name: 'itau', maxCount: 1 },
]), async (req, res) => {
  try {
    const files = req.files || {}

    const arquivoLmc = files.lmc?.[0] || null
    const arquivoCompras = files.compras?.[0] || null
    const arquivoVendasCartao = files.vendasCartao?.[0] || null
    const arquivoExtrato = files.extrato?.[0] || null
    const arquivoSpot = files.spot?.[0] || null
    const arquivoItau = files.itau?.[0] || null
    const contaBancariaId = Number(req.body?.contaBancariaId || 0) || null
    const dataInicial = String(req.body?.dataInicial || '').trim()
    const dataFinal = String(req.body?.dataFinal || '').trim()

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicial) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFinal) || dataInicial > dataFinal) {
      return res.status(400).json({ ok: false, erro: 'Informe um período inicial e final válido para a importação.' })
    }

    if (!arquivoLmc && !arquivoCompras && !arquivoVendasCartao && !arquivoExtrato && !arquivoSpot && !arquivoItau) {
      return res.status(400).json({
        ok: false,
        erro: 'Nenhum arquivo Excel foi recebido.',
      })
    }

    if (arquivoExtrato && !contaBancariaId) {
      return res.status(400).json({
        ok: false,
        erro: 'Selecione a conta bancária que receberá o extrato.',
      })
    }

    const resultado = await importarExcelBanco({
      arquivoLmc,
      arquivoCompras,
      arquivoVendasCartao,
      arquivoExtrato,
      contaBancariaId,
      arquivoSpot,
      arquivoItau,
      dataInicial,
      dataFinal,
    })

    res.json({
      ok: true,
      mensagem: 'Arquivos Excel importados para o banco de dados com sucesso.',
      resultado,
      recebidos: {
        lmc: arquivoLmc ? 1 : 0,
        compras: arquivoCompras ? 1 : 0,
        vendasCartao: arquivoVendasCartao ? 1 : 0,
        extrato: (arquivoExtrato || arquivoSpot || arquivoItau) ? 1 : 0,
      },
    })
  } catch (error) {
    console.error('ERRO /api/importar-excel-banco:', error)
    res.status(500).json({ ok: false, erro: error.message || 'Erro ao importar Excel para o banco.' })
  }
})

app.post('/api/importar-pdfs', upload.fields([
  { name: 'lmc', maxCount: 10 },
  { name: 'compras', maxCount: 10 },
  { name: 'spot', maxCount: 10 },
  { name: 'itau', maxCount: 10 },
]), async (req, res) => {
  try {
    const files = req.files || {}

    const arquivoLmc = files.lmc?.[0] || null
    const arquivoCompras = files.compras?.[0] || null
    const arquivoSpot = files.spot?.[0] || null
    const arquivoItau = files.itau?.[0] || null
    const dataInicial = String(req.body?.dataInicial || '').trim()
    const dataFinal = String(req.body?.dataFinal || '').trim()

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicial) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFinal) || dataInicial > dataFinal) {
      return res.status(400).json({ ok: false, erro: 'Informe um período inicial e final válido para a importação.' })
    }

    if (!arquivoLmc && !arquivoCompras && !arquivoSpot && !arquivoItau) {
      return res.status(400).json({
        ok: false,
        erro: 'Nenhum arquivo PDF foi recebido.',
      })
    }

    const resultado = await importarPdfsBanco({
      arquivoLmc,
      arquivoCompras,
      arquivoSpot,
      arquivoItau,
      dataInicial,
      dataFinal,
    })

    res.json({
      ok: true,
      mensagem: 'PDFs importados para o banco de dados com sucesso.',
      resultado,
      recebidos: {
        lmc: arquivoLmc ? 1 : 0,
        compras: arquivoCompras ? 1 : 0,
        spot: arquivoSpot ? 1 : 0,
        itau: arquivoItau ? 1 : 0,
      },
    })
  } catch (error) {
    console.error('ERRO /api/importar-pdfs:', error)

    res.status(500).json({
      ok: false,
      erro: error.message,
    })
  }
})


app.post('/api/pdf-extrato-excel', upload.single('pdf'), async (req, res) => {
  try {
    const arquivoPdf = req.file

    if (!arquivoPdf) {
      return res.status(400).json({ ok: false, erro: 'Nenhum arquivo PDF foi recebido.' })
    }

    const banco = req.body?.banco || 'itau'
    const bufferExcel = await gerarExcelExtratoBancario(arquivoPdf, { banco })
    const nomeBase = String(arquivoPdf.originalname || 'extrato')
      .replace(/\.pdf$/i, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 80) || 'extrato'

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${nomeBase}_consolidado.xlsx"`)
    res.send(Buffer.from(bufferExcel))
  } catch (error) {
    console.error('ERRO /api/pdf-extrato-excel:', error)
    res.status(500).json({ ok: false, erro: error.message || 'Erro ao converter PDF em Excel.' })
  }
})

app.post('/api/processar', upload.fields([
  { name: 'principal', maxCount: 1 },
  { name: 'secundaria', maxCount: 1 },
]), async (req, res) => {
  try {
    const resultado = await processarPlanilhas(req.files, req.body)

    res.json({
      ok: true,
      resultado,
    })
  } catch (error) {
    console.error('ERRO /api/processar:', error)

    res.status(500).json({
      ok: false,
      erro: error.message,
    })
  }
})


app.post('/api/processar-financeiro-banco', upload.single('principal'), async (req, res) => {
  try {
    const arquivoPrincipal = req.file
    const dataInicial = req.body?.dataInicial
    const dataFinal = req.body?.dataFinal

    if (!arquivoPrincipal) {
      return res.status(400).json({ ok: false, erro: 'Planilha principal não foi recebida.' })
    }

    if (!dataInicial || !dataFinal) {
      return res.status(400).json({ ok: false, erro: 'Informe data inicial e data final.' })
    }

    if (dataInicial > dataFinal) {
      return res.status(400).json({ ok: false, erro: 'A data inicial não pode ser maior que a data final.' })
    }

    const caminhoAuxiliar = await gerarPlanilhaAuxiliarDoBanco({
      nomeArquivo: `Planilha_Estoque_Banco_${dataInicial}_a_${dataFinal}.xlsx`,
      dataInicial,
      dataFinal,
    })

    const bufferAuxiliar = await fs.readFile(caminhoAuxiliar)

    const bufferResultado = await processarPlanilhas(
      arquivoPrincipal.buffer,
      bufferAuxiliar,
      null,
      { dataInicial, dataFinal }
    )

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="Financeiro_Geral.xlsx"')
    res.send(Buffer.from(bufferResultado))
  } catch (error) {
    console.error('ERRO /api/processar-financeiro-banco:', error)
    res.status(500).json({ ok: false, erro: error.message })
  }
})

app.get('/api/dashboard', async (req, res) => {
  try {
    const [vendas] = await db.query(`
      SELECT
        p.nome AS produto,
        SUM(l.quantidade_vendas) AS quantidade,
        SUM(l.valor_vendas) AS receita,
        CASE 
          WHEN SUM(l.quantidade_vendas) > 0 
          THEN SUM(l.valor_vendas) / SUM(l.quantidade_vendas)
          ELSE 0
        END AS preco_medio
      FROM lmc_movimentos l
      LEFT JOIN produtos p ON p.id = l.produto_id
      GROUP BY p.nome
      ORDER BY p.nome
    `)

    const [[total]] = await db.query(`
      SELECT
        SUM(quantidade_vendas) AS quantidade_total,
        SUM(valor_vendas) AS receita_total
      FROM lmc_movimentos
    `)

    res.json({
      ok: true,
      vendas,
      total
    })
  } catch (error) {
    res.status(500).json({
      ok: false,
      erro: error.message
    })
  }
})


function obterFiltroCompetencias(req, campoData) {
  const texto = String(req.query.competencias || '').trim()
  if (!texto) return { sql: '', params: [] }

  const competencias = texto
    .split(',')
    .map(item => item.trim())
    .filter(item => /^\d{4}-\d{2}$/.test(item))

  if (!competencias.length) return { sql: '', params: [] }

  return {
    sql: ` WHERE DATE_FORMAT(${campoData}, '%Y-%m') IN (${competencias.map(() => '?').join(',')})`,
    params: competencias,
  }
}

app.get('/api/dashboard/mensal', async (req, res) => {
  try {
    const filtro = obterFiltroCompetencias(req, 'l.data_movimento')
    const [rows] = await db.query(`
      SELECT
        DATE_FORMAT(l.data_movimento, '%Y-%m') AS mes,
        p.nome AS produto,
        SUM(l.quantidade_vendas) AS quantidade,
        SUM(l.valor_vendas) AS receita,
        CASE
          WHEN SUM(l.quantidade_vendas) > 0
          THEN SUM(l.valor_vendas) / SUM(l.quantidade_vendas)
          ELSE 0
        END AS preco_medio
      FROM lmc_movimentos l
      LEFT JOIN produtos p ON p.id = l.produto_id
      ${filtro.sql}
      GROUP BY mes, p.nome
      ORDER BY mes ASC, p.nome ASC
    `, filtro.params)

    res.json({ ok: true, dados: rows })
  } catch (error) {
    console.error('ERRO /api/dashboard/mensal:', error)
    res.status(500).json({ ok: false, erro: error.message })
  }
})

app.get('/api/dashboard/financeiro', async (req, res) => {
  try {
    const filtro = obterFiltroCompetencias(req, 'data_lancamento')
    const [entradas] = await db.query(`
      SELECT origem, SUM(valor) total
      FROM extratos_bancarios
      ${filtro.sql}${filtro.sql ? ' AND' : ' WHERE'} valor > 0
      GROUP BY origem
      ORDER BY origem
    `, filtro.params)

    const [saidas] = await db.query(`
      SELECT origem, SUM(ABS(valor)) total
      FROM extratos_bancarios
      ${filtro.sql}${filtro.sql ? ' AND' : ' WHERE'} valor < 0
      GROUP BY origem
      ORDER BY origem
    `, filtro.params)

    const [[saldo]] = await db.query(`
      SELECT SUM(valor) saldo_total
      FROM extratos_bancarios
      ${filtro.sql}
    `, filtro.params)

    res.json({ ok: true, entradas, saidas, saldo: saldo.saldo_total || 0 })
  } catch (error) {
    console.error('ERRO /api/dashboard/financeiro:', error)
    res.status(500).json({ ok: false, erro: error.message })
  }
})

app.get('/api/competencias', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT DISTINCT
        DATE_FORMAT(data_movimento, '%b%y') AS competencia,
        YEAR(data_movimento) AS ano,
        MONTH(data_movimento) AS mes
      FROM lmc_movimentos
      ORDER BY ano, mes
    `)

    const competencias = rows.map(item => ({
      codigo: item.competencia,
      ano: item.ano,
      mes: item.mes
    }))

    res.json({
      ok: true,
      competencias
    })
  } catch (error) {
    console.error('ERRO /api/competencias:', error)

    res.status(500).json({
      ok: false,
      erro: error.message
    })
  }
})

app.get('/api/dashboard/resumo', async (req, res) => {
  try {
    const filtroLmc = obterFiltroCompetencias(req, 'l.data_movimento')
    const filtroCompras = obterFiltroCompetencias(req, 'data_emissao')
    const filtroFinanceiro = obterFiltroCompetencias(req, 'data_lancamento')

    const [produtos] = await db.query(`
      SELECT p.nome AS produto,
        SUM(l.quantidade_vendas) AS quantidade,
        SUM(l.valor_vendas) AS receita
      FROM lmc_movimentos l
      LEFT JOIN produtos p ON p.id = l.produto_id
      ${filtroLmc.sql}
      GROUP BY p.nome
    `, filtroLmc.params)

    const [[vendas]] = await db.query(`
      SELECT SUM(l.quantidade_vendas) AS quantidade_total,
        SUM(l.valor_vendas) AS receita_total
      FROM lmc_movimentos l
      ${filtroLmc.sql}
    `, filtroLmc.params)

    const [[compras]] = await db.query(`
      SELECT SUM(valor_total) AS total_compras
      FROM compras
      ${filtroCompras.sql}
    `, filtroCompras.params)

    const [[financeiro]] = await db.query(`
      SELECT SUM(valor) AS saldo_total
      FROM extratos_bancarios
      ${filtroFinanceiro.sql}
    `, filtroFinanceiro.params)

    res.json({
      ok: true,
      resumo: {
        receitaTotal: Number(vendas.receita_total || 0),
        quantidadeTotal: Number(vendas.quantidade_total || 0),
        comprasTotal: Number(compras.total_compras || 0),
        saldoFinanceiro: Number(financeiro.saldo_total || 0),
        produtos
      }
    })
  } catch (error) {
    console.error('ERRO /api/dashboard/resumo:', error)
    res.status(500).json({ ok: false, erro: error.message })
  }
})


function dataIsoValida(valor, nomeCampo) {
  const texto = String(valor || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    throw new Error(`${nomeCampo} inválida.`)
  }

  const data = new Date(`${texto}T00:00:00`)
  if (Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== texto) {
    throw new Error(`${nomeCampo} inválida.`)
  }

  return texto
}

function obterIntervaloDatas(req) {
  const hoje = new Date()
  const primeiroDiaMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10)
  const ultimoDiaMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().slice(0, 10)

  const dataInicial = dataIsoValida(req.query.dataInicial || req.body?.dataInicial || primeiroDiaMes, 'Data inicial')
  const dataFinal = dataIsoValida(req.query.dataFinal || req.body?.dataFinal || ultimoDiaMes, 'Data final')

  if (dataInicial > dataFinal) {
    throw new Error('A data inicial não pode ser maior que a data final.')
  }

  return { dataInicial, dataFinal }
}

async function consultarResumoDadosGravados(req, res) {
  try {
    const { dataInicial, dataFinal } = obterIntervaloDatas(req)

    const [[compras]] = await db.query(`
      SELECT
        COUNT(*) AS registros,
        COALESCE(SUM(c.quant_rec), 0) AS quantidade,
        COALESCE(SUM(c.valor_pag), 0) AS valor_total
      FROM compras c
      WHERE c.data_emissao BETWEEN ? AND ?
    `, [dataInicial, dataFinal])

    const [[lmc]] = await db.query(`
      SELECT
        COUNT(*) AS registros,
        COALESCE(SUM(l.quantidade_vendas), 0) AS quantidade_vendas,
        COALESCE(SUM(l.valor_vendas), 0) AS valor_vendas
      FROM lmc_movimentos l
      WHERE l.data_movimento BETWEEN ? AND ?
    `, [dataInicial, dataFinal])

    const [[extratos]] = await db.query(`
      SELECT
        COUNT(*) AS registros,
        COALESCE(SUM(CASE WHEN e.valor > 0 THEN e.valor ELSE 0 END), 0) AS entradas,
        COALESCE(SUM(CASE WHEN e.valor < 0 THEN ABS(e.valor) ELSE 0 END), 0) AS saidas,
        COALESCE(SUM(e.valor), 0) AS saldo
      FROM extratos_bancarios e
      WHERE e.data_lancamento BETWEEN ? AND ?
    `, [dataInicial, dataFinal])

    const [[vendasCartao]] = await db.query(`
      SELECT COUNT(*) AS registros,
        COALESCE(SUM(vendas_bruta), 0) AS vendas_bruta,
        COALESCE(SUM(venda_liquida), 0) AS venda_liquida,
        COALESCE(SUM(taxa), 0) AS taxas
      FROM vendas_cartao
      WHERE data_lancamento BETWEEN ? AND ? AND status = 'ATIVO'
    `, [dataInicial, dataFinal])

    res.json({
      ok: true,
      resumo: {
        compras: {
          registros: Number(compras.registros || 0),
          quantidade: Number(compras.quantidade || 0),
          valorTotal: Number(compras.valor_total || 0),
        },
        lmc: {
          registros: Number(lmc.registros || 0),
          quantidadeVendas: Number(lmc.quantidade_vendas || 0),
          valorVendas: Number(lmc.valor_vendas || 0),
        },
        extratos: {
          registros: Number(extratos.registros || 0),
          entradas: Number(extratos.entradas || 0),
          saidas: Number(extratos.saidas || 0),
          saldo: Number(extratos.saldo || 0),
        },
        vendasCartao: {
          registros: Number(vendasCartao.registros || 0),
          vendaBruta: Number(vendasCartao.vendas_bruta || 0),
          vendaLiquida: Number(vendasCartao.venda_liquida || 0),
          taxas: Number(vendasCartao.taxas || 0),
        },
      },
    })
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message })
  }
}




async function garantirPermissaoNumeroLancamento() {
  const [colunas] = await db.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'permissoes'
      AND COLUMN_NAME = 'numero_lancamento'
    LIMIT 1
  `)
  if (!colunas.length) {
    await db.query(`ALTER TABLE permissoes ADD COLUMN numero_lancamento TINYINT(1) NOT NULL DEFAULT 0 AFTER imprimir`)
  }
  await db.query(`
    UPDATE permissoes p
    INNER JOIN usuarios u ON u.id = p.usuario_id
    SET p.numero_lancamento = 1
    WHERE UPPER(u.perfil) = 'ADMIN' AND p.numero_lancamento <> 1
  `)
}

async function podeAjustarNumeroLancamento(req, res, next) {
  try {
    if (String(req.usuario?.perfil || '').toUpperCase() === 'ADMIN') return next()
    const permissoes = req.permissoes || await obterPermissoesUsuario(req.usuario.id)
    if (Number(permissoes?.numero_lancamento || 0) === 1) return next()
    return res.status(403).json({ ok: false, erro: 'Seu usuário não possui permissão para visualizar ou alterar o número do lançamento.' })
  } catch (error) {
    return res.status(500).json({ ok: false, erro: error.message || 'Erro ao validar a permissão de número de lançamento.' })
  }
}

async function validarSenhaAdministrativa(senha) {
  const informada = String(senha || '')
  if (!informada) return false
  if (process.env.SENHA_ADMIN && informada === String(process.env.SENHA_ADMIN)) return true
  const [admins] = await db.query(`SELECT senha FROM usuarios WHERE UPPER(perfil) = 'ADMIN' AND ativo = 1`)
  for (const admin of admins) {
    if (await bcrypt.compare(informada, String(admin.senha || ''))) return true
  }
  return false
}

app.put('/api/financeiro-geral/lancamentos/:id/numero', podeAjustarNumeroLancamento, async (req, res) => {
  const connection = await db.getConnection()
  try {
    const idSelecionado = Number(req.params.id)
    const dataInicial = String(req.body?.dataInicial || '').slice(0, 10)
    const modo = String(req.body?.modo || 'ajuste').toLowerCase()
    const ajuste = Number(req.body?.ajuste || 0)
    const numeroInicial = Number(req.body?.numeroInicial || 0)
    if (!Number.isInteger(idSelecionado) || idSelecionado <= 0) throw new Error('Número atual do lançamento inválido.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicial)) throw new Error('Informe uma data inicial válida.')
    if (!['ajuste', 'inicial'].includes(modo)) throw new Error('Escolha uma forma válida de renumeração.')
    if (modo === 'ajuste' && (!Number.isInteger(ajuste) || ajuste === 0)) throw new Error('Informe um número inteiro diferente de zero para somar ou subtrair.')
    if (modo === 'inicial' && (!Number.isInteger(numeroInicial) || numeroInicial <= 0)) throw new Error('Informe um número inicial inteiro maior que zero.')
    if (!(await validarSenhaAdministrativa(req.body?.senhaAdministrativa))) {
      return res.status(401).json({ ok: false, erro: 'Senha administrativa inválida.' })
    }

    await connection.beginTransaction()
    const [selecionado] = await connection.query('SELECT id FROM financeiro_geral WHERE id = ? FOR UPDATE', [idSelecionado])
    if (!selecionado.length) throw new Error('Lançamento selecionado não foi encontrado.')

    const [afetados] = await connection.query(`
      SELECT id, data_lancamento
      FROM financeiro_geral
      WHERE DATE(data_lancamento) >= ?
      ORDER BY data_lancamento ASC, id ASC
      FOR UPDATE
    `, [dataInicial])
    if (!afetados.length) throw new Error('Não existem lançamentos a partir da data inicial informada.')

    const idsAfetados = new Set(afetados.map((linha) => Number(linha.id)))
    const alteracoes = afetados.map((linha, indice) => ({
      antigo: Number(linha.id),
      novo: modo === 'inicial' ? numeroInicial + indice : Number(linha.id) + ajuste,
    }))
    const menorNovo = Math.min(...alteracoes.map((item) => item.novo))
    if (menorNovo <= 0) throw new Error('A renumeração produziria números de lançamento menores ou iguais a zero.')
    const novosIds = alteracoes.map((item) => item.novo)
    if (new Set(novosIds).size !== novosIds.length) throw new Error('A renumeração produziria números de lançamento duplicados.')

    const placeholders = novosIds.map(() => '?').join(',')
    const [conflitos] = await connection.query(`SELECT id FROM financeiro_geral WHERE id IN (${placeholders}) FOR UPDATE`, novosIds)
    const conflitoExterno = conflitos.find((linha) => !idsAfetados.has(Number(linha.id)))
    if (conflitoExterno) {
      const erro = new Error(`O número ${conflitoExterno.id} já está sendo usado por um lançamento anterior à data inicial.`)
      erro.statusCode = 409
      throw erro
    }

    const [[maximoAntes]] = await connection.query('SELECT COALESCE(MAX(id), 0) AS maior FROM financeiro_geral')
    const maiorNovo = Math.max(...novosIds)
    const deslocamentoTemporario = Math.max(Number(maximoAntes.maior || 0), maiorNovo) + afetados.length + 1000
    for (const item of alteracoes) {
      await connection.query('UPDATE financeiro_geral SET id = ? WHERE id = ?', [item.antigo + deslocamentoTemporario, item.antigo])
    }
    for (const item of alteracoes) {
      await connection.query(
        'UPDATE financeiro_geral SET id = ?, atualizado_em = NOW(), usuario_id = ? WHERE id = ?',
        [item.novo, req.usuario.id, item.antigo + deslocamentoTemporario]
      )
    }

    const [[maximoDepois]] = await connection.query('SELECT COALESCE(MAX(id), 0) AS maior FROM financeiro_geral')
    const proximo = Number(maximoDepois.maior || 0) + 1
    await connection.commit()
    await connection.query(`ALTER TABLE financeiro_geral AUTO_INCREMENT = ${Math.trunc(proximo)}`)
    const descricao = modo === 'inicial' ? `iniciando em ${numeroInicial}` : `${ajuste > 0 ? 'somando' : 'subtraindo'} ${Math.abs(ajuste)}`
    res.json({ ok: true, dataInicial, modo, ajuste, numeroInicial, quantidadeAlterada: alteracoes.length, proximoNumero: proximo,
      mensagem: `${alteracoes.length} lançamento(s) foram renumerados a partir de ${dataInicial.split('-').reverse().join('/')}, ${descricao}, preservando a ordem atual.` })
  } catch (error) {
    await connection.rollback().catch(() => {})
    res.status(Number(error?.statusCode) || 400).json({ ok: false, erro: error.message || 'Erro ao ajustar os números dos lançamentos.' })
  } finally {
    connection.release()
  }
})

app.put('/api/dados-gravados/:tipo/:id/numero', podeAjustarNumeroLancamento, async (req, res) => {
  const connection = await db.getConnection()
  try {
    const tipo = String(req.params.tipo || '').toLowerCase()
    const idAtual = Number(req.params.id)
    const dataInicial = String(req.body?.dataInicial || '').slice(0, 10)
    const modo = String(req.body?.modo || 'ajuste').toLowerCase()
    const ajuste = Number(req.body?.ajuste || 0)
    const numeroInicial = Number(req.body?.numeroInicial || 0)
    const configuracoes = {
      compras: { tabela: 'compras', data: 'data_emissao' },
      vendas: { tabela: 'lmc_movimentos', data: 'data_movimento' },
      'vendas-cartao': { tabela: 'vendas_cartao', data: 'data_lancamento' },
      spot: { tabela: 'extratos_bancarios', data: 'data_lancamento', banco: 'SPOT' },
      itau: { tabela: 'extratos_bancarios', data: 'data_lancamento', banco: 'ITAU' },
      extrato: { tabela: 'extratos_bancarios', data: 'data_lancamento' },
    }
    const config = configuracoes[tipo]
    if (!config) throw new Error('Tipo de lançamento inválido.')
    if (!Number.isInteger(idAtual) || idAtual <= 0) throw new Error('Número atual do lançamento inválido.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicial)) throw new Error('Informe uma data inicial válida.')
    if (!['ajuste', 'inicial'].includes(modo)) throw new Error('Escolha uma forma válida de renumeração.')
    if (modo === 'ajuste' && (!Number.isInteger(ajuste) || ajuste === 0)) throw new Error('Informe um número inteiro diferente de zero para somar ou subtrair.')
    if (modo === 'inicial' && (!Number.isInteger(numeroInicial) || numeroInicial <= 0)) throw new Error('Informe um número inicial inteiro maior que zero.')
    if (!(await validarSenhaAdministrativa(req.body?.senhaAdministrativa))) {
      return res.status(401).json({ ok: false, erro: 'Senha administrativa inválida.' })
    }

    const { tabela, data: colunaData, banco } = config
    await connection.beginTransaction()
    const [origem] = await connection.query(`SELECT id FROM ${tabela} WHERE id = ? FOR UPDATE`, [idAtual])
    if (!origem.length) throw new Error('Lançamento não encontrado.')
    const filtroBanco = banco ? ` AND UPPER(COALESCE(banco, origem, '')) LIKE ?` : ''
    const parametros = banco ? [dataInicial, `%${banco}%`] : [dataInicial]
    const [afetados] = await connection.query(`
      SELECT id, ${colunaData} AS data_ordem
      FROM ${tabela}
      WHERE DATE(${colunaData}) >= ?${filtroBanco}
      ORDER BY ${colunaData} ASC, id ASC
      FOR UPDATE
    `, parametros)
    if (!afetados.length) throw new Error('Não existem lançamentos a partir da data inicial informada.')

    const idsAfetados = new Set(afetados.map((linha) => Number(linha.id)))
    const alteracoes = afetados.map((linha, indice) => ({ antigo: Number(linha.id), novo: modo === 'inicial' ? numeroInicial + indice : Number(linha.id) + ajuste }))
    const novosIds = alteracoes.map((item) => item.novo)
    if (Math.min(...novosIds) <= 0) throw new Error('A renumeração produziria números menores ou iguais a zero.')
    if (new Set(novosIds).size !== novosIds.length) throw new Error('A renumeração produziria números duplicados.')
    const placeholders = novosIds.map(() => '?').join(',')
    const [conflitos] = await connection.query(`SELECT id FROM ${tabela} WHERE id IN (${placeholders}) FOR UPDATE`, novosIds)
    const conflitoExterno = conflitos.find((linha) => !idsAfetados.has(Number(linha.id)))
    if (conflitoExterno) {
      const erro = new Error(`O número ${conflitoExterno.id} já está sendo usado por outro lançamento.`)
      erro.statusCode = 409
      throw erro
    }

    const [[maximoAntes]] = await connection.query(`SELECT COALESCE(MAX(id), 0) AS maior FROM ${tabela}`)
    const deslocamentoTemporario = Math.max(Number(maximoAntes.maior || 0), ...novosIds) + afetados.length + 1000
    for (const item of alteracoes) await connection.query(`UPDATE ${tabela} SET id = ? WHERE id = ?`, [item.antigo + deslocamentoTemporario, item.antigo])
    for (const item of alteracoes) await connection.query(`UPDATE ${tabela} SET id = ? WHERE id = ?`, [item.novo, item.antigo + deslocamentoTemporario])
    const [[maximo]] = await connection.query(`SELECT COALESCE(MAX(id), 0) AS maior FROM ${tabela}`)
    const proximo = Number(maximo.maior || 0) + 1
    await connection.commit()
    await connection.query(`ALTER TABLE ${tabela} AUTO_INCREMENT = ${Math.trunc(proximo)}`)
    const descricao = modo === 'inicial' ? `iniciando em ${numeroInicial}` : `${ajuste > 0 ? 'somando' : 'subtraindo'} ${Math.abs(ajuste)}`
    res.json({ ok: true, dataInicial, modo, quantidadeAlterada: alteracoes.length, proximoNumero: proximo,
      mensagem: `${alteracoes.length} lançamento(s) foram renumerados a partir de ${dataInicial.split('-').reverse().join('/')}, ${descricao}, preservando a ordem atual.` })
  } catch (error) {
    await connection.rollback().catch(() => {})
    res.status(Number(error?.statusCode) || 400).json({ ok: false, erro: error.message || 'Erro ao ajustar o número do lançamento.' })
  } finally {
    connection.release()
  }
})

async function garantirConfiguracaoFinanceiro() {
  await db.query(`CREATE TABLE IF NOT EXISTS configuracoes_financeiro (
    empresa_id INT NOT NULL PRIMARY KEY,
    data_trava_consolidacao DATE NULL,
    atualizado_por INT NULL,
    atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
}

async function obterDataTravaConsolidacao(empresaId = 1) {
  await garantirConfiguracaoFinanceiro()
  const [rows] = await db.query(
    `SELECT DATE_FORMAT(data_trava_consolidacao, '%Y-%m-%d') AS data_trava_consolidacao
       FROM configuracoes_financeiro WHERE empresa_id = ? LIMIT 1`,
    [empresaId]
  )
  return rows[0]?.data_trava_consolidacao || null
}

async function validarDataDesbloqueada(empresaId, data, operacao = 'alterar') {
  const trava = await obterDataTravaConsolidacao(empresaId)
  if (trava && data && String(data).slice(0, 10) <= trava) {
    throw new Error(`Período consolidado e bloqueado até ${trava.split('-').reverse().join('/')}. Não é permitido ${operacao} lançamentos nessa data ou antes dela.`)
  }
  return trava
}

app.get('/api/dados-gravados', consultarResumoDadosGravados)



app.get('/api/configuracoes-financeiro', async (req, res) => {
  try {
    const empresaId = Number(req.query?.empresaId || 1)
    const dataTravaConsolidacao = await obterDataTravaConsolidacao(empresaId)
    res.json({ ok: true, dataTravaConsolidacao })
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message || 'Erro ao carregar a configuração financeira.' })
  }
})

app.put('/api/configuracoes-financeiro', async (req, res) => {
  try {
    if (String(req.usuario?.perfil || '').toUpperCase() !== 'ADMIN') {
      const permissoes = req.permissoes || await obterPermissoesUsuario(req.usuario.id)
      if (!possuiPermissao(req.usuario, permissoes, 'configuracoes')) {
        return res.status(403).json({ ok: false, erro: 'Seu usuário não possui permissão para alterar configurações.' })
      }
    }
    const empresaId = Number(req.body?.empresaId || 1)
    const data = String(req.body?.dataTravaConsolidacao || '').trim()
    if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error('Informe uma data válida.')
    await garantirConfiguracaoFinanceiro()
    await db.query(
      `INSERT INTO configuracoes_financeiro (empresa_id, data_trava_consolidacao, atualizado_por)
       VALUES (?, NULLIF(?, ''), ?)
       ON DUPLICATE KEY UPDATE data_trava_consolidacao = VALUES(data_trava_consolidacao), atualizado_por = VALUES(atualizado_por)`,
      [empresaId, data, req.usuario?.id || null]
    )
    res.json({ ok: true, dataTravaConsolidacao: data || null, mensagem: data ? `Alterações bloqueadas até ${data.split('-').reverse().join('/')}.` : 'Bloqueio de data removido.' })
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message || 'Erro ao salvar a configuração financeira.' })
  }
})

app.post('/api/financeiro-geral/atualizar-saldos', async (req, res) => {
  const conn = await db.getConnection()
  try {
    const empresaId = Number(req.body?.empresa_id || req.body?.empresaId || 1)
    const dataInicial = String(req.body?.dataInicial || '').trim()
    const dataFinal = String(req.body?.dataFinal || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicial) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFinal)) throw new Error('Informe um período válido.')
    if (dataInicial > dataFinal) throw new Error('A data inicial não pode ser posterior à data final.')
    const dataTrava = await obterDataTravaConsolidacao(empresaId)
    const primeiroDiaLiberado = dataTrava ? proximaDataLocal(dataTrava) : dataInicial
    const dataInicialEfetiva = dataInicial < primeiroDiaLiberado ? primeiroDiaLiberado : dataInicial
    if (dataInicialEfetiva > dataFinal) throw new Error('O período visível está integralmente dentro da data travada; não há dias liberados para atualizar.')

    const permitidas = new Set(FINANCEIRO_GERAL_COLUNAS.map(([campo]) => campo).filter((campo) => campo !== 'total'))
    const solicitadas = Array.isArray(req.body?.colunas) ? req.body.colunas.map(String).filter((campo) => permitidas.has(campo)) : []
    const colunas = [...new Set(solicitadas)]
    if (!colunas.length) throw new Error('Selecione pelo menos uma coluna para recalcular.')

    const todasNumericas = FINANCEIRO_GERAL_COLUNAS.map(([campo]) => campo).filter((campo) => campo !== 'total')
    await conn.beginTransaction()

    const saldoInicialId = Number(req.body?.saldoInicialId || 0)
    let baseRows = []
    if (Number.isInteger(saldoInicialId) && saldoInicialId > 0) {
      const [visivel] = await conn.query(
        `SELECT * FROM financeiro_geral WHERE id = ? AND empresa_id = ? AND status = 'ATIVO' LIMIT 1`,
        [saldoInicialId, empresaId]
      )
      const dataVisivel = String(visivel[0]?.data_lancamento || '').slice(0, 10)
      if (visivel[0] && dataVisivel >= dataInicialEfetiva) baseRows = visivel
    }
    if (!baseRows.length) {
      const [anteriores] = await conn.query(
        `SELECT ${todasNumericas.join(', ')} FROM financeiro_geral
         WHERE empresa_id = ? AND status = 'ATIVO' AND data_lancamento < ?
           AND UPPER(TRIM(COALESCE(descricao_normalizada, descricao_original, ''))) LIKE 'SALDO DO DIA%'
         ORDER BY data_lancamento DESC, id DESC LIMIT 1`,
        [empresaId, dataInicialEfetiva]
      )
      baseRows = anteriores
    }
    const acumulado = Object.fromEntries(todasNumericas.map((campo) => [campo, Number(baseRows[0]?.[campo] || 0)]))

    const [aberturaRows] = await conn.query(
      `SELECT * FROM financeiro_geral
       WHERE empresa_id = ? AND status = 'ATIVO' AND data_lancamento = ?
         AND (UPPER(TRIM(COALESCE(descricao_normalizada, descricao_original, ''))) LIKE 'SALDO ANTERIOR%'
           OR UPPER(TRIM(COALESCE(descricao_normalizada, descricao_original, ''))) LIKE 'SALDO INICIAL DO DIA%')
       ORDER BY id ASC LIMIT 1`,
      [empresaId, dataInicialEfetiva]
    )
    if (aberturaRows[0]) for (const campo of colunas) acumulado[campo] = Number(aberturaRows[0][campo] || 0)

    let dias = 0
    let atualizados = 0
    for (let data = dataInicialEfetiva; data <= dataFinal; data = proximaDataLocal(data)) {
      const [aberturasDia] = await conn.query(
        `SELECT id FROM financeiro_geral WHERE empresa_id = ? AND status = 'ATIVO' AND data_lancamento = ?
         AND (UPPER(TRIM(COALESCE(descricao_normalizada, descricao_original, ''))) LIKE 'SALDO ANTERIOR%'
           OR UPPER(TRIM(COALESCE(descricao_normalizada, descricao_original, ''))) LIKE 'SALDO INICIAL DO DIA%')
         ORDER BY id ASC`, [empresaId, data]
      )
      if (aberturasDia[0]) {
        const sets = colunas.map((campo) => `${campo} = ?`).join(', ')
        await conn.query(`UPDATE financeiro_geral SET ${sets}, descricao_original='Saldo anterior', descricao_normalizada='SALDO ANTERIOR', tipo_lancamento='SALDO', total=(COALESCE(conta01,0)+COALESCE(conta02,0)+COALESCE(conta03,0)+COALESCE(conta04,0)+COALESCE(conta05,0)+COALESCE(conta06,0)+COALESCE(conta07,0)+COALESCE(conta08,0)+COALESCE(conta09,0)+COALESCE(conta10,0)+COALESCE(conta11,0)+COALESCE(conta12,0)+COALESCE(conta13,0)+COALESCE(conta14,0)+COALESCE(conta15,0)+COALESCE(conta16,0)+COALESCE(conta17,0)+COALESCE(conta18,0)+COALESCE(conta19,0)+COALESCE(conta20,0)+COALESCE(conta21,0)+COALESCE(conta22,0)+COALESCE(conta23,0)+COALESCE(conta24,0)+COALESCE(conta25,0)+COALESCE(conta26,0)+COALESCE(conta27,0)+COALESCE(conta28,0)+COALESCE(conta29,0)+COALESCE(conta30,0)+COALESCE(prod1_total,0)+COALESCE(prod2_total,0)+COALESCE(prod3_total,0)+COALESCE(prod4_total,0)), atualizado_em=NOW() WHERE id=?`, [...colunas.map((campo) => acumulado[campo]), aberturasDia[0].id])
        atualizados += 1
      }

      const somas = colunas.map((campo) => `COALESCE(SUM(${campo}),0) AS ${campo}`).join(', ')
      const [[movimentos]] = await conn.query(
        `SELECT ${somas} FROM financeiro_geral WHERE empresa_id = ? AND status = 'ATIVO' AND data_lancamento = ?
         AND tipo_lancamento <> 'SALDO'
         AND UPPER(TRIM(COALESCE(descricao_normalizada, descricao_original, ''))) NOT LIKE 'SALDO%'`,
        [empresaId, data]
      )
      for (const campo of colunas) acumulado[campo] = Math.round((Number(acumulado[campo] || 0) + Number(movimentos?.[campo] || 0) + Number.EPSILON) * 1e6) / 1e6

      // Preço médio é derivado do valor total dividido pela quantidade quando os três campos do produto forem recalculados.
      for (let i = 1; i <= 4; i += 1) {
        const q = `prod${i}_quant`, v = `prod${i}_valor`, t = `prod${i}_total`
        if (colunas.includes(q) && colunas.includes(t) && colunas.includes(v) && Number(acumulado[q]) !== 0) acumulado[v] = Math.round((Number(acumulado[t]) / Number(acumulado[q])) * 1e6) / 1e6
      }

      const [fechamentos] = await conn.query(
        `SELECT id FROM financeiro_geral WHERE empresa_id = ? AND status = 'ATIVO' AND data_lancamento = ?
         AND UPPER(TRIM(COALESCE(descricao_normalizada, descricao_original, ''))) LIKE 'SALDO DO DIA%'
         ORDER BY id DESC`, [empresaId, data]
      )
      if (fechamentos[0]) {
        const sets = colunas.map((campo) => `${campo} = ?`).join(', ')
        await conn.query(`UPDATE financeiro_geral SET ${sets}, total=(COALESCE(conta01,0)+COALESCE(conta02,0)+COALESCE(conta03,0)+COALESCE(conta04,0)+COALESCE(conta05,0)+COALESCE(conta06,0)+COALESCE(conta07,0)+COALESCE(conta08,0)+COALESCE(conta09,0)+COALESCE(conta10,0)+COALESCE(conta11,0)+COALESCE(conta12,0)+COALESCE(conta13,0)+COALESCE(conta14,0)+COALESCE(conta15,0)+COALESCE(conta16,0)+COALESCE(conta17,0)+COALESCE(conta18,0)+COALESCE(conta19,0)+COALESCE(conta20,0)+COALESCE(conta21,0)+COALESCE(conta22,0)+COALESCE(conta23,0)+COALESCE(conta24,0)+COALESCE(conta25,0)+COALESCE(conta26,0)+COALESCE(conta27,0)+COALESCE(conta28,0)+COALESCE(conta29,0)+COALESCE(conta30,0)+COALESCE(prod1_total,0)+COALESCE(prod2_total,0)+COALESCE(prod3_total,0)+COALESCE(prod4_total,0)), atualizado_em=NOW() WHERE id=?`, [...colunas.map((campo) => acumulado[campo]), fechamentos[0].id])
        atualizados += 1
      }
      dias += 1
    }

    await conn.commit()
    res.json({ ok: true, dias, atualizados, dataInicialEfetiva, mensagem: `Saldos atualizados a partir de ${dataInicialEfetiva.split('-').reverse().join('/')} em ${dias} dia(s). Nenhum lançamento anterior à trava foi alterado e nenhum saldo foi criado em dia sem lançamentos.` })
  } catch (error) {
    await conn.rollback().catch(() => {})
    res.status(400).json({ ok: false, erro: error.message || 'Erro ao atualizar os saldos.' })
  } finally {
    conn.release()
  }
})

app.post('/api/financeiro-geral/consolidar', async (req, res) => {
  try {
    const empresaId = Number(req.body?.empresa_id || req.body?.empresaId || 1)
    const dataInicial = String(req.body?.dataInicial || '').trim()
    const dataFinal = String(req.body?.dataFinal || '').trim()
    const contaBancariaId = req.body?.contaBancariaId ? Number(req.body.contaBancariaId) : null
    const dataTrava = await obterDataTravaConsolidacao(empresaId)
    const primeiroDiaLiberado = dataTrava ? proximaDataLocal(dataTrava) : dataInicial
    const dataInicialEfetiva = dataTrava && dataInicial <= dataTrava ? primeiroDiaLiberado : dataInicial

    if (dataFinal && dataInicialEfetiva > dataFinal) {
      return res.json({
        ok: true,
        mensagem: `Nenhum lançamento consolidado. O período até ${dataTrava.split('-').reverse().join('/')} está travado; os lançamentos são processados somente a partir de ${primeiroDiaLiberado.split('-').reverse().join('/')}.`,
        resultado: { periodo: { dataInicial: dataInicialEfetiva, dataFinal }, encontrados: {}, inseridos: 0, atualizados: 0, ignorados: 0, contasSemMapeamento: [] },
      })
    }

    const resultado = await consolidarFinanceiroGeral({
      empresaId,
      dataInicial: dataInicialEfetiva,
      dataFinal,
      contaBancariaId,
      usuarioId: req.usuario?.id || null,
      limparAntes: Boolean(req.body?.limparAntes),
      dataSaldoAnterior: req.body?.dataSaldoAnterior && req.body.dataSaldoAnterior > (dataTrava || '') ? req.body.dataSaldoAnterior : null,
      dataInicioLancamentos: dataInicialEfetiva,
      dataMinimaGravacao: dataInicialEfetiva,
    })

    const avisoTrava = dataInicialEfetiva !== dataInicial
      ? ` Período travado até ${dataTrava.split('-').reverse().join('/')} desconsiderado; processamento iniciado em ${dataInicialEfetiva.split('-').reverse().join('/')}.`
      : ''
    res.json({
      ok: true,
      mensagem: `Consolidação concluída: ${resultado.inseridos} incluídos, ${resultado.atualizados} atualizados e ${resultado.ignorados} ignorados.${avisoTrava}`,
      resultado,
    })
  } catch (error) {
    console.error('ERRO /api/financeiro-geral/consolidar:', error)
    res.status(400).json({ ok: false, erro: error.message || 'Erro ao consolidar os lançamentos.' })
  }
})


app.post('/api/financeiro-geral/reconsolidar-zero', async (req, res) => {
  try {
    const empresaId = Number(req.body?.empresa_id || req.body?.empresaId || 1)
    const dataInicial = String(req.body?.dataInicial || '').trim()
    const dataFinal = String(req.body?.dataFinal || '').trim()
    const colunaSolicitada = String(req.body?.coluna || 'TODAS').trim()
    const colunasRecriaveis = new Set([
      ...Array.from({ length: 30 }, (_, i) => `conta${String(i + 1).padStart(2, '0')}`),
      ...['prod1_quant','prod1_valor','prod1_total','prod2_quant','prod2_valor','prod2_total','prod3_quant','prod3_valor','prod3_total','prod4_quant','prod4_valor','prod4_total'],
    ])
    if (colunaSolicitada !== 'TODAS' && !colunasRecriaveis.has(colunaSolicitada)) {
      throw new Error('A coluna selecionada para recriação é inválida.')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicial) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFinal)) {
      throw new Error('Informe um período válido.')
    }
    if (dataInicial > dataFinal) throw new Error('A data inicial não pode ser posterior à data final.')
    const dataTrava = await obterDataTravaConsolidacao(empresaId)
    const primeiroDiaLiberado = dataTrava ? proximaDataLocal(dataTrava) : dataInicial
    const dataInicialEfetiva = dataTrava && dataInicial <= dataTrava ? primeiroDiaLiberado : dataInicial

    if (dataInicialEfetiva > dataFinal) {
      return res.json({
        ok: true,
        mensagem: `Nenhum lançamento recriado. O período até ${dataTrava.split('-').reverse().join('/')} está travado; os lançamentos são processados somente a partir de ${primeiroDiaLiberado.split('-').reverse().join('/')}.`,
        resultado: { periodo: { dataInicial: dataInicialEfetiva, dataFinal }, encontrados: {}, inseridos: 0, atualizados: 0, ignorados: 0, contasSemMapeamento: [] },
      })
    }

    // O saldo do dia travado é preservado e usado como base. A recriação começa
    // exclusivamente no dia seguinte, sem excluir nem regravar o período protegido.
    const recriacaoCompleta = colunaSolicitada === 'TODAS'
    if (!recriacaoCompleta) {
      // Preserva as demais colunas e limpa somente os movimentos da coluna escolhida.
      // As linhas de saldo ficam para fornecer a abertura correta e serão recalculadas
      // ao final da consolidação.
      await db.query(
        `UPDATE financeiro_geral
            SET ${colunaSolicitada} = 0,
                total = (COALESCE(conta01,0)+COALESCE(conta02,0)+COALESCE(conta03,0)+COALESCE(conta04,0)+COALESCE(conta05,0)+COALESCE(conta06,0)+COALESCE(conta07,0)+COALESCE(conta08,0)+COALESCE(conta09,0)+COALESCE(conta10,0)+COALESCE(conta11,0)+COALESCE(conta12,0)+COALESCE(conta13,0)+COALESCE(conta14,0)+COALESCE(conta15,0)+COALESCE(conta16,0)+COALESCE(conta17,0)+COALESCE(conta18,0)+COALESCE(conta19,0)+COALESCE(conta20,0)+COALESCE(conta21,0)+COALESCE(conta22,0)+COALESCE(conta23,0)+COALESCE(conta24,0)+COALESCE(conta25,0)+COALESCE(conta26,0)+COALESCE(conta27,0)+COALESCE(conta28,0)+COALESCE(conta29,0)+COALESCE(conta30,0)),
                atualizado_em = NOW()
          WHERE empresa_id = ?
            AND data_lancamento BETWEEN ? AND ?
            AND status = 'ATIVO'
            AND tipo_lancamento <> 'SALDO'`,
        [empresaId, dataInicialEfetiva, dataFinal]
      )
    }

    const resultado = await consolidarFinanceiroGeral({
      empresaId,
      dataInicial: dataInicialEfetiva,
      dataFinal,
      usuarioId: req.usuario?.id || null,
      limparAntes: recriacaoCompleta,
      dataSaldoAnterior: dataInicialEfetiva,
      dataInicioLancamentos: dataInicialEfetiva,
      dataMinimaGravacao: dataInicialEfetiva,
    })

    const avisoTrava = dataInicialEfetiva !== dataInicial
      ? ` O período até ${dataTrava.split('-').reverse().join('/')} foi preservado e a recriação começou em ${dataInicialEfetiva.split('-').reverse().join('/')}.`
      : ''
    res.json({
      ok: true,
      mensagem: `${recriacaoCompleta ? 'Financeiro Geral' : `Coluna ${colunaSolicitada}`} recriado(a) no período de ${dataInicialEfetiva.split('-').reverse().join('/')} a ${dataFinal.split('-').reverse().join('/')}.${avisoTrava}`,
      resultado,
    })
  } catch (error) {
    console.error('ERRO /api/financeiro-geral/reconsolidar-zero:', error)
    res.status(400).json({ ok: false, erro: error.message || 'Erro ao recriar o Financeiro Geral.' })
  }
})

app.get('/api/financeiro-geral/resumo', async (req, res) => {
  try {
    const empresaId = Number(req.query.empresaId || 1)
    const dataInicial = String(req.query.dataInicial || '').trim()
    const dataFinal = String(req.query.dataFinal || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicial) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFinal)) {
      throw new Error('Informe um período válido.')
    }

    const [[resumo]] = await db.query(
      `SELECT COUNT(*) AS registros,
              COALESCE(SUM(conta01), 0) AS conta01,
              COALESCE(SUM(conta02), 0) AS conta02,
              COALESCE(SUM(conta03), 0) AS conta03,
              COALESCE(SUM(conta04), 0) AS conta04,
              COALESCE(SUM(conta11), 0) AS conta11
       FROM financeiro_geral
       WHERE empresa_id = ?
         AND data_lancamento BETWEEN ? AND ?
         AND status = 'ATIVO'`,
      [empresaId, dataInicial, dataFinal]
    )

    res.json({ ok: true, resumo })
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message })
  }
})


const CAMPOS_CONTAS_FINANCEIRO = Array.from({ length: 30 }, (_, i) => `conta${String(i + 1).padStart(2, '0')}`)
const CAMPOS_PRODUTOS_FINANCEIRO = Array.from({ length: 4 }, (_, i) => {
  const produto = `prod${i + 1}`
  return [`${produto}_quant`, `${produto}_valor`, `${produto}_total`]
}).flat()
// Lista exclusivamente técnica dos campos físicos aceitos na tabela financeiro_geral.
// Nomes, títulos, ordem e visibilidade estrutural vêm de financeiro_geral_mapeamentos.
const FINANCEIRO_GERAL_COLUNAS = [
  ...CAMPOS_CONTAS_FINANCEIRO,
  ...CAMPOS_PRODUTOS_FINANCEIRO,
  'total',
].map((campo) => [campo, campo])

async function colunasFinanceiroGeralAtivas(empresaId) {
  // Única fonte da estrutura visual: financeiro_geral_mapeamentos.
  // conta_financeira_id pode ser NULL em mapeamentos estruturais e isso não
  // impede a coluna de existir. O campo descricao define o título exibido.
  const [mapeamentos] = await db.query(
    `SELECT id, tipo, campo_destino, conta_financeira_id, produto_id, descricao
       FROM financeiro_geral_mapeamentos
      WHERE empresa_id = ? AND ativo = 1
      ORDER BY id ASC`,
    [empresaId]
  )

  const colunas = []
  const chavesIncluidas = new Set()

  for (const item of mapeamentos) {
    const tipo = String(item.tipo || '').toUpperCase()
    const destino = String(item.campo_destino || '').trim()
    const descricao = String(item.descricao || '').trim()

    if (tipo === 'CONTA' && /^conta\d{2}$/.test(destino) && CAMPOS_CONTAS_FINANCEIRO.includes(destino)) {
      if (chavesIncluidas.has(destino)) continue
      colunas.push({
        key: destino,
        label: descricao || destino.toUpperCase(),
        largura: 'valor12',
      })
      chavesIncluidas.add(destino)
      continue
    }

    if (tipo === 'PRODUTO' && /^prod[1-4]$/.test(destino)) {
      for (const sufixo of ['quant', 'valor', 'total']) {
        const key = `${destino}_${sufixo}`
        if (chavesIncluidas.has(key)) continue
        const nomeProduto = descricao || destino.toUpperCase()
        colunas.push({
          key,
          label: `${nomeProduto} ${sufixo === 'quant' ? 'Quant' : sufixo === 'valor' ? 'Valor' : 'Total'}`,
          largura: sufixo === 'total' ? 'valor12' : 'valor9',
        })
        chavesIncluidas.add(key)
      }
    }
  }

  // Total é calculado pelo Financeiro Geral e permanece como coluna estrutural fixa.
  colunas.push({ key: 'total', label: 'Total', largura: 'valor12' })
  return colunas
}

function parametrosFinanceiroGeral(req) {
  const empresaId = Number(req.query.empresaId || 1)
  const dataInicial = String(req.query.dataInicial || '').trim()
  const dataFinal = String(req.query.dataFinal || '').trim()
  if (!Number.isInteger(empresaId) || empresaId <= 0) throw new Error('Empresa inválida.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicial) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFinal)) throw new Error('Informe um período válido.')
  if (dataInicial > dataFinal) throw new Error('A data inicial não pode ser posterior à data final.')
  return {
    empresaId, dataInicial, dataFinal,
    descricao: String(req.query.descricao || '').trim(),
    tipo: String(req.query.tipo || '').trim(),
    origem: String(req.query.origem || '').trim(),
    conta: String(req.query.conta || '').trim(),
    valorExato: String(req.query.valorExato ?? '').trim(),
    valorMinimo: String(req.query.valorMinimo ?? '').trim(),
    valorMaximo: String(req.query.valorMaximo ?? '').trim(),
  }
}

function filtroFinanceiroGeral(f) {
  const where = ["empresa_id = ?", "data_lancamento BETWEEN ? AND ?", "status = 'ATIVO'"]
  const params = [f.empresaId, f.dataInicial, f.dataFinal]
  if (f.descricao) {
    where.push('(descricao_original LIKE ? OR descricao_normalizada LIKE ?)')
    params.push(`%${f.descricao}%`, `%${f.descricao}%`)
  }
  if (f.tipo) { where.push('tipo_lancamento = ?'); params.push(f.tipo) }
  if (f.origem) { where.push('origem = ?'); params.push(f.origem) }

  const colunasPermitidas = FINANCEIRO_GERAL_COLUNAS.map(([campo]) => campo)
  const colunasValor = f.conta && colunasPermitidas.includes(f.conta) ? [f.conta] : colunasPermitidas
  const numeroFiltro = (valor, nome) => {
    if (valor === '') return null
    const numero = Number(String(valor).replace(',', '.'))
    if (!Number.isFinite(numero)) throw new Error(`${nome} inválido.`)
    return numero
  }
  const exato = numeroFiltro(f.valorExato, 'Valor exato')
  const minimo = numeroFiltro(f.valorMinimo, 'Valor mínimo')
  const maximo = numeroFiltro(f.valorMaximo, 'Valor máximo')
  if (minimo !== null && maximo !== null && minimo > maximo) throw new Error('O valor mínimo não pode ser maior que o valor máximo.')

  if (exato !== null || minimo !== null || maximo !== null) {
    const condicoesPorColuna = []
    for (const campo of colunasValor) {
      const condicoes = []
      if (exato !== null) { condicoes.push(`ABS(${campo} - ?) < 0.005`); params.push(exato) }
      if (minimo !== null) { condicoes.push(`${campo} >= ?`); params.push(minimo) }
      if (maximo !== null) { condicoes.push(`${campo} <= ?`); params.push(maximo) }
      condicoesPorColuna.push(`(${condicoes.join(' AND ')})`)
    }
    where.push(`(${condicoesPorColuna.join(' OR ')})`)
  } else if (f.conta && colunasPermitidas.includes(f.conta)) {
    where.push(`${f.conta} <> 0`)
  }

  return { sql: where.join(' AND '), params }
}

async function colunasFinanceiroSolicitadas(req, empresaId) {
  const disponiveis = await colunasFinanceiroGeralAtivas(empresaId)
  const permitidas = new Set(disponiveis.map((item) => item.key))
  const recebidas = String(req.query.colunas || '').split(',').map((v) => v.trim()).filter((v) => permitidas.has(v))
  return recebidas.length ? disponiveis.filter((item) => recebidas.includes(item.key)) : disponiveis
}

async function consultarFinanceiroGeral(f, limite = null, offset = 0) {
  const filtro = filtroFinanceiroGeral(f)
  const numericas = FINANCEIRO_GERAL_COLUNAS.map(([c]) => c)
  let sql = `SELECT id, data_lancamento, descricao_original, descricao_normalizada, tipo_lancamento, tipo_lancamento_id,
                    CASE WHEN UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE 'SALDO%' THEN '' ELSE origem END AS origem,
                    ${numericas.join(', ')}
             FROM financeiro_geral WHERE ${filtro.sql}
             ORDER BY data_lancamento ASC,
                      CASE
                        WHEN UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE 'SALDO INICIAL DO DIA%' OR UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE 'SALDO ANTERIOR%' THEN 0
                        WHEN UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE 'SALDO DO DIA%' THEN 2
                        ELSE 1
                      END ASC,
                      CASE
                        /* SPOT, inclusive as linhas auxiliares que também movimentam Cartão. */
                        WHEN UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE '%CREDITO VENDAS CARTAO%' THEN 1
                        WHEN tipo_lancamento = 'TAXA_CARTAO'
                             OR UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE '%DESCONTO TAXAS CARTAO%' THEN 1
                        WHEN UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE '%PIX RECEBIDO MAQUININHA%' THEN 1
                        WHEN conta01 <> 0 THEN 1
                        /* Exceção: Separação de Vendas pertence ao bloco de produtos,
                           independentemente das contas que movimenta. */
                        WHEN tipo_lancamento = 'SEPARACAO_VENDAS'
                          OR UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE 'SEPARA%VENDAS%' THEN 9
                        /* Demais contas na ordem visual solicitada. */
                        WHEN conta02 <> 0 THEN 2
                        WHEN conta03 <> 0 THEN 3
                        WHEN conta11 <> 0 THEN 4
                        WHEN conta12 <> 0 THEN 5
                        /* Compras, vendas, ajustes e resultado líquido permanecem no bloco de produtos. */
                        WHEN tipo_lancamento IN ('COMPRA', 'VENDA', 'AJUSTE', 'RESULTADO')
                          OR prod1_quant <> 0 OR prod1_valor <> 0 OR prod1_total <> 0
                          OR prod2_quant <> 0 OR prod2_valor <> 0 OR prod2_total <> 0
                          OR prod3_quant <> 0 OR prod3_valor <> 0 OR prod3_total <> 0
                          OR prod4_quant <> 0 OR prod4_valor <> 0 OR prod4_total <> 0 THEN 9
                        WHEN conta13 <> 0 THEN 6
                        WHEN conta21 <> 0 THEN 7
                        WHEN conta04 <> 0 OR conta05 <> 0 OR conta06 <> 0 OR conta07 <> 0 OR conta08 <> 0
                          OR conta09 <> 0 OR conta10 <> 0 OR conta14 <> 0 OR conta15 <> 0 OR conta16 <> 0
                          OR conta17 <> 0 OR conta18 <> 0 OR conta19 <> 0 OR conta20 <> 0 OR conta22 <> 0
                          OR conta23 <> 0 OR conta24 <> 0 OR conta25 <> 0 OR conta26 <> 0 OR conta27 <> 0
                          OR conta28 <> 0 OR conta29 <> 0 OR conta30 <> 0 THEN 8
                        ELSE 99
                      END ASC,
                      CASE
                        /* Ordem interna do SPOT. */
                        WHEN UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE '%CREDITO VENDAS CARTAO%' THEN 1
                        WHEN tipo_lancamento = 'TAXA_CARTAO'
                             OR UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE '%DESCONTO TAXAS CARTAO%' THEN 2
                        WHEN UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE '%PIX RECEBIDO MAQUININHA%'
                             AND UPPER(COALESCE(descricao_normalizada, descricao_original, '')) NOT LIKE '%TARIFA%' THEN 3
                        WHEN UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE '%TARIFA PIX RECEBIDO MAQUININHA%' THEN 4
                        /* No ITAÚ, Pix e depósitos Vendas vem antes dos demais. */
                        WHEN conta02 <> 0 AND UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE '%PIX E DEPOSIT%VENDAS%' THEN 1
                        /* Única exceção à ordem das colunas:
                           Separação fica depois do resultado e imediatamente antes
                           de Ajuste de saldo e valor estoque diário. */
                        WHEN tipo_lancamento = 'COMPRA' THEN 1
                        WHEN tipo_lancamento = 'VENDA' THEN 2
                        WHEN tipo_lancamento = 'RESULTADO' THEN 3
                        WHEN tipo_lancamento = 'SEPARACAO_VENDAS'
                          OR UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE 'SEPARA%VENDAS%' THEN 4
                        WHEN tipo_lancamento = 'AJUSTE' THEN 5
                        ELSE 10
                      END ASC,
                      CASE WHEN tipo_lancamento = 'TAXA_CARTAO' THEN COALESCE(registro_origem_id, id) ELSE COALESCE(registro_origem_id, id) END ASC,
                      CASE WHEN tipo_lancamento IN ('TAXA_CARTAO', 'SEPARACAO_VENDAS') THEN 1 ELSE 0 END ASC,
                      id ASC`
  const params = [...filtro.params]
  if (limite !== null) { sql += ' LIMIT ? OFFSET ?'; params.push(limite, offset) }
  const [lancamentos] = await db.query(sql, params)
  const somas = numericas.map((c) => `COALESCE(SUM(${c}),0) AS ${c}`).join(', ')
  const [[totais]] = await db.query(`SELECT COUNT(*) AS total_registros, ${somas} FROM financeiro_geral WHERE ${filtro.sql}`, filtro.params)

  // O rodapé da planilha deve refletir o último saldo do período, não a soma dos saldos.
  // A busca considera o período completo, independentemente da página atualmente exibida.
  const filtroPeriodo = filtroFinanceiroGeral({ ...f, descricao: '', tipo: '', origem: '', conta: '', valorExato: '', valorMinimo: '', valorMaximo: '' })
  const [saldosPeriodo] = await db.query(
    `SELECT ${numericas.join(', ')}
       FROM financeiro_geral
      WHERE ${filtroPeriodo.sql}
        AND UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE 'SALDO%'
      ORDER BY data_lancamento DESC,
               CASE
                 WHEN UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE 'SALDO DO DIA%' THEN 0
                 WHEN UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE 'SALDO INICIAL DO DIA%' THEN 1
                 ELSE 2
               END ASC,
               id DESC
      LIMIT 1`,
    filtroPeriodo.params
  )
  const ultimoSaldo = saldosPeriodo[0] || Object.fromEntries(numericas.map((c) => [c, 0]))
  return { lancamentos, totais, ultimoSaldo }
}




async function montarResumoPeriodoFinanceiroGeral(empresaId, dataInicial, dataFinal) {
  if (!Number.isInteger(empresaId) || empresaId <= 0) throw new Error('Empresa inválida.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicial) || !/^\d{4}-\d{2}-\d{2}$/.test(dataFinal)) throw new Error('Período inválido.')
  if (dataInicial > dataFinal) throw new Error('A data inicial não pode ser posterior à data final.')

  const [[saldoAnterior]] = await db.query(
    `SELECT total FROM financeiro_geral
      WHERE empresa_id = ? AND data_lancamento < ? AND status = 'ATIVO'
        AND UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE 'SALDO DO DIA%'
      ORDER BY data_lancamento DESC, id DESC LIMIT 1`,
    [empresaId, dataInicial]
  )

  const [[saldoFinal]] = await db.query(
    `SELECT total, DATE_FORMAT(data_lancamento, '%Y-%m-%d') AS data_lancamento
       FROM financeiro_geral
      WHERE empresa_id = ? AND data_lancamento BETWEEN ? AND ? AND status = 'ATIVO'
        AND UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE 'SALDO DO DIA%'
      ORDER BY data_lancamento DESC, id DESC LIMIT 1`,
    [empresaId, dataInicial, dataFinal]
  )

  const [linhas] = await db.query(
    `SELECT id, DATE_FORMAT(data_lancamento, '%Y-%m-%d') AS data_lancamento,
            descricao_original, descricao_normalizada, tipo_lancamento, origem,
            conta01, conta02, conta03, conta04, conta05, conta06, conta07, conta08, conta09, conta10,
            conta11, conta12, conta13, conta14, conta15, conta16, conta17, conta18, conta19, conta20,
            conta21, conta22, conta23, conta24, conta25, conta26, conta27, conta28, conta29, conta30,
            prod1_total, prod2_total, prod3_total, prod4_total, total
       FROM financeiro_geral
      WHERE empresa_id = ? AND data_lancamento BETWEEN ? AND ? AND status = 'ATIVO'
      ORDER BY data_lancamento ASC, id ASC`,
    [empresaId, dataInicial, dataFinal]
  )

  const n = (v) => Number(v || 0)
  const desc = (r) => String(r.descricao_normalizada || r.descricao_original || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim()
  const somaProdutos = (r) => n(r.prod1_total) + n(r.prod2_total) + n(r.prod3_total) + n(r.prod4_total)
  const contas = Array.from({ length: 30 }, (_, i) => `conta${String(i + 1).padStart(2, '0')}`)
  const somaContas = (r) => contas.reduce((a, c) => a + n(r[c]), 0)
  const centavosAbs = (v) => Math.round(Math.abs(n(v)) * 100)
  const valoresConta = (r) => contas.map((c) => n(r[c])).filter((v) => Math.abs(v) >= 0.005)
  const temTransferenciaNaMesmaLinha = (r) => {
    const vals = valoresConta(r)
    const positivos = vals.filter((v) => v > 0).reduce((a, v) => a + v, 0)
    const negativos = vals.filter((v) => v < 0).reduce((a, v) => a + Math.abs(v), 0)
    return positivos >= 0.005 && negativos >= 0.005 && Math.abs(positivos - negativos) <= 0.01
  }

  const resultadoLiquido = linhas.filter((r) => r.tipo_lancamento === 'RESULTADO' || desc(r).includes('RESULTADO LIQUIDO')).reduce((a, r) => a + somaProdutos(r), 0)
  const ajusteEstoque = linhas.filter((r) => r.tipo_lancamento === 'AJUSTE' || desc(r).includes('AJUSTE DE SALDO E VALOR ESTOQUE')).reduce((a, r) => a + somaProdutos(r), 0)
  const taxasCartao = linhas.filter((r) => r.tipo_lancamento === 'TAXA_CARTAO' || desc(r).includes('DESCONTO TAXAS CARTAO')).reduce((a, r) => a + n(r.conta12), 0)
  const tarifaPix = linhas.filter((r) => desc(r).includes('TARIFA PIX RECEBIDO MAQUININHA') || desc(r).includes('TARIFA PIX RECEBIDO MAQUINHA') || desc(r).includes('TARIFA PIX RECEBIMENTO')).reduce((a, r) => a + somaContas(r), 0)

  // As transferências são identificadas dentro de cada dia. Um valor positivo
  // pode anular apenas uma ocorrência negativa de mesmo valor absoluto naquele dia.
  const idsNegativosComContrapartida = new Set()
  const porData = new Map()
  for (const r of linhas) {
    const data = String(r.data_lancamento || '')
    if (!porData.has(data)) porData.set(data, [])
    porData.get(data).push(r)
  }
  for (const [, linhasDia] of porData) {
    const positivosDisponiveis = new Map()
    for (const r of linhasDia) {
      const valor = n(r.total)
      if (valor <= 0.004) continue
      const chave = centavosAbs(valor)
      positivosDisponiveis.set(chave, (positivosDisponiveis.get(chave) || 0) + 1)
    }
    for (const r of linhasDia) {
      const valor = n(r.total)
      if (valor >= -0.004) continue
      const chave = centavosAbs(valor)
      const disponiveis = positivosDisponiveis.get(chave) || 0
      if (disponiveis > 0) {
        idsNegativosComContrapartida.add(r.id)
        positivosDisponiveis.set(chave, disponiveis - 1)
      }
    }
  }

  const despesas = linhas.filter((r) => {
    const d = desc(r)
    if (n(r.total) >= -0.004) return false
    if (d.startsWith('SALDO')) return false
    if (r.tipo_lancamento === 'RESULTADO' || r.tipo_lancamento === 'AJUSTE' || r.tipo_lancamento === 'COMPRA' || r.tipo_lancamento === 'VENDA' || r.tipo_lancamento === 'SEPARACAO_VENDAS' || r.tipo_lancamento === 'TAXA_CARTAO') return false
    if (d.includes('RESULTADO LIQUIDO') || d.includes('AJUSTE DE SALDO E VALOR ESTOQUE') || d.includes('DESCONTO TAXAS CARTAO') || d.includes('TARIFA PIX RECEBIDO MAQUININHA') || d.includes('TARIFA PIX RECEBIDO MAQUINHA') || d.includes('TARIFA PIX RECEBIMENTO')) return false
    if (temTransferenciaNaMesmaLinha(r) || idsNegativosComContrapartida.has(r.id)) return false
    return true
  }).map((r) => ({
    id: r.id,
    data: String(r.data_lancamento || '').slice(0, 10),
    descricao: r.descricao_original || r.descricao_normalizada || 'Despesa',
    valor: n(r.total),
  }))

  const saldoAnteriorTotal = n(saldoAnterior?.total)
  const totalDespesas = despesas.reduce((a, r) => a + n(r.valor), 0)
  const resultadoLiquidoPeriodo = resultadoLiquido + ajusteEstoque + taxasCartao + tarifaPix
  const totalComposicao = saldoAnteriorTotal + resultadoLiquidoPeriodo + totalDespesas
  const saldoFinalTotal = saldoFinal ? n(saldoFinal.total) : totalComposicao

  return {
    ok: true,
    dataInicial,
    dataFinal,
    saldoAnterior: saldoAnteriorTotal,
    resultadoLiquido,
    ajusteEstoque,
    taxasCartao,
    tarifaPix,
    resultadoLiquidoPeriodo,
    despesas,
    totalDespesas,
    totalComposicao,
    saldoFinal: saldoFinalTotal,
    dataSaldoFinal: saldoFinal?.data_lancamento || null,
  }
}

app.get('/api/financeiro-geral/resumo-periodo', async (req, res) => {
  try {
    const empresaId = Number(req.query.empresaId || 1)
    const dataInicial = String(req.query.dataInicial || '').trim()
    const dataFinal = String(req.query.dataFinal || '').trim()
    const dados = await montarResumoPeriodoFinanceiroGeral(empresaId, dataInicial, dataFinal)
    res.json(dados)
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message || 'Erro ao montar o relatório do período.' })
  }
})

app.get('/api/financeiro-geral/resumo-periodo/excel', async (req, res) => {
  try {
    const empresaId = Number(req.query.empresaId || 1)
    const dataInicial = String(req.query.dataInicial || '').trim()
    const dataFinal = String(req.query.dataFinal || '').trim()
    const dados = await montarResumoPeriodoFinanceiroGeral(empresaId, dataInicial, dataFinal)

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Resumo do período')
    ws.columns = [
      { header: 'Data', key: 'data', width: 14 },
      { header: 'Descrição', key: 'descricao', width: 52 },
      { header: 'Valor', key: 'valor', width: 18 },
    ]
    ws.mergeCells('A1:C1')
    ws.getCell('A1').value = 'Relatório Financeiro do Período'
    ws.getCell('A1').font = { bold: true, size: 16 }
    ws.getCell('A1').alignment = { horizontal: 'center' }
    ws.mergeCells('A2:C2')
    ws.getCell('A2').value = `${dataInicial.split('-').reverse().join('/')} a ${dataFinal.split('-').reverse().join('/')}`
    ws.getCell('A2').alignment = { horizontal: 'center' }

    const moedaFmt = 'R$ #,##0.00;[Red]-R$ #,##0.00'
    const adicionarResumo = (linha, descricao, valor) => {
      ws.getCell(`B${linha}`).value = descricao
      ws.getCell(`C${linha}`).value = Number(valor || 0)
      ws.getCell(`C${linha}`).numFmt = moedaFmt
    }
    adicionarResumo(4, 'Saldo total anterior ao período', dados.saldoAnterior)
    adicionarResumo(6, 'Resultado Líquido dos Produtos', dados.resultadoLiquido)
    adicionarResumo(7, 'Ajuste de Saldo Estoque', dados.ajusteEstoque)
    adicionarResumo(8, 'Despesa Taxas Cartão', dados.taxasCartao)
    adicionarResumo(9, 'Tarifa Pix Recebido Maquininha', dados.tarifaPix)
    adicionarResumo(11, 'Resultado Líquido do período', dados.resultadoLiquidoPeriodo)

    ws.getCell('A13').value = 'Data'
    ws.getCell('B13').value = 'Despesas pagas no período'
    ws.getCell('C13').value = 'Valor'
    for (const c of ['A13', 'B13', 'C13']) ws.getCell(c).font = { bold: true }
    let linha = 14
    for (const despesa of dados.despesas) {
      ws.getCell(`A${linha}`).value = despesa.data ? despesa.data.split('-').reverse().join('/') : ''
      ws.getCell(`B${linha}`).value = despesa.descricao
      ws.getCell(`C${linha}`).value = Number(despesa.valor || 0)
      ws.getCell(`C${linha}`).numFmt = moedaFmt
      linha += 1
    }
    linha += 1
    adicionarResumo(linha, 'Total das despesas do período', dados.totalDespesas)
    ws.getCell(`B${linha}`).font = { bold: true }
    ws.getCell(`C${linha}`).font = { bold: true }
    linha += 2
    adicionarResumo(linha, 'Saldo Final do período', dados.saldoFinal)
    ws.getCell(`B${linha}`).font = { bold: true }
    ws.getCell(`C${linha}`).font = { bold: true }

    ws.eachRow((row) => {
      row.alignment = { vertical: 'middle' }
    })
    ws.views = [{ showGridLines: false }]

    const buffer = await wb.xlsx.writeBuffer()
    const nome = `resumo_financeiro_${dataInicial}_${dataFinal}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`)
    res.send(Buffer.from(buffer))
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message || 'Erro ao gerar Excel do período.' })
  }
})

app.get('/api/financeiro-geral/detalhe-dia', async (req, res) => {
  try {
    const empresaId = Number(req.query.empresaId || 1)
    const data = String(req.query.data || '').trim()
    if (!Number.isInteger(empresaId) || empresaId <= 0) throw new Error('Empresa inválida.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error('Data inválida.')

    const [[saldoAnterior]] = await db.query(
      `SELECT total FROM financeiro_geral
        WHERE empresa_id = ? AND data_lancamento < ? AND status = 'ATIVO'
          AND UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE 'SALDO DO DIA%'
        ORDER BY data_lancamento DESC, id DESC LIMIT 1`,
      [empresaId, data]
    )

    // O total exibido no frame deve ser exatamente o mesmo da linha "Saldo do dia"
    // clicada no Financeiro Geral. A composição abaixo serve para explicar o dia,
    // mas não substitui o valor oficial já consolidado na linha de saldo.
    const [[saldoDoDia]] = await db.query(
      `SELECT total FROM financeiro_geral
        WHERE empresa_id = ? AND data_lancamento = ? AND status = 'ATIVO'
          AND UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE 'SALDO DO DIA%'
        ORDER BY id DESC LIMIT 1`,
      [empresaId, data]
    )

    const [linhas] = await db.query(
      `SELECT id, descricao_original, descricao_normalizada, tipo_lancamento, origem,
              conta01, conta02, conta03, conta04, conta05, conta06, conta07, conta08, conta09, conta10,
              conta11, conta12, conta13, conta14, conta15, conta16, conta17, conta18, conta19, conta20,
              conta21, conta22, conta23, conta24, conta25, conta26, conta27, conta28, conta29, conta30,
              prod1_total, prod2_total, prod3_total, prod4_total, total
         FROM financeiro_geral
        WHERE empresa_id = ? AND data_lancamento = ? AND status = 'ATIVO'
        ORDER BY id ASC`,
      [empresaId, data]
    )

    const n = (v) => Number(v || 0)
    const desc = (r) => String(r.descricao_normalizada || r.descricao_original || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim()
    const somaProdutos = (r) => n(r.prod1_total) + n(r.prod2_total) + n(r.prod3_total) + n(r.prod4_total)
    const somaContas = (r) => Array.from({ length: 30 }, (_, i) => `conta${String(i + 1).padStart(2, '0')}`).reduce((a, c) => a + n(r[c]), 0)

    const resultadoLiquido = linhas.filter((r) => r.tipo_lancamento === 'RESULTADO' || desc(r).includes('RESULTADO LIQUIDO')).reduce((a, r) => a + somaProdutos(r), 0)
    const ajusteEstoque = linhas.filter((r) => r.tipo_lancamento === 'AJUSTE' || desc(r).includes('AJUSTE DE SALDO E VALOR ESTOQUE')).reduce((a, r) => a + somaProdutos(r), 0)
    const taxasCartao = linhas.filter((r) => r.tipo_lancamento === 'TAXA_CARTAO' || desc(r).includes('DESCONTO TAXAS CARTAO')).reduce((a, r) => a + n(r.conta12), 0)
    const tarifaPix = linhas.filter((r) => desc(r).includes('TARIFA PIX RECEBIDO MAQUININHA') || desc(r).includes('TARIFA PIX RECEBIDO MAQUINHA') || desc(r).includes('TARIFA PIX RECEBIMENTO')).reduce((a, r) => a + somaContas(r), 0)

    const contas = Array.from({ length: 30 }, (_, i) => `conta${String(i + 1).padStart(2, '0')}`)
    const centavosAbs = (v) => Math.round(Math.abs(n(v)) * 100)
    const valoresConta = (r) => contas.map((c) => n(r[c])).filter((v) => Math.abs(v) >= 0.005)
    const temTransferenciaNaMesmaLinha = (r) => {
      const vals = valoresConta(r)
      const positivos = vals.filter((v) => v > 0).reduce((a, v) => a + v, 0)
      const negativos = vals.filter((v) => v < 0).reduce((a, v) => a + Math.abs(v), 0)
      return positivos >= 0.005 && negativos >= 0.005 && Math.abs(positivos - negativos) <= 0.01
    }

    // Regra solicitada para a coluna Total: um valor negativo que possua uma
    // contrapartida positiva de mesmo valor no mesmo dia representa transferência
    // e não deve aparecer na relação de despesas. A comparação é feita em centavos
    // e por quantidade de ocorrências, evitando que um único positivo elimine várias
    // despesas negativas iguais.
    const positivosDisponiveis = new Map()
    for (const r of linhas) {
      const valor = n(r.total)
      if (valor <= 0.004) continue
      const chave = centavosAbs(valor)
      positivosDisponiveis.set(chave, (positivosDisponiveis.get(chave) || 0) + 1)
    }
    const idsNegativosComContrapartida = new Set()
    for (const r of linhas) {
      const valor = n(r.total)
      if (valor >= -0.004) continue
      const chave = centavosAbs(valor)
      const disponiveis = positivosDisponiveis.get(chave) || 0
      if (disponiveis > 0) {
        idsNegativosComContrapartida.add(r.id)
        positivosDisponiveis.set(chave, disponiveis - 1)
      }
    }
    const ehMovimentoEntreContas = (r) => temTransferenciaNaMesmaLinha(r) || idsNegativosComContrapartida.has(r.id)

    const despesas = linhas.filter((r) => {
      const d = desc(r)
      if (n(r.total) >= -0.004) return false
      if (d.startsWith('SALDO')) return false
      if (r.tipo_lancamento === 'RESULTADO' || r.tipo_lancamento === 'AJUSTE' || r.tipo_lancamento === 'COMPRA' || r.tipo_lancamento === 'VENDA' || r.tipo_lancamento === 'SEPARACAO_VENDAS' || r.tipo_lancamento === 'TAXA_CARTAO') return false
      if (d.includes('RESULTADO LIQUIDO') || d.includes('AJUSTE DE SALDO E VALOR ESTOQUE') || d.includes('DESCONTO TAXAS CARTAO') || d.includes('TARIFA PIX RECEBIDO MAQUININHA') || d.includes('TARIFA PIX RECEBIDO MAQUINHA') || d.includes('TARIFA PIX RECEBIMENTO')) return false
      // Transferências entre contas não representam despesa real do dia. Isso inclui:
      // 1) lançamentos que movimentam o mesmo valor entre duas colunas na própria linha;
      // 2) pares de lançamentos do mesmo dia com o mesmo valor absoluto, um negativo e outro positivo.
      // Compras de produtos continuam excluídas acima pelo tipo COMPRA.
      if (ehMovimentoEntreContas(r)) return false
      return true
    }).map((r) => ({ id: r.id, descricao: r.descricao_original || r.descricao_normalizada || 'Despesa', valor: n(r.total), origem: r.origem || '' }))

    const saldoAnteriorTotal = n(saldoAnterior?.total)
    const totalComposicao = saldoAnteriorTotal + resultadoLiquido + ajusteEstoque + taxasCartao + tarifaPix + despesas.reduce((a, r) => a + n(r.valor), 0)
    const saldoDoDiaTotal = saldoDoDia ? n(saldoDoDia.total) : totalComposicao
    // totalCalculado é mantido por compatibilidade com o frontend, porém agora
    // corresponde ao Total da linha Saldo do dia clicada.
    const totalCalculado = saldoDoDiaTotal
    res.json({ ok: true, data, saldoAnterior: saldoAnteriorTotal, resultadoLiquido, ajusteEstoque, taxasCartao, tarifaPix, despesas, totalCalculado, totalComposicao, saldoDoDia: saldoDoDiaTotal })
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message || 'Erro ao montar os dados do dia.' })
  }
})

app.get('/api/financeiro-geral/lancamentos', async (req, res) => {
  try {
    const f = parametrosFinanceiroGeral(req)
    const pagina = Math.max(1, Number(req.query.pagina || 1))
    const porPagina = Math.min(500, Math.max(10, Number(req.query.porPagina || 50)))
    const numericas = FINANCEIRO_GERAL_COLUNAS.map(([campo]) => campo)

    // A linha inicial ocupa uma posição real da primeira página. Nas páginas
    // seguintes, o offset é compensado para não repetir nem pular lançamentos.
    const limiteConsulta = pagina === 1 ? Math.max(1, porPagina - 1) : porPagina
    const offsetConsulta = pagina === 1 ? 0 : Math.max(0, (pagina - 1) * porPagina - 1)
    const resultado = await consultarFinanceiroGeral(f, limiteConsulta, offsetConsulta)

    const [saldosAnteriores] = await db.query(
      `SELECT id, DATE_FORMAT(data_lancamento, '%Y-%m-%d') AS data_lancamento,
              'Saldo anterior' AS descricao_original,
              'SALDO ANTERIOR' AS descricao_normalizada,
              'SALDO' AS tipo_lancamento, tipo_lancamento_id, '' AS origem,
              ${numericas.join(', ')}
         FROM financeiro_geral
        WHERE empresa_id = ?
          AND data_lancamento < ?
          AND status = 'ATIVO'
          AND UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE 'SALDO DO DIA%'
        ORDER BY data_lancamento DESC, id DESC
        LIMIT 1`,
      [f.empresaId, f.dataInicial]
    )

    const saldoInicial = saldosAnteriores[0] || null
    const lancamentos = pagina === 1 && saldoInicial
      ? [saldoInicial, ...resultado.lancamentos]
      : resultado.lancamentos
    const total = Number(resultado.totais.total_registros || 0) + (saldoInicial ? 1 : 0)

    const colunas = await colunasFinanceiroGeralAtivas(f.empresaId)
    res.json({
      ok: true,
      lancamentos,
      totais: resultado.totais,
      ultimoSaldo: resultado.ultimoSaldo,
      colunas,
      paginacao: { pagina, porPagina, total },
    })
  } catch (error) { res.status(400).json({ ok: false, erro: error.message || 'Erro ao consultar o Financeiro Geral.' }) }
})


function proximaDataLocal(dataIso) {
  const data = new Date(`${dataIso}T12:00:00Z`)
  data.setUTCDate(data.getUTCDate() + 1)
  return data.toISOString().slice(0, 10)
}

app.put('/api/financeiro-geral/lancamentos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) throw new Error('Lançamento inválido.')
    const body = req.body || {}
    const [linhasAntes] = await db.query(
      `SELECT empresa_id, DATE_FORMAT(data_lancamento, '%Y-%m-%d') AS data_lancamento, tipo_lancamento, descricao_normalizada
       FROM financeiro_geral WHERE id = ? AND status = 'ATIVO' LIMIT 1`, [id]
    )
    if (!linhasAntes[0]) return res.status(404).json({ ok: false, erro: 'Lançamento não encontrado.' })
    const linhaAntes = linhasAntes[0]
    const descricaoAnteriorPrevia = String(linhaAntes.descricao_normalizada || '').toUpperCase()
    const ehSaldoAnteriorProtegido = String(linhaAntes.tipo_lancamento || '').toUpperCase() === 'SALDO' && (descricaoAnteriorPrevia.startsWith('SALDO INICIAL DO DIA') || descricaoAnteriorPrevia.startsWith('SALDO ANTERIOR'))
    if (ehSaldoAnteriorProtegido && !(await validarSenhaAdministrativa(body.senhaAdministrativa))) {
      return res.status(401).json({ ok: false, erro: 'Senha administrativa inválida. O Saldo anterior não foi alterado.' })
    }
    const dataTravaConsolidacao = ehSaldoAnteriorProtegido
      ? await obterDataTravaConsolidacao(Number(linhaAntes.empresa_id || 1))
      : await validarDataDesbloqueada(Number(linhaAntes.empresa_id || 1), String(linhaAntes.data_lancamento).slice(0, 10), 'alterar')
    const dataLancamento = String(body.data_lancamento || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataLancamento)) throw new Error('Data inválida.')
    if (!ehSaldoAnteriorProtegido && dataTravaConsolidacao && dataLancamento <= dataTravaConsolidacao) {
      throw new Error(`Período consolidado e bloqueado até ${dataTravaConsolidacao.split('-').reverse().join('/')}. Não é permitido alterar o lançamento para essa data ou antes dela.`)
    }
    const ehSaldoEditado = String(linhaAntes.tipo_lancamento || '').toUpperCase() === 'SALDO'
    const descricaoAnterior = String(linhaAntes.descricao_normalizada || '').toUpperCase()
    const ehSaldoInicialEditado = ehSaldoEditado && (descricaoAnterior.startsWith('SALDO INICIAL DO DIA') || descricaoAnterior.startsWith('SALDO ANTERIOR'))
    // Linhas de saldo mantêm data, descrição e origem do sistema; somente os valores são editáveis.
    const descricao = ehSaldoEditado
      ? (ehSaldoInicialEditado ? 'Saldo anterior' : 'Saldo do dia')
      : String(body.descricao_original || '').trim().slice(0, 500)
    const origem = ehSaldoEditado ? 'SISTEMA' : String(body.origem || 'SISTEMA').trim().slice(0, 30)
    const dataEfetiva = ehSaldoEditado ? String(linhaAntes.data_lancamento).slice(0, 10) : dataLancamento
    const camposNumericos = FINANCEIRO_GERAL_COLUNAS.map(([c]) => c).filter((c) => c !== 'total')
    const valores = {}
    for (const campo of camposNumericos) {
      const valor = Number(body[campo] || 0)
      if (!Number.isFinite(valor)) throw new Error(`Valor inválido em ${campo}.`)
      valores[campo] = valor
    }
    const camposTotalizaveis = camposNumericos.filter((c) => c.startsWith('conta') || c.endsWith('_total'))
    const arred2Local = (valor) => Math.round((Number(valor || 0) + Number.EPSILON) * 100) / 100
    const arred6Local = (valor) => Math.round((Number(valor || 0) + Number.EPSILON) * 1000000) / 1000000
    const tipoLancamentoEditado = String(linhaAntes.tipo_lancamento || '').toUpperCase()

    // Em compras, o total de cada produto nunca depende do valor enviado pela tela:
    // é sempre quantidade x valor unitário, com seis casas decimais. O recálculo em
    // cascata usa esse total para atualizar preço médio, quantidade e saldo total.
    if (tipoLancamentoEditado === 'COMPRA') {
      for (const produto of ['prod1', 'prod2', 'prod3', 'prod4']) {
        const campoQuantidade = `${produto}_quant`
        const campoValor = `${produto}_valor`
        const campoTotal = `${produto}_total`
        valores[campoTotal] = arred6Local(valores[campoQuantidade] * valores[campoValor])
      }
    }

    const ehSeparacaoVendasEditada = tipoLancamentoEditado === 'SEPARACAO_VENDAS'
    if (ehSeparacaoVendasEditada) {
      // Vendas fica negativo para zerar a coluna; Cartão é informado pelo usuário
      // e Caixa recebe automaticamente a diferença do total separado.
      valores.conta13 = -Math.abs(arred2Local(valores.conta13))
      valores.conta12 = arred2Local(valores.conta12)
      valores.conta11 = arred2Local(Math.abs(valores.conta13) - valores.conta12)
    }
    const total = arred2Local(camposTotalizaveis.reduce((soma, campo) => soma + arred2Local(valores[campo]), 0))
    const sets = ['data_lancamento = ?', 'descricao_original = ?', 'descricao_normalizada = ?', 'origem = ?']
    const params = [dataEfetiva, descricao || null, descricao ? descricao.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase() : null, origem || 'SISTEMA']
    for (const campo of camposNumericos) { sets.push(`${campo} = ?`); params.push(valores[campo]) }
    sets.push('total = ?', 'usuario_id = ?', 'atualizado_em = NOW()')
    params.push(total, req.user?.id || null, id)
    const [resultado] = await db.query(`UPDATE financeiro_geral SET ${sets.join(', ')} WHERE id = ? AND status = 'ATIVO'`, params)
    if (!resultado.affectedRows) return res.status(404).json({ ok: false, erro: 'Lançamento não encontrado.' })
    const dataRecalculoBase = ehSaldoInicialEditado ? dataEfetiva : (ehSaldoEditado ? proximaDataLocal(dataEfetiva) : dataEfetiva)
    const dataRecalculo = dataTravaConsolidacao && dataRecalculoBase <= dataTravaConsolidacao
      ? proximaDataLocal(dataTravaConsolidacao)
      : dataRecalculoBase
    const recalculo = await recalcularFinanceiroGeralAPartirDe({
      empresaId: Number(linhaAntes.empresa_id), dataInicial: dataRecalculo, usuarioId: req.user?.id || null,
    })
    res.json({ ok: true, id, total, recalculo })
  } catch (error) { res.status(400).json({ ok: false, erro: error.message || 'Erro ao atualizar lançamento.' }) }
})


app.post('/api/financeiro-geral/lancamentos', async (req, res) => {
  try {
    const body = req.body || {}
    const empresaId = Number(body.empresa_id || 1)
    if (!Number.isInteger(empresaId) || empresaId <= 0) throw new Error('Empresa inválida.')
    const dataLancamento = String(body.data_lancamento || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataLancamento)) throw new Error('Data inválida.')
    await validarDataDesbloqueada(empresaId, dataLancamento, 'incluir')
    const descricao = String(body.descricao_original || '').trim().slice(0, 500)
    if (!descricao) throw new Error('Descrição é obrigatória.')
    const origem = String(body.origem || 'MANUAL').trim().slice(0, 30) || 'MANUAL'
    const camposNumericos = FINANCEIRO_GERAL_COLUNAS.map(([campo]) => campo).filter((campo) => campo !== 'total')
    const valores = {}
    for (const campo of camposNumericos) {
      const valor = Number(body[campo] || 0)
      if (!Number.isFinite(valor)) throw new Error(`Valor inválido em ${campo}.`)
      valores[campo] = valor
    }
    for (const produto of ['prod1', 'prod2', 'prod3', 'prod4']) {
      const q = `${produto}_quant`, v = `${produto}_valor`, t = `${produto}_total`
      if (Number(valores[q]) && Number(valores[v])) valores[t] = Math.round((Number(valores[q]) * Number(valores[v]) + Number.EPSILON) * 1000000) / 1000000
    }
    const totalizaveis = camposNumericos.filter((campo) => campo.startsWith('conta') || campo.endsWith('_total'))
    const total = Math.round((totalizaveis.reduce((soma, campo) => soma + Number(valores[campo] || 0), 0) + Number.EPSILON) * 100) / 100
    const descricaoNormalizada = descricao.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    const colunas = camposNumericos.join(', ')
    const placeholders = camposNumericos.map(() => '?').join(', ')
    const usuarioId = req.user?.id || req.usuario?.id || null
    const [resultado] = await db.query(
      `INSERT INTO financeiro_geral
       (empresa_id, data_lancamento, descricao_original, descricao_normalizada, tipo_lancamento,
        total, origem, tabela_origem, registro_origem_id, chave_integracao, usuario_id, status, ${colunas})
       VALUES (?, ?, ?, ?, 'MANUAL', ?, ?, 'MANUAL', NULL, NULL, ?, 'ATIVO', ${placeholders})`,
      [empresaId, dataLancamento, descricao, descricaoNormalizada, total, origem, usuarioId, ...camposNumericos.map((campo) => valores[campo])]
    )
    const recalculo = await recalcularFinanceiroGeralAPartirDe({ empresaId, dataInicial: dataLancamento, usuarioId })
    res.json({ ok: true, id: resultado.insertId, total, recalculo })
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message || 'Erro ao incluir lançamento.' })
  }
})

app.delete('/api/financeiro-geral/lancamentos/:id', async (req, res) => {
  try {
    const senhaInformada = String(req.body?.senha || '').trim()
    const senhaCorreta = String(process.env.SENHA_ADMIN || process.env.SENHA_LIMPAR_COMPETENCIA || 'posto14').trim()
    if (senhaInformada !== senhaCorreta) return res.status(401).json({ ok: false, erro: 'Senha inválida. Exclusão cancelada.' })
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) throw new Error('Lançamento inválido.')
    const [rows] = await db.query(
      `SELECT empresa_id, DATE_FORMAT(data_lancamento, '%Y-%m-%d') AS data_lancamento,
              tipo_lancamento, descricao_normalizada
         FROM financeiro_geral WHERE id = ? AND status = 'ATIVO' LIMIT 1`, [id]
    )
    const linha = rows[0]
    if (!linha) return res.status(404).json({ ok: false, erro: 'Lançamento não encontrado ou já excluído.' })
    const descricaoNormalizada = String(linha.descricao_normalizada || '').toUpperCase()
    if (String(linha.tipo_lancamento || '').toUpperCase() === 'SALDO' || descricaoNormalizada.startsWith('SALDO')) {
      throw new Error('Linhas de saldo não podem ser excluídas.')
    }
    const dataTravaConsolidacao = await validarDataDesbloqueada(Number(linha.empresa_id || 1), String(linha.data_lancamento).slice(0, 10), 'excluir')
    const [resultado] = await db.query(
      `UPDATE financeiro_geral SET status = 'EXCLUIDO', atualizado_em = NOW(), usuario_id = ? WHERE id = ? AND status = 'ATIVO'`,
      [req.user?.id || req.usuario?.id || null, id]
    )
    if (!resultado.affectedRows) throw new Error('Lançamento não encontrado ou já excluído.')
    const recalculo = await recalcularFinanceiroGeralAPartirDe({
      empresaId: Number(linha.empresa_id), dataInicial: dataTravaConsolidacao || String(linha.data_lancamento).slice(0, 10), usuarioId: req.user?.id || req.usuario?.id || null,
    })
    res.json({ ok: true, id, recalculo })
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message || 'Erro ao excluir lançamento.' })
  }
})

app.get('/api/financeiro-geral/excel', async (req, res) => {
  try {
    const f = parametrosFinanceiroGeral(req)
    const colunas = await colunasFinanceiroSolicitadas(req, f.empresaId)
    const { lancamentos, totais } = await consultarFinanceiroGeral(f)
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Posto Via 14'
    wb.created = new Date()
    const ws = wb.addWorksheet('Financeiro Geral', { views: [{ state: 'frozen', ySplit: 4, xSplit: 2 }] })
    ws.mergeCells(1, 1, 1, 4 + colunas.length)
    ws.getCell('A1').value = 'FINANCEIRO GERAL - POSTO VIA 14'
    ws.getCell('A1').font = { bold: true, size: 16 }
    ws.getCell('A2').value = `Período: ${f.dataInicial.split('-').reverse().join('/')} a ${f.dataFinal.split('-').reverse().join('/')}`
    ws.getCell('A3').value = `Registros: ${lancamentos.length}`
    const headers = ['Data', 'Descrição', 'Origem', ...colunas.map((c) => c.label)]
    ws.addRow(headers)
    const header = ws.getRow(4)
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF244A73' } }
    header.alignment = { vertical: 'middle', horizontal: 'center' }
    for (const item of lancamentos) {
      const linha = ws.addRow([
        item.data_lancamento ? new Date(`${String(item.data_lancamento).slice(0, 10)}T12:00:00`) : null,
        item.descricao_original || item.descricao_normalizada || '', item.origem || '',
        ...colunas.map((c) => Number(item[c.key] || 0)),
      ])
      const descricaoLinha = String(item.descricao_normalizada || item.descricao_original || '').toUpperCase()
      if (descricaoLinha.startsWith('SALDO')) {
        linha.font = { bold: true }
        linha.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCAD6E3' } }
      }
    }
    const linhaTotal = ws.addRow(['', 'TOTAIS DO PERÍODO', '', ...colunas.map((c) => Number(totais[c.key] || 0))])
    linhaTotal.font = { bold: true }
    linhaTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } }
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: headers.length } }
    ws.getColumn(1).width = 13; ws.getColumn(1).numFmt = 'dd/mm/yyyy'
    ws.getColumn(2).width = 48; ws.getColumn(3).width = 14
    for (let i = 4; i <= headers.length; i++) {
      const chave = colunas[i - 4]?.key || ''
      ws.getColumn(i).width = (chave.endsWith('_quant') || chave.endsWith('_valor')) ? 11 : 14
      ws.getColumn(i).numFmt = '#,##0.000000;[Red]-#,##0.000000' }
    ws.eachRow((row, rowNumber) => { if (rowNumber >= 4) row.eachCell((cell) => { cell.border = { top: { style: 'thin', color: { argb: 'FFD6DCE4' } }, left: { style: 'thin', color: { argb: 'FFD6DCE4' } }, bottom: { style: 'thin', color: { argb: 'FFD6DCE4' } }, right: { style: 'thin', color: { argb: 'FFD6DCE4' } } } }) })
    const buffer = await wb.xlsx.writeBuffer()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="financeiro_geral_${f.dataInicial}_${f.dataFinal}.xlsx"`)
    res.send(Buffer.from(buffer))
  } catch (error) { res.status(400).json({ ok: false, erro: error.message || 'Erro ao gerar Excel.' }) }
})

app.get('/api/financeiro-geral/relatorio', async (req, res) => {
  try {
    const f = parametrosFinanceiroGeral(req)
    const colunas = await colunasFinanceiroSolicitadas(req, f.empresaId)
    const { lancamentos, totais } = await consultarFinanceiroGeral(f)
    const resumo = colunas.filter((c) => c.key !== 'total').map((c) => {
      let entradas = 0, saidas = 0
      for (const row of lancamentos) { const valor = Number(row[c.key] || 0); if (valor > 0) entradas += valor; else if (valor < 0) saidas += Math.abs(valor) }
      return { ...c, entradas, saidas, saldo: entradas - saidas }
    }).filter((r) => r.entradas || r.saidas)
    res.json({ ok: true, periodo: f, colunas, lancamentos, totais, resumo, totalRegistros: Number(totais.total_registros || 0) })
  } catch (error) { res.status(400).json({ ok: false, erro: error.message || 'Erro ao gerar relatório.' }) }
})



function periodoCompetenciaAuditoria(competencia) {
  const meses = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 }
  const texto = String(competencia || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim()
  const match = texto.match(/^(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)(\d{2}|\d{4})$/)
  if (!match) throw new Error('Competência inválida.')
  const mes = meses[match[1]]
  const ano = Number(match[2].length === 2 ? `20${match[2]}` : match[2])
  const inicial = `${ano}-${String(mes).padStart(2, '0')}-01`
  const final = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10)
  return { inicial, final, mes, ano }
}

function numeroAuditoria(valor) {
  const n = Number(valor || 0)
  return Number.isFinite(n) ? n : 0
}

function arredAuditoria(valor) {
  return Math.round((numeroAuditoria(valor) + Number.EPSILON) * 100) / 100
}

app.get('/api/auditoria/financeiro-geral', async (req, res) => {
  try {
    const empresaId = Number(req.query.empresaId || 1)
    const competencia = String(req.query.competencia || 'Mar26')
    const { inicial, final } = periodoCompetenciaAuditoria(competencia)
    const contas = Array.from({ length: 30 }, (_, i) => `conta${String(i + 1).padStart(2, '0')}`)
    const produtos = ['prod1', 'prod2', 'prod3', 'prod4']
    const campos = [...contas, ...produtos.flatMap((p) => [`${p}_quant`, `${p}_valor`, `${p}_total`]), 'total']

    const [rows] = await db.query(
      `SELECT id, DATE_FORMAT(data_lancamento, '%Y-%m-%d') AS data_lancamento,
              descricao_original, descricao_normalizada, tipo_lancamento, origem,
              chave_integracao, ${campos.join(', ')}
         FROM financeiro_geral
        WHERE empresa_id = ? AND status = 'ATIVO' AND data_lancamento BETWEEN ? AND ?
        ORDER BY data_lancamento ASC, id ASC`,
      [empresaId, inicial, final]
    )

    const [baseRows] = await db.query(
      `SELECT ${contas.join(', ')}
         FROM financeiro_geral
        WHERE empresa_id = ? AND status = 'ATIVO' AND data_lancamento < ?
          AND UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE 'SALDO DO DIA%'
        ORDER BY data_lancamento DESC, id DESC LIMIT 1`,
      [empresaId, inicial]
    )

    const [duplicadas] = await db.query(
      `SELECT chave_integracao, COUNT(*) AS quantidade
         FROM financeiro_geral
        WHERE empresa_id = ? AND status = 'ATIVO' AND data_lancamento BETWEEN ? AND ?
          AND chave_integracao IS NOT NULL AND chave_integracao <> ''
        GROUP BY chave_integracao HAVING COUNT(*) > 1`,
      [empresaId, inicial, final]
    )

    const normalizar = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
    const issues = []
    const adicionar = (nivel, categoria, data, descricao, detalhe, valor = null, id = null) => {
      issues.push({ nivel, categoria, data, descricao, detalhe, valor, id })
    }

    for (const item of duplicadas) {
      adicionar('CRITICO', 'Duplicidade', '', 'Chave de integração repetida', `${item.quantidade} lançamentos compartilham a chave ${item.chave_integracao}.`)
    }

    const porDia = new Map()
    for (const row of rows) {
      const dia = String(row.data_lancamento)
      if (!porDia.has(dia)) porDia.set(dia, [])
      porDia.get(dia).push(row)

      const desc = normalizar(row.descricao_normalizada || row.descricao_original)
      const spot = arredAuditoria(row.conta01)
      const itau = arredAuditoria(row.conta02)
      const caixa = arredAuditoria(row.conta11)
      const cartao = arredAuditoria(row.conta12)

      if (desc.includes('CREDITO VENDAS CARTAO') && (spot <= 0 || cartao !== -Math.abs(spot))) {
        adicionar('CRITICO', 'Cartão', dia, row.descricao_original, 'Crédito Vendas Cartão deve ser positivo no SPOT e negativo no Cartão, no mesmo valor.', spot, row.id)
      }
      if (desc.includes('PIX RECEBIDO') && desc.includes('MAQUIN') && !desc.includes('TARIFA') && (spot <= 0 || cartao !== -Math.abs(spot))) {
        adicionar('CRITICO', 'PIX maquininha', dia, row.descricao_original, 'Pix recebido na maquininha deve ser positivo no SPOT e negativo no Cartão, no mesmo valor.', spot, row.id)
      }
      if (desc.includes('TARIFA PIX RECEBIDO') && cartao !== 0) {
        adicionar('CRITICO', 'Tarifa PIX', dia, row.descricao_original, 'Tarifa PIX recebimento deve movimentar somente o SPOT.', cartao, row.id)
      }
      if ((desc === 'DEPOSITO DINHEIRO ATM' || desc.includes('DEP DIN ATM')) && (itau <= 0 || caixa !== -Math.abs(itau))) {
        adicionar('CRITICO', 'Caixa x Itaú', dia, row.descricao_original, 'Depósito dinheiro ATM deve entrar positivo no Itaú e sair negativo no Caixa, no mesmo valor.', itau, row.id)
      }

      if (desc.startsWith('SALDO DO DIA')) {
        for (const p of produtos) {
          const esperado = arredAuditoria(numeroAuditoria(row[`${p}_quant`]) * numeroAuditoria(row[`${p}_valor`]))
          const informado = arredAuditoria(row[`${p}_total`])
          if (Math.abs(esperado - informado) > 0.01) {
            adicionar('ATENCAO', 'Estoque', dia, row.descricao_original, `${p}: total do estoque difere de quantidade × preço médio.`, informado, row.id)
          }
        }
        for (const campo of ['conta01', 'conta02', 'conta11', 'conta12', 'conta13']) {
          if (numeroAuditoria(row[campo]) < -0.01) {
            adicionar('ATENCAO', 'Saldo negativo', dia, row.descricao_original, `${campo} encerrou o dia com saldo negativo.`, row[campo], row.id)
          }
        }
      }
    }

    const saldoCorrente = new Map(contas.map((c) => [c, numeroAuditoria(baseRows[0]?.[c])]))
    let possuiBase = Boolean(baseRows[0])
    const dias = []
    for (const [data, linhas] of porDia.entries()) {
      const movimentos = linhas.filter((r) => !normalizar(r.descricao_normalizada || r.descricao_original).startsWith('SALDO'))
      const saldos = linhas.filter((r) => normalizar(r.descricao_normalizada || r.descricao_original).startsWith('SALDO DO DIA'))
      const fechamento = saldos.at(-1) || null
      const entradas = movimentos.reduce((t, r) => t + contas.reduce((s, c) => s + Math.max(0, numeroAuditoria(r[c])), 0), 0)
      const saidas = movimentos.reduce((t, r) => t + contas.reduce((s, c) => s + Math.abs(Math.min(0, numeroAuditoria(r[c]))), 0), 0)

      if (saldos.length > 1) adicionar('CRITICO', 'Fechamento', data, 'Saldo do dia duplicado', `Foram encontradas ${saldos.length} linhas de fechamento no mesmo dia.`)
      if (!fechamento && movimentos.length) adicionar('CRITICO', 'Fechamento', data, 'Saldo do dia ausente', 'Existem movimentos, mas não há linha de Saldo do dia.')

      if (possuiBase && fechamento) {
        for (const campo of contas) {
          const movimento = movimentos.reduce((t, r) => t + numeroAuditoria(r[campo]), 0)
          const esperado = arredAuditoria(numeroAuditoria(saldoCorrente.get(campo)) + movimento)
          const informado = arredAuditoria(fechamento[campo])
          if (Math.abs(esperado - informado) > 0.01) {
            adicionar('CRITICO', 'Continuidade de saldo', data, fechamento.descricao_original, `${campo}: esperado ${esperado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, encontrado ${informado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`, informado, fechamento.id)
          }
        }
      }
      if (fechamento) {
        for (const campo of contas) saldoCorrente.set(campo, numeroAuditoria(fechamento[campo]))
        possuiBase = true
      }
      dias.push({ data, lancamentos: movimentos.length, entradas: arredAuditoria(entradas), saidas: arredAuditoria(saidas), possuiFechamento: Boolean(fechamento), alertas: issues.filter((i) => i.data === data).length })
    }

    const criticos = issues.filter((i) => i.nivel === 'CRITICO').length
    const atencoes = issues.filter((i) => i.nivel === 'ATENCAO').length
    const ordemNivelAuditoria = { CRITICO: 0, ATENCAO: 1, INFO: 2 }
    res.json({
      ok: true,
      periodo: { inicial, final, competencia },
      resumo: {
        lancamentos: rows.length,
        diasAnalisados: porDia.size,
        diasSemFechamento: dias.filter((d) => !d.possuiFechamento && d.lancamentos > 0).length,
        criticos,
        atencoes,
        status: criticos ? 'REPROVADO' : atencoes ? 'ATENCAO' : 'APROVADO',
      },
      issues: issues.sort((a, b) => (ordemNivelAuditoria[a.nivel] ?? 9) - (ordemNivelAuditoria[b.nivel] ?? 9) || String(a.data).localeCompare(String(b.data))),
      dias,
    })
  } catch (error) {
    console.error('ERRO /api/auditoria/financeiro-geral:', error)
    res.status(400).json({ ok: false, erro: error.message || 'Erro ao auditar o Financeiro Geral.' })
  }
})

app.get('/api/compras', async (req, res) => {
  try {
    const { dataInicial, dataFinal } = obterIntervaloDatas(req)
    const [dados] = await db.query(`
      SELECT
        c.id,
        DATE_FORMAT(c.data_emissao, '%d/%m/%Y') AS data_emissao,
        DATE_FORMAT(c.data_emissao, '%Y-%m-%d') AS data_iso,
        c.produto_id,
        c.fornecedor_id,
        pr.nome AS produto,
        f.nome AS fornecedor,
        c.numero_nf,
        c.custo,
        c.quantidade,
        c.valor_total,
        c.quant_rec,
        c.preco_pag,
        c.valor_pag
      FROM compras c
      LEFT JOIN produtos pr ON pr.id = c.produto_id
      LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
      WHERE c.data_emissao BETWEEN ? AND ?
      ORDER BY c.data_emissao ASC, pr.nome ASC, c.numero_nf ASC
    `, [dataInicial, dataFinal])

    res.json({ ok: true, dados })
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message })
  }
})

app.get('/api/lmc', async (req, res) => {
  try {
    const { dataInicial, dataFinal } = obterIntervaloDatas(req)
    const [dados] = await db.query(`
      SELECT
        l.id,
        DATE_FORMAT(l.data_movimento, '%d/%m/%Y') AS data_movimento,
        DATE_FORMAT(l.data_movimento, '%Y-%m-%d') AS data_iso,
        l.produto_id,
        pr.nome AS produto,
        l.estoque_abertura,
        l.quantidade_vendas,
        l.valor_vendas,
        l.ajuste_quantidade,
        l.estoque_fechamento
      FROM lmc_movimentos l
      LEFT JOIN produtos pr ON pr.id = l.produto_id
      WHERE l.data_movimento BETWEEN ? AND ?
      ORDER BY l.data_movimento ASC, pr.nome ASC
    `, [dataInicial, dataFinal])

    res.json({ ok: true, dados })
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message })
  }
})

async function consultarExtratosPorOrigem(req, res, origem) {
  try {
    const { dataInicial, dataFinal } = obterIntervaloDatas(req)

    const [dadosPeriodo] = await db.query(`
      SELECT
        e.id,
        DATE_FORMAT(e.data_lancamento, '%d/%m/%Y') AS data_lancamento,
        DATE_FORMAT(e.data_lancamento, '%Y-%m-%d') AS data_iso,
        e.descricao_original,
        e.valor,
        e.saldo,
        e.natureza,
        e.origem,
        1 AS ordem_extra
      FROM extratos_bancarios e
      WHERE e.data_lancamento BETWEEN ? AND ?
        AND UPPER(e.origem) = ?
      ORDER BY e.data_lancamento ASC,
        CASE WHEN UPPER(e.natureza) = 'SALDO' OR UPPER(e.descricao_original) LIKE 'SALDO DO DIA%' THEN 2 ELSE 1 END,
        e.id ASC
    `, [dataInicial, dataFinal, origem])

    const dados = dadosPeriodo.map((item) => ({
      ...item,
      saldo: Number(item.saldo || 0) === 0 ? null : item.saldo,
    }))

    res.json({ ok: true, dados })
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message })
  }
}

app.get('/api/spot', (req, res) => consultarExtratosPorOrigem(req, res, 'SPOT'))
app.get('/api/itau', (req, res) => consultarExtratosPorOrigem(req, res, 'ITAU'))


app.get('/api/vendas-cartao', async (req, res) => {
  try {
    const { dataInicial, dataFinal } = obterIntervaloDatas(req)
    const [dados] = await db.query(`
      SELECT id, DATE_FORMAT(data_lancamento, '%d/%m/%Y') AS data_lancamento,
        DATE_FORMAT(data_lancamento, '%Y-%m-%d') AS data_iso,
        descricao_original, vendas_bruta, venda_liquida, taxa, tipo_lancamento, status
      FROM vendas_cartao
      WHERE data_lancamento BETWEEN ? AND ? AND status = 'ATIVO'
      ORDER BY data_lancamento ASC, id ASC
    `, [dataInicial, dataFinal])
    res.json({ ok: true, dados })
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message })
  }
})

app.get('/api/extratos-conta', async (req, res) => {
  try {
    const { dataInicial, dataFinal } = obterIntervaloDatas(req)
    const contaBancariaId = Number(req.query.contaBancariaId || 0)
    if (!Number.isInteger(contaBancariaId) || contaBancariaId <= 0) {
      throw new Error('Selecione uma conta bancária válida.')
    }

    const [dadosPeriodo] = await db.query(`
      SELECT
        e.id,
        DATE_FORMAT(e.data_lancamento, '%d/%m/%Y') AS data_lancamento,
        DATE_FORMAT(e.data_lancamento, '%Y-%m-%d') AS data_iso,
        e.descricao_original,
        e.valor,
        e.saldo,
        e.natureza,
        e.origem,
        e.conta_bancaria_id,
        cb.nome_conta,
        cb.instituicao AS banco
      FROM extratos_bancarios e
      INNER JOIN contas_bancarias cb ON cb.id = e.conta_bancaria_id
      WHERE e.data_lancamento BETWEEN ? AND ?
        AND e.conta_bancaria_id = ?
      ORDER BY e.data_lancamento ASC,
        CASE WHEN UPPER(e.natureza) = 'SALDO' OR UPPER(e.descricao_original) LIKE 'SALDO DO DIA%' THEN 2 ELSE 1 END,
        e.id ASC
    `, [dataInicial, dataFinal, contaBancariaId])

    // Assim como no Financeiro Geral, exibe antes do período filtrado o último
    // fechamento da conta. A linha é apenas apresentada como "Saldo anterior";
    // nenhum registro novo é criado ou alterado no banco de dados.
    const [saldosAnteriores] = await db.query(`
      SELECT
        e.id,
        DATE_FORMAT(e.data_lancamento, '%d/%m/%Y') AS data_lancamento,
        DATE_FORMAT(e.data_lancamento, '%Y-%m-%d') AS data_iso,
        'Saldo anterior' AS descricao_original,
        NULL AS valor,
        e.saldo,
        'SALDO' AS natureza,
        e.origem,
        e.conta_bancaria_id,
        cb.nome_conta,
        cb.instituicao AS banco
      FROM extratos_bancarios e
      INNER JOIN contas_bancarias cb ON cb.id = e.conta_bancaria_id
      WHERE e.data_lancamento < ?
        AND e.conta_bancaria_id = ?
        AND (
          UPPER(COALESCE(e.natureza, '')) = 'SALDO'
          OR UPPER(COALESCE(e.descricao_original, '')) LIKE 'SALDO DO DIA%'
        )
      ORDER BY e.data_lancamento DESC, e.id DESC
      LIMIT 1
    `, [dataInicial, contaBancariaId])

    const dadosNormalizados = dadosPeriodo.map((item) => ({
      ...item,
      saldo: Number(item.saldo || 0) === 0 ? null : item.saldo,
    }))
    const saldoAnterior = saldosAnteriores[0]
      ? { ...saldosAnteriores[0], saldo: Number(saldosAnteriores[0].saldo || 0) === 0 ? null : saldosAnteriores[0].saldo }
      : null
    const dados = saldoAnterior ? [saldoAnterior, ...dadosNormalizados] : dadosNormalizados

    res.json({ ok: true, dados })
  } catch (error) {
    res.status(400).json({ ok: false, erro: error.message })
  }
})


function numeroValido(valor, campo, { minimo = null } = {}) {
  const numero = Number(String(valor ?? '').replace(',', '.'))
  if (!Number.isFinite(numero)) throw new Error(`${campo} inválido.`)
  if (minimo !== null && numero < minimo) throw new Error(`${campo} não pode ser menor que ${minimo}.`)
  return numero
}

function normalizarNomeContaSaldo(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

function contaComSaldoAutomatico(conta) {
  const texto = normalizarNomeContaSaldo([
    conta?.nome_conta,
    conta?.instituicao,
    conta?.origem,
  ].filter(Boolean).join(' '))

  if (!texto) return false
  return [
    'SPOTBANK', 'SPOT BANK', 'SPOT', 'ITAU', 'SPOT LUCILA', 'LUCILA',
    'CAIXA', 'ERALDO', 'EMPRESTIMO', 'EMPRESTIMOS', 'FORNECEDOR', 'FORNECEDORES',
  ].some((termo) => texto.includes(termo))
}

function ehLinhaSaldoExtrato(row) {
  const natureza = normalizarNomeContaSaldo(row?.natureza)
  const descricao = normalizarNomeContaSaldo(row?.descricao_normalizada || row?.descricao_original || row?.tipo_lancamento)
  return natureza === 'SALDO' || descricao.includes('SALDO DO DIA') || descricao.includes('SALDO ANTERIOR')
}

function ehSaldoDoDiaExtrato(row) {
  const descricao = normalizarNomeContaSaldo(row?.descricao_normalizada || row?.descricao_original || row?.tipo_lancamento)
  return descricao.includes('SALDO DO DIA') || (normalizarNomeContaSaldo(row?.natureza) === 'SALDO' && !descricao.includes('SALDO ANTERIOR'))
}

async function obterContaExtrato(conn, empresaId, contaBancariaId, origem = '') {
  if (Number(contaBancariaId) > 0) {
    const [[conta]] = await conn.query(
      `SELECT id, nome_conta, instituicao FROM contas_bancarias WHERE id = ? AND empresa_id = ? LIMIT 1`,
      [Number(contaBancariaId), empresaId]
    )
    if (conta) return { ...conta, origem }
  }

  const origemLimpa = String(origem || '').trim()
  if (!origemLimpa) return null
  const [[conta]] = await conn.query(
    `SELECT id, nome_conta, instituicao FROM contas_bancarias
     WHERE empresa_id = ? AND (UPPER(nome_conta) = UPPER(?) OR UPPER(instituicao) = UPPER(?))
     ORDER BY id LIMIT 1`,
    [empresaId, origemLimpa, origemLimpa]
  )
  return conta ? { ...conta, origem: origemLimpa } : null
}

async function recalcularSaldosExtratoAPartir(conn, { empresaId, contaBancariaId, origem, dataInicial }) {
  const conta = await obterContaExtrato(conn, empresaId, contaBancariaId, origem)
  if (!conta || !contaComSaldoAutomatico(conta)) return { atualizado: false, linhas: 0 }

  const inicio = dataIsoValida(dataInicial, 'Data inicial')
  const [[saldoAnterior]] = await conn.query(
    `SELECT saldo FROM extratos_bancarios
     WHERE empresa_id = ? AND conta_bancaria_id = ? AND data_lancamento < ?
       AND (UPPER(COALESCE(natureza, '')) = 'SALDO'
         OR UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE '%SALDO DO DIA%')
     ORDER BY data_lancamento DESC, id DESC LIMIT 1`,
    [empresaId, conta.id, inicio]
  )

  let saldoAcumulado = Number(saldoAnterior?.saldo || 0)
  const [linhas] = await conn.query(
    `SELECT id, DATE_FORMAT(data_lancamento, '%Y-%m-%d') AS data_lancamento,
            descricao_original, descricao_normalizada, tipo_lancamento,
            valor, saldo, natureza
     FROM extratos_bancarios
     WHERE empresa_id = ? AND conta_bancaria_id = ? AND data_lancamento >= ?
     ORDER BY data_lancamento ASC,
              CASE
                WHEN UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE '%SALDO ANTERIOR%' THEN 0
                WHEN UPPER(COALESCE(natureza, '')) = 'SALDO'
                  OR UPPER(COALESCE(descricao_normalizada, descricao_original, '')) LIKE '%SALDO DO DIA%' THEN 2
                ELSE 1
              END ASC,
              id ASC`,
    [empresaId, conta.id, inicio]
  )

  let atualizadas = 0
  let criadas = 0
  let dataAtual = null
  let saldosDia = []
  let houveMovimentoNoDia = false

  const fecharDia = async () => {
    if (!dataAtual) return

    const saldoFechamento = Math.round((saldoAcumulado + Number.EPSILON) * 100) / 100

    if (saldosDia.length) {
      for (const linhaSaldo of saldosDia) {
        await conn.query(
          `UPDATE extratos_bancarios
           SET descricao_original = 'Saldo do dia',
               descricao_normalizada = 'SALDO DO DIA',
               tipo_lancamento = 'Saldo do dia',
               saldo = ?, valor = 0, natureza = 'SALDO', atualizado_em = NOW()
           WHERE id = ?`,
          [saldoFechamento, linhaSaldo.id]
        )
        atualizadas += 1
      }
      return
    }

    // Só cria fechamento para datas que realmente possuem lançamentos.
    // Datas vazias ou contendo apenas linhas de saldo não recebem nova linha.
    if (!houveMovimentoNoDia) return

    const origemSaldo = String(conta.origem || origem || conta.instituicao || conta.nome_conta || '').trim()
    await conn.query(
      `INSERT INTO extratos_bancarios
       (empresa_id, conta_bancaria_id, data_lancamento,
        descricao_original, descricao_normalizada, tipo_lancamento,
        valor, saldo, natureza, origem)
       VALUES (?, ?, ?, 'Saldo do dia', 'SALDO DO DIA', 'Saldo do dia', 0, ?, 'SALDO', ?)`,
      [empresaId, conta.id, dataAtual, saldoFechamento, origemSaldo]
    )
    criadas += 1
  }

  for (const row of linhas) {
    const dataLinha = String(row.data_lancamento || '').slice(0, 10)
    if (dataAtual !== null && dataLinha !== dataAtual) {
      await fecharDia()
      saldosDia = []
      houveMovimentoNoDia = false
    }
    dataAtual = dataLinha

    const descricaoSaldo = normalizarNomeContaSaldo(row?.descricao_normalizada || row?.descricao_original || row?.tipo_lancamento)
    if (descricaoSaldo.includes('SALDO ANTERIOR')) {
      if (row.saldo !== null && row.saldo !== undefined && row.saldo !== '') {
        saldoAcumulado = Number(row.saldo)
      }
      continue
    }
    if (ehSaldoDoDiaExtrato(row)) {
      saldosDia.push(row)
      continue
    }
    if (ehLinhaSaldoExtrato(row)) continue

    houveMovimentoNoDia = true
    saldoAcumulado = Math.round((saldoAcumulado + Number(row.valor || 0) + Number.EPSILON) * 100) / 100
  }
  await fecharDia()

  return {
    atualizado: true,
    linhas: atualizadas + criadas,
    atualizadas,
    criadas,
    contaId: conta.id,
  }
}

async function obterEmpresaIdPadrao(conn) {
  const [[empresa]] = await conn.query("SELECT id FROM empresas WHERE nome = 'Posto Via 14' LIMIT 1")
  if (!empresa?.id) throw new Error('Empresa Posto Via 14 não encontrada.')
  return empresa.id
}

async function obterOuCriarProdutoEdicao(conn, nome) {
  const limpo = String(nome || '').trim().toUpperCase()
  if (!limpo) throw new Error('Produto é obrigatório.')
  let base = limpo
  if (limpo.includes('GASOLINA')) base = 'GASOLINA'
  if (limpo.includes('ETANOL')) base = 'ETANOL'
  if (limpo.includes('DIESEL')) base = 'DIESEL'
  await conn.query(`INSERT INTO produtos (nome, tipo, unidade) VALUES (?, 'COMBUSTIVEL', 'L')
    ON DUPLICATE KEY UPDATE nome = VALUES(nome)`, [base])
  const [[produto]] = await conn.query('SELECT id FROM produtos WHERE nome = ? LIMIT 1', [base])
  return produto.id
}

async function obterOuCriarFornecedorEdicao(conn, nome) {
  const limpo = String(nome || '').trim()
  if (!limpo) throw new Error('Fornecedor é obrigatório.')
  await conn.query('INSERT INTO fornecedores (nome) VALUES (?) ON DUPLICATE KEY UPDATE nome = VALUES(nome)', [limpo])
  const [[fornecedor]] = await conn.query('SELECT id FROM fornecedores WHERE nome = ? LIMIT 1', [limpo])
  return fornecedor.id
}

app.get('/api/cadastros-edicao', async (_req, res) => {
  try {
    const [produtos] = await db.query('SELECT id, nome FROM produtos ORDER BY nome')
    const [fornecedores] = await db.query('SELECT id, nome FROM fornecedores ORDER BY nome')
    res.json({ ok: true, produtos, fornecedores })
  } catch (error) {
    res.status(500).json({ ok: false, erro: error.message })
  }
})


app.post('/api/dados-gravados/:tipo', async (req, res) => {
  const conn = await db.getConnection()
  try {
    const tipo = String(req.params.tipo || '').toLowerCase()
    if (!['compras', 'vendas', 'vendas-cartao', 'spot', 'itau', 'extrato'].includes(tipo)) throw new Error('Tipo de registro inválido.')
    const data = dataIsoValida(req.body?.data, 'Data')
    await conn.beginTransaction()
    const empresaId = await obterEmpresaIdPadrao(conn)
    let id = null

    if (tipo === 'compras') {
      const produtoId = await obterOuCriarProdutoEdicao(conn, req.body.produto)
      const fornecedorId = await obterOuCriarFornecedorEdicao(conn, req.body.fornecedor)
      const quantidade = numeroValido(req.body.quantidade, 'Quantidade', { minimo: 0 })
      const custo = numeroValido(req.body.custo, 'Custo', { minimo: 0 })
      const valorTotal = numeroValido(req.body.valor_total, 'Valor total', { minimo: 0 })
      const quantRec = req.body.quant_rec === '' || req.body.quant_rec == null ? quantidade : numeroValido(req.body.quant_rec, 'Quantidade recebida', { minimo: 0 })
      const precoPag = req.body.preco_pag === '' || req.body.preco_pag == null ? custo : numeroValido(req.body.preco_pag, 'Preço pago', { minimo: 0 })
      const valorPag = quantRec * precoPag
      const [resultado] = await conn.query(`INSERT INTO compras (empresa_id, data_emissao, produto_id, fornecedor_id, numero_nf, custo, quantidade, valor_total, quant_rec, preco_pag, valor_pag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, data, produtoId, fornecedorId, String(req.body.numero_nf || '').trim(), custo, quantidade, valorTotal, quantRec, precoPag, valorPag])
      id = resultado.insertId
    }

    if (tipo === 'vendas') {
      const produtoId = await obterOuCriarProdutoEdicao(conn, req.body.produto)
      const abertura = numeroValido(req.body.estoque_abertura, 'Estoque de abertura')
      const vendas = Math.abs(numeroValido(req.body.quantidade_vendas, 'Quantidade de vendas'))
      const valor = vendas === 0 ? 0 : numeroValido(req.body.valor_vendas, 'Valor das vendas', { minimo: 0 })
      const ajuste = numeroValido(req.body.ajuste_quantidade, 'Ajuste')
      const fechamento = numeroValido(req.body.estoque_fechamento, 'Estoque de fechamento')
      const [resultado] = await conn.query(`INSERT INTO lmc_movimentos (empresa_id, data_movimento, produto_id, estoque_abertura, quantidade_vendas, valor_vendas, ajuste_quantidade, estoque_fechamento) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, data, produtoId, abertura, vendas, valor, ajuste, fechamento])
      id = resultado.insertId
    }

    if (tipo === 'vendas-cartao') {
      const descricao = String(req.body.descricao_original || 'Crédito Vendas Cartão').trim()
      const vendaBruta = Math.abs(numeroValido(req.body.vendas_bruta, 'Venda bruta', { minimo: 0 }))
      const vendaLiquida = Math.abs(numeroValido(req.body.venda_liquida, 'Venda líquida', { minimo: 0 }))
      const taxa = Math.abs(numeroValido(req.body.taxa, 'Taxas', { minimo: 0 }))
      const [resultado] = await conn.query(`INSERT INTO vendas_cartao
        (empresa_id, data_lancamento, descricao_original, descricao_normalizada, tipo_lancamento, vendas_bruta, venda_liquida, taxa, status)
        VALUES (?, ?, ?, ?, 'CREDITO_VENDAS', ?, ?, ?, 'ATIVO')`,
        [empresaId, data, descricao, descricao.toUpperCase(), vendaBruta, vendaLiquida, taxa])
      id = resultado.insertId
    }

    if (tipo === 'spot' || tipo === 'itau' || tipo === 'extrato') {
      let conta = null
      let origem = tipo === 'spot' ? 'SPOT' : tipo === 'itau' ? 'ITAU' : ''
      if (tipo === 'extrato') {
        const contaBancariaId = Number(req.body?.contaBancariaId || 0)
        if (!Number.isInteger(contaBancariaId) || contaBancariaId <= 0) throw new Error('Selecione uma conta bancária válida.')
        const [[contaEncontrada]] = await conn.query(`SELECT cb.id, cb.nome_conta, cb.instituicao AS banco FROM contas_bancarias cb WHERE cb.id=? AND cb.empresa_id=? LIMIT 1`, [contaBancariaId, empresaId])
        if (!contaEncontrada) throw new Error('Conta bancária não encontrada para esta empresa.')
        conta = contaEncontrada
        origem = String(conta.banco || conta.nome_conta || '').trim()
      }
      const descricao = String(req.body.descricao_original || '').trim()
      if (!descricao) throw new Error('Descrição é obrigatória.')
      const natureza = String(req.body.natureza || '').trim().toUpperCase()
      if (!['ENTRADA', 'SAIDA', 'SALDO'].includes(natureza)) throw new Error('Natureza inválida.')
      let valor = numeroValido(req.body.valor || 0, 'Valor')
      if (natureza === 'ENTRADA') valor = Math.abs(valor)
      if (natureza === 'SAIDA') valor = -Math.abs(valor)
      if (natureza === 'SALDO') valor = 0
      const saldo = req.body.saldo === '' || req.body.saldo == null ? null : numeroValido(req.body.saldo, 'Saldo')
      if (!conta) {
        await conn.query(`INSERT INTO contas_bancarias (empresa_id, instituicao, tipo, nome_conta, ativo) VALUES (?, ?, 'BANCARIA', ?, 1) ON DUPLICATE KEY UPDATE instituicao=VALUES(instituicao), atualizado_em=NOW()`, [empresaId, origem, origem])
        const [[contaEncontrada]] = await conn.query('SELECT id, nome_conta FROM contas_bancarias WHERE empresa_id=? AND nome_conta=? LIMIT 1', [empresaId, origem])
        conta = contaEncontrada
      }
      const [resultado] = await conn.query(`INSERT INTO extratos_bancarios (empresa_id, conta_bancaria_id, data_lancamento, descricao_original, descricao_normalizada, tipo_lancamento, valor, saldo, natureza, origem) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, conta.id, data, descricao, descricao, descricao, valor, saldo, natureza, origem])
      id = resultado.insertId
      await recalcularSaldosExtratoAPartir(conn, {
        empresaId,
        contaBancariaId: conta.id,
        origem,
        dataInicial: data,
      })
    }

    await conn.commit()
    res.status(201).json({ ok: true, id, mensagem: 'Registro incluído com sucesso.' })
  } catch (error) {
    await conn.rollback().catch(() => {})
    res.status(400).json({ ok: false, erro: error.message })
  } finally {
    conn.release()
  }
})

app.put('/api/dados-gravados/:tipo/:id', async (req, res) => {
  const conn = await db.getConnection()
  try {
    const tipo = String(req.params.tipo || '').toLowerCase()
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) throw new Error('Registro inválido.')
    if (!['compras', 'vendas', 'vendas-cartao', 'spot', 'itau', 'extrato'].includes(tipo)) throw new Error('Tipo de registro inválido.')

    const data = dataIsoValida(req.body?.data, 'Data')
    await conn.beginTransaction()
    const empresaId = await obterEmpresaIdPadrao(conn)
    let extratoAnterior = null
    if (tipo === 'spot' || tipo === 'itau' || tipo === 'extrato') {
      const [[rowAnterior]] = await conn.query(
        `SELECT id, conta_bancaria_id, DATE_FORMAT(data_lancamento, '%Y-%m-%d') AS data_lancamento, origem
         FROM extratos_bancarios WHERE id = ? AND empresa_id = ? LIMIT 1`,
        [id, empresaId]
      )
      extratoAnterior = rowAnterior || null
    }

    if (tipo === 'compras') {
      const produtoId = await obterOuCriarProdutoEdicao(conn, req.body.produto)
      const fornecedorId = await obterOuCriarFornecedorEdicao(conn, req.body.fornecedor)
      const quantidade = numeroValido(req.body.quantidade, 'Quantidade', { minimo: 0 })
      const custo = numeroValido(req.body.custo, 'Custo', { minimo: 0 })
      const valorTotal = numeroValido(req.body.valor_total, 'Valor total', { minimo: 0 })
      const quantRec = req.body.quant_rec === '' || req.body.quant_rec == null ? quantidade : numeroValido(req.body.quant_rec, 'Quantidade recebida', { minimo: 0 })
      const precoPag = req.body.preco_pag === '' || req.body.preco_pag == null ? custo : numeroValido(req.body.preco_pag, 'Preço pago', { minimo: 0 })
      const valorPag = quantRec * precoPag
      const [resultado] = await conn.query(`UPDATE compras SET empresa_id=?, data_emissao=?, produto_id=?, fornecedor_id=?, numero_nf=?, custo=?, quantidade=?, valor_total=?, quant_rec=?, preco_pag=?, valor_pag=? WHERE id=?`,
        [empresaId, data, produtoId, fornecedorId, String(req.body.numero_nf || '').trim(), custo, quantidade, valorTotal, quantRec, precoPag, valorPag, id])
      if (!resultado.affectedRows) throw new Error('Compra não encontrada.')
    }

    if (tipo === 'vendas') {
      const produtoId = await obterOuCriarProdutoEdicao(conn, req.body.produto)
      const abertura = numeroValido(req.body.estoque_abertura, 'Estoque de abertura')
      const vendas = Math.abs(numeroValido(req.body.quantidade_vendas, 'Quantidade de vendas'))
      const valor = vendas === 0 ? 0 : numeroValido(req.body.valor_vendas, 'Valor das vendas', { minimo: 0 })
      const ajuste = numeroValido(req.body.ajuste_quantidade, 'Ajuste')
      const fechamento = numeroValido(req.body.estoque_fechamento, 'Estoque de fechamento')
      const [resultado] = await conn.query(`UPDATE lmc_movimentos SET empresa_id=?, data_movimento=?, produto_id=?, estoque_abertura=?, quantidade_vendas=?, valor_vendas=?, ajuste_quantidade=?, estoque_fechamento=?, atualizado_em=NOW() WHERE id=?`,
        [empresaId, data, produtoId, abertura, vendas, valor, ajuste, fechamento, id])
      if (!resultado.affectedRows) throw new Error('Venda não encontrada.')
    }

    if (tipo === 'vendas-cartao') {
      const descricao = String(req.body.descricao_original || 'Crédito Vendas Cartão').trim()
      const vendaBruta = Math.abs(numeroValido(req.body.vendas_bruta, 'Venda bruta', { minimo: 0 }))
      const vendaLiquida = Math.abs(numeroValido(req.body.venda_liquida, 'Venda líquida', { minimo: 0 }))
      const taxa = Math.abs(numeroValido(req.body.taxa, 'Taxas', { minimo: 0 }))
      const [resultado] = await conn.query(`UPDATE vendas_cartao SET empresa_id=?, data_lancamento=?,
        descricao_original=?, descricao_normalizada=?, vendas_bruta=?, venda_liquida=?, taxa=?, atualizado_em=NOW() WHERE id=?`,
        [empresaId, data, descricao, descricao.toUpperCase(), vendaBruta, vendaLiquida, taxa, id])
      if (!resultado.affectedRows) throw new Error('Venda no cartão não encontrada.')
    }

    if (tipo === 'spot' || tipo === 'itau' || tipo === 'extrato') {
      const contaBancariaId = Number(req.body?.contaBancariaId || 0) || null
      const origem = tipo === 'spot' ? 'SPOT' : tipo === 'itau' ? 'ITAU' : null
      const descricao = String(req.body.descricao_original || '').trim()
      if (!descricao) throw new Error('Descrição é obrigatória.')
      const natureza = String(req.body.natureza || '').trim().toUpperCase()
      if (!natureza) throw new Error('Natureza é obrigatória.')
      const valor = numeroValido(req.body.valor, 'Valor')
      const saldo = req.body.saldo === '' || req.body.saldo == null ? null : numeroValido(req.body.saldo, 'Saldo')
      let sql = `UPDATE extratos_bancarios SET empresa_id=?, data_lancamento=?, descricao_original=?, valor=?, saldo=?, natureza=? WHERE id=?`
      const params = [empresaId, data, descricao, valor, saldo, natureza, id]
      if (tipo === 'extrato') {
        if (!contaBancariaId) throw new Error('Selecione uma conta bancária válida.')
        sql += ' AND conta_bancaria_id=?'
        params.push(contaBancariaId)
      } else {
        sql += ' AND UPPER(origem)=?'
        params.push(origem)
      }
      const [resultado] = await conn.query(sql, params)
      if (!resultado.affectedRows) throw new Error('Lançamento bancário não encontrado.')

      const contaAtualId = tipo === 'extrato' ? contaBancariaId : extratoAnterior?.conta_bancaria_id
      const origemAtual = tipo === 'spot' ? 'SPOT' : tipo === 'itau' ? 'ITAU' : extratoAnterior?.origem
      const dataRecalculoAtual = extratoAnterior?.data_lancamento && extratoAnterior.data_lancamento < data
        ? extratoAnterior.data_lancamento
        : data
      await recalcularSaldosExtratoAPartir(conn, {
        empresaId,
        contaBancariaId: contaAtualId,
        origem: origemAtual,
        dataInicial: dataRecalculoAtual,
      })
      if (extratoAnterior?.conta_bancaria_id && Number(extratoAnterior.conta_bancaria_id) !== Number(contaAtualId)) {
        await recalcularSaldosExtratoAPartir(conn, {
          empresaId,
          contaBancariaId: extratoAnterior.conta_bancaria_id,
          origem: extratoAnterior.origem,
          dataInicial: extratoAnterior.data_lancamento,
        })
      }
    }

    await conn.commit()
    res.json({ ok: true, mensagem: 'Registro atualizado com sucesso.' })
  } catch (error) {
    await conn.rollback().catch(() => {})
    res.status(400).json({ ok: false, erro: error.message })
  } finally {
    conn.release()
  }
})

app.delete('/api/dados-gravados/:tipo/:id', async (req, res) => {
  const conn = await db.getConnection()
  try {
    const senhaInformada = String(req.body?.senha || '').trim()
    const senhaCorreta = String(process.env.SENHA_ADMIN || process.env.SENHA_LIMPAR_COMPETENCIA || 'posto14').trim()
    if (senhaInformada !== senhaCorreta) return res.status(401).json({ ok: false, erro: 'Senha inválida. Exclusão cancelada.' })

    const tipo = String(req.params.tipo || '').toLowerCase()
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) throw new Error('Registro inválido.')

    await conn.beginTransaction()
    const empresaId = await obterEmpresaIdPadrao(conn)
    let sql, params
    let extratoAnterior = null

    if (tipo === 'compras') { sql = 'DELETE FROM compras WHERE id = ?'; params = [id] }
    else if (tipo === 'vendas') { sql = 'DELETE FROM lmc_movimentos WHERE id = ?'; params = [id] }
    else if (tipo === 'vendas-cartao') { sql = 'DELETE FROM vendas_cartao WHERE id = ?'; params = [id] }
    else if (tipo === 'spot' || tipo === 'itau' || tipo === 'extrato') {
      const [[rowAnterior]] = await conn.query(
        `SELECT id, conta_bancaria_id, DATE_FORMAT(data_lancamento, '%Y-%m-%d') AS data_lancamento, origem
         FROM extratos_bancarios WHERE id = ? AND empresa_id = ? LIMIT 1`,
        [id, empresaId]
      )
      extratoAnterior = rowAnterior || null
      if (tipo === 'spot' || tipo === 'itau') {
        sql = 'DELETE FROM extratos_bancarios WHERE id = ? AND UPPER(origem) = ?'
        params = [id, tipo.toUpperCase()]
      } else {
        sql = 'DELETE FROM extratos_bancarios WHERE id = ?'
        params = [id]
      }
    } else throw new Error('Tipo de registro inválido.')

    const [resultado] = await conn.query(sql, params)
    if (!resultado.affectedRows) throw new Error('Registro não encontrado ou já excluído.')

    if (extratoAnterior) {
      await recalcularSaldosExtratoAPartir(conn, {
        empresaId,
        contaBancariaId: extratoAnterior.conta_bancaria_id,
        origem: extratoAnterior.origem,
        dataInicial: extratoAnterior.data_lancamento,
      })
    }

    await conn.commit()
    res.json({ ok: true, mensagem: 'Registro excluído com sucesso. Saldos seguintes atualizados.' })
  } catch (error) {
    await conn.rollback().catch(() => {})
    res.status(400).json({ ok: false, erro: error.message })
  } finally {
    conn.release()
  }
})

app.delete('/api/periodo/limpar', async (req, res) => {
  const conn = await db.getConnection()

  try {
    const senhaInformada = String(req.body?.senha || '').trim()
    const senhaCorreta = String(process.env.SENHA_ADMIN || process.env.SENHA_LIMPAR_COMPETENCIA || 'posto14').trim()

    if (senhaInformada !== senhaCorreta) {
      return res.status(401).json({ ok: false, erro: 'Senha inválida. Exclusão cancelada.' })
    }

    const { dataInicial, dataFinal } = obterIntervaloDatas(req)
    const tipo = String(req.body?.tipo || '').toLowerCase()

    if (!['vendas', 'vendas-cartao', 'compras', 'spot', 'itau', 'extrato'].includes(tipo)) {
      throw new Error('Tipo de limpeza inválido.')
    }

    await conn.beginTransaction()

    let removidos = 0
    let descricao = ''

    if (tipo === 'vendas') {
      const [resultado] = await conn.query(`
        DELETE FROM lmc_movimentos
        WHERE data_movimento BETWEEN ? AND ?
      `, [dataInicial, dataFinal])
      removidos = resultado.affectedRows || 0
      descricao = 'vendas'
    }

    if (tipo === 'vendas-cartao') {
      const [resultado] = await conn.query(`
        DELETE FROM vendas_cartao
        WHERE data_lancamento BETWEEN ? AND ?
      `, [dataInicial, dataFinal])
      removidos = resultado.affectedRows || 0
      descricao = 'vendas no cartão'
    }

    if (tipo === 'compras') {
      const [resultado] = await conn.query(`
        DELETE FROM compras
        WHERE data_emissao BETWEEN ? AND ?
      `, [dataInicial, dataFinal])
      removidos = resultado.affectedRows || 0
      descricao = 'compras'
    }

    if (tipo === 'spot' || tipo === 'itau') {
      const origem = tipo === 'spot' ? 'SPOT' : 'ITAU'
      const [resultado] = await conn.query(`
        DELETE FROM extratos_bancarios
        WHERE data_lancamento BETWEEN ? AND ?
          AND UPPER(origem) = ?
      `, [dataInicial, dataFinal, origem])
      removidos = resultado.affectedRows || 0
      descricao = tipo === 'spot' ? 'extrato SPOT' : 'extrato Itaú'
    }

    if (tipo === 'extrato') {
      const contaBancariaId = Number(req.body?.contaBancariaId || 0)
      if (!Number.isInteger(contaBancariaId) || contaBancariaId <= 0) throw new Error('Selecione uma conta bancária válida.')
      const [[conta]] = await conn.query('SELECT nome_conta FROM contas_bancarias WHERE id=? LIMIT 1', [contaBancariaId])
      const [resultado] = await conn.query(`DELETE FROM extratos_bancarios WHERE data_lancamento BETWEEN ? AND ? AND conta_bancaria_id=?`, [dataInicial, dataFinal, contaBancariaId])
      removidos = resultado.affectedRows || 0
      descricao = `extrato ${conta?.nome_conta || 'da conta selecionada'}`
    }

    await conn.commit()

    res.json({
      ok: true,
      mensagem: `Limpeza de ${descricao} realizada de ${dataInicial} até ${dataFinal}.`,
      removidos,
    })
  } catch (error) {
    await conn.rollback().catch(() => {})
    res.status(400).json({ ok: false, erro: error.message })
  } finally {
    conn.release()
  }
})

async function podeGerenciarCadastros(req, res, next) {
  try {
    if (String(req.usuario?.perfil || '').toUpperCase() === 'ADMIN') return next()
    const [rows] = await db.query('SELECT cadastros FROM permissoes WHERE usuario_id=? LIMIT 1', [req.usuario.id])
    if (Number(rows[0]?.cadastros) === 1) return next()
    return res.status(403).json({ ok: false, erro: 'Você não possui permissão para gerenciar cadastros.' })
  } catch (error) {
    return res.status(500).json({ ok: false, erro: error.message })
  }
}

app.get('/api/cadastros-diversos', podeGerenciarCadastros, async (_req, res) => {
  try {
    const [empresas] = await db.query('SELECT id, nome, cnpj, ativo, criado_em FROM empresas ORDER BY criado_em ASC, id ASC')
    const [contas] = await db.query(`SELECT cb.id, cb.empresa_id, e.nome AS empresa, cb.nome_conta, cb.instituicao, cb.tipo, cb.agencia, cb.numero_conta, cb.observacoes, cb.ativo, cb.criado_em FROM contas_bancarias cb INNER JOIN empresas e ON e.id=cb.empresa_id ORDER BY cb.criado_em ASC, cb.id ASC`)
    const [produtos] = await db.query('SELECT id, nome, tipo, unidade, ativo, criado_em FROM produtos ORDER BY criado_em ASC, id ASC')
    res.json({ ok: true, empresas, contas, produtos })
  } catch (error) { res.status(500).json({ ok: false, erro: error.message }) }
})

app.post('/api/empresas', podeGerenciarCadastros, async (req, res) => {
  try {
    const nome=String(req.body?.nome||'').trim(), cnpj=String(req.body?.cnpj||'').trim()||null, ativo=Number(req.body?.ativo!==false)
    if (!nome) throw new Error('Informe o nome da empresa.')
    const [r]=await db.query('INSERT INTO empresas (nome, cnpj, ativo) VALUES (?, ?, ?)', [nome, cnpj, ativo])
    res.status(201).json({ok:true,id:r.insertId})
  } catch(error){res.status(error?.code==='ER_DUP_ENTRY'?409:400).json({ok:false,erro:error.message})}
})
app.put('/api/empresas/:id', podeGerenciarCadastros, async (req,res)=>{try{const id=Number(req.params.id),nome=String(req.body?.nome||'').trim(),cnpj=String(req.body?.cnpj||'').trim()||null,ativo=Number(req.body?.ativo!==false);if(!id||!nome)throw new Error('Dados da empresa incompletos.');await db.query('UPDATE empresas SET nome=?, cnpj=?, ativo=?, atualizado_em=NOW() WHERE id=?',[nome,cnpj,ativo,id]);res.json({ok:true})}catch(error){res.status(400).json({ok:false,erro:error.message})}})

app.post('/api/contas-financeiras', podeGerenciarCadastros, async (req, res) => {
  const conn = await db.getConnection()
  try {
    const empresaId = Number(req.body?.empresa_id)
    const nome = String(req.body?.nome_conta || '').trim()
    const instituicao = String(req.body?.instituicao || '').trim() || null
    const tipo = String(req.body?.tipo || 'BANCARIA').toUpperCase()
    const agencia = String(req.body?.agencia || '').trim() || null
    const numero = String(req.body?.numero_conta || '').trim() || null
    const obs = String(req.body?.observacoes || '').trim() || null
    const ativo = Number(req.body?.ativo !== false)
    if (!empresaId || !nome) throw new Error('Informe empresa e nome da conta.')

    await conn.beginTransaction()
    const [r] = await conn.query(
      'INSERT INTO contas_bancarias (empresa_id,instituicao,tipo,nome_conta,agencia,numero_conta,observacoes,ativo) VALUES (?,?,?,?,?,?,?,?)',
      [empresaId, instituicao, tipo, nome, agencia, numero, obs, ativo]
    )
    if (ativo) await garantirMapeamentosContasFinanceiras(conn, empresaId)
    await conn.commit()
    res.status(201).json({ ok: true, id: r.insertId })
  } catch (error) {
    try { await conn.rollback() } catch (_) {}
    res.status(error?.code === 'ER_DUP_ENTRY' ? 409 : 400).json({ ok: false, erro: error.message })
  } finally {
    conn.release()
  }
})
app.put('/api/contas-financeiras/:id', podeGerenciarCadastros, async (req, res) => {
  const conn = await db.getConnection()
  try {
    const id = Number(req.params.id)
    const empresaId = Number(req.body?.empresa_id)
    const nome = String(req.body?.nome_conta || '').trim()
    const instituicao = String(req.body?.instituicao || '').trim() || null
    const tipo = String(req.body?.tipo || 'BANCARIA').toUpperCase()
    const agencia = String(req.body?.agencia || '').trim() || null
    const numero = String(req.body?.numero_conta || '').trim() || null
    const obs = String(req.body?.observacoes || '').trim() || null
    const ativo = Number(req.body?.ativo !== false)
    if (!id || !empresaId || !nome) throw new Error('Dados da conta incompletos.')

    await conn.beginTransaction()
    await conn.query(
      'UPDATE contas_bancarias SET empresa_id=?,instituicao=?,tipo=?,nome_conta=?,agencia=?,numero_conta=?,observacoes=?,ativo=?,atualizado_em=NOW() WHERE id=?',
      [empresaId, instituicao, tipo, nome, agencia, numero, obs, ativo, id]
    )
    if (ativo) await garantirMapeamentosContasFinanceiras(conn, empresaId)
    await conn.commit()
    res.json({ ok: true })
  } catch (error) {
    try { await conn.rollback() } catch (_) {}
    res.status(400).json({ ok: false, erro: error.message })
  } finally {
    conn.release()
  }
})

app.post('/api/produtos', podeGerenciarCadastros, async (req,res)=>{try{const nome=String(req.body?.nome||'').trim(),tipo=String(req.body?.tipo||'COMBUSTIVEL').trim().toUpperCase(),unidade=String(req.body?.unidade||'L').trim().toUpperCase(),ativo=Number(req.body?.ativo!==false);if(!nome)throw new Error('Informe o nome do produto.');const [r]=await db.query('INSERT INTO produtos (nome,tipo,unidade,ativo) VALUES (?,?,?,?)',[nome,tipo,unidade,ativo]);res.status(201).json({ok:true,id:r.insertId})}catch(error){res.status(error?.code==='ER_DUP_ENTRY'?409:400).json({ok:false,erro:error.message})}})
app.put('/api/produtos/:id', podeGerenciarCadastros, async (req,res)=>{try{const id=Number(req.params.id),nome=String(req.body?.nome||'').trim(),tipo=String(req.body?.tipo||'COMBUSTIVEL').trim().toUpperCase(),unidade=String(req.body?.unidade||'L').trim().toUpperCase(),ativo=Number(req.body?.ativo!==false);if(!id||!nome)throw new Error('Dados do produto incompletos.');await db.query('UPDATE produtos SET nome=?,tipo=?,unidade=?,ativo=?,atualizado_em=NOW() WHERE id=?',[nome,tipo,unidade,ativo,id]);res.json({ok:true})}catch(error){res.status(400).json({ok:false,erro:error.message})}})

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'docs', 'index.html'))
})

async function iniciarServidor() {
  try {
    await garantirPermissaoNumeroLancamento()
  } catch (error) {
    console.error('Erro na migração da permissão Número de Lançamento:', error)
    process.exitCode = 1
    return
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`)
    migrarContasFinanceiras().catch((error) => {
      console.error('Migração não bloqueante de contas financeiras:', error)
    })
  })
}

iniciarServidor()