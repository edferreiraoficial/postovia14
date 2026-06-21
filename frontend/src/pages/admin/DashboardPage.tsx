import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || 'https://postovia14.com.br'

type ProdutoResumo = {
  produto: string
  quantidade: number
  receita: number
}

type ResumoData = {
  receitaTotal: number
  quantidadeTotal: number
  comprasTotal: number
  saldoFinanceiro: number
  produtos: ProdutoResumo[]
}

type MensalRow = {
  mes: string
  produto: string
  quantidade: number
  receita: number
  preco_medio: number
}

type FinanceiroData = {
  entradas: { origem: string; total: number }[]
  saidas: { origem: string; total: number }[]
  saldo: number
}

type Competencia = {
  codigo: string
  ano: number
  mes: number
}

const PRODUTOS = ['GASOLINA', 'ETANOL', 'DIESEL']

const COLORS: Record<string, string> = {
  GASOLINA: '#FBBF24',
  ETANOL: '#84CC16',
  DIESEL: '#F97316',
}

const fmtBRL = (value: number) =>
  Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })

const fmtNum = (value: number) =>
  Math.round(Number(value || 0)).toLocaleString('pt-BR')

const normalizarProduto = (produto: string) =>
  String(produto || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

async function apiGet<T>(endpoint: string): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`)

  if (!res.ok) {
    throw new Error(`Erro na API: ${res.status}`)
  }

  const json = await res.json()

  if (!json.ok) {
    throw new Error(json.erro || 'Erro ao carregar dados')
  }

  return json
}

function MonthlyChart({ dados }: { dados: MensalRow[] }) {
  const width = 900
  const height = 360
  const padL = 56
  const padR = 18
  const padT = 20
  const padB = 58
  const chartW = width - padL - padR
  const chartH = height - padT - padB

  const meses = Array.from(new Set(dados.map((item) => item.mes))).sort()

  const porMes = meses.map((mes) => {
    const base: Record<string, number | string> = { mes }

    for (const produto of PRODUTOS) {
      const item = dados.find(
        (row) => row.mes === mes && normalizarProduto(row.produto).includes(produto)
      )

      base[produto] = Number(item?.receita || 0)
    }

    return base
  })

  const max =
    Math.max(
      ...porMes.flatMap((month) =>
        PRODUTOS.map((produto) => Number(month[produto] || 0))
      ),
      1
    ) * 1.15

  const groupW = chartW / Math.max(porMes.length, 1)
  const barW = Math.min(24, groupW / 5)

  return (
    <svg
      className="db-chart"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Receita mensal por produto"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
        const y = padT + chartH * (1 - tick)

        return (
          <g key={tick}>
            <line
              x1={padL}
              y1={y}
              x2={width - padR}
              y2={y}
              stroke="#E5E7EB"
              strokeWidth="1"
            />
            <text x="8" y={y + 4} fill="#64748B" fontSize="11">
              {fmtBRL(max * tick).replace(',00', '')}
            </text>
          </g>
        )
      })}

      {porMes.map((month, index) => {
        const gx = padL + index * groupW + groupW / 2

        return (
          <g key={`${month.mes}-${index}`}>
            {PRODUTOS.map((produto, produtoIndex) => {
              const value = Number(month[produto] || 0)
              const barH = chartH * (value / max)
              const x = gx + (produtoIndex - 1) * barW * 1.2 - barW / 2
              const y = padT + chartH - barH

              return (
                <rect
                  key={produto}
                  x={x}
                  y={y}
                  width={barW}
                  height={barH}
                  rx="6"
                  fill={COLORS[produto]}
                />
              )
            })}

            <text
              x={gx}
              y={height - 28}
              fill="#64748B"
              fontSize="11"
              textAnchor="middle"
            >
              {String(month.mes)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function DonutChart({ produtos }: { produtos: ProdutoResumo[] }) {
  const total = produtos.reduce((sum, item) => sum + Number(item.receita || 0), 0) || 1

  let start = -90
  const cx = 180
  const cy = 165
  const radius = 100
  const strokeWidth = 46

  return (
    <svg className="db-chart db-donut" viewBox="0 0 360 360" role="img">
      {produtos.map((item) => {
        const produto = normalizarProduto(item.produto)
        const cor =
          produto.includes('GASOLINA') ? COLORS.GASOLINA :
          produto.includes('ETANOL') ? COLORS.ETANOL :
          produto.includes('DIESEL') ? COLORS.DIESEL :
          '#4682B4'

        const value = Number(item.receita || 0)

        if (!value) return null

        const percentage = value / total
        const end = start + percentage * 360
        const largeArc = end - start > 180 ? 1 : 0
        const sr = (Math.PI * start) / 180
        const er = (Math.PI * end) / 180

        const path = `M ${cx + radius * Math.cos(sr)} ${cy + radius * Math.sin(sr)}
          A ${radius} ${radius} 0 ${largeArc} 1
          ${cx + radius * Math.cos(er)} ${cy + radius * Math.sin(er)}`

        start = end

        return (
          <path
            key={item.produto}
            d={path}
            fill="none"
            stroke={cor}
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
          />
        )
      })}

      <circle cx={cx} cy={cy} r="55" fill="#fff" />
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="18" fontWeight="800" fill="#111827">
        {fmtBRL(total).replace(',00', '')}
      </text>
      <text x={cx} y={cy + 18} textAnchor="middle" fontSize="12" fill="#64748B">
        Receita total
      </text>
    </svg>
  )
}

export default function DashboardPage() {
  const [resumo, setResumo] = useState<ResumoData | null>(null)
  const [mensal, setMensal] = useState<MensalRow[]>([])
  const [financeiro, setFinanceiro] = useState<FinanceiroData | null>(null)
  const [competencias, setCompetencias] = useState<Competencia[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function carregar() {
      try {
        setLoading(true)

        const [resumoJson, mensalJson, financeiroJson, competenciasJson] =
          await Promise.all([
            apiGet<{ resumo: ResumoData }>('/api/dashboard/resumo'),
            apiGet<{ dados: MensalRow[] }>('/api/dashboard/mensal'),
            apiGet<FinanceiroData>('/api/dashboard/financeiro'),
            apiGet<{ competencias: Competencia[] }>('/api/competencias'),
          ])

        setResumo(resumoJson.resumo)
        setMensal(mensalJson.dados || [])
        setFinanceiro(financeiroJson)
        setCompetencias(competenciasJson.competencias || [])
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar dashboard')
      } finally {
        setLoading(false)
      }
    }

    carregar()
  }, [])

  const produtos = resumo?.produtos || []

  const totalEntradas = useMemo(
    () => financeiro?.entradas?.reduce((sum, item) => sum + Number(item.total || 0), 0) || 0,
    [financeiro]
  )

  const totalSaidas = useMemo(
    () => financeiro?.saidas?.reduce((sum, item) => sum + Number(item.total || 0), 0) || 0,
    [financeiro]
  )

  if (loading) {
    return (
      <div className="db-dashboard">
        <section className="db-hero-card">
          <div>
            <span className="db-kicker">Área Administrativa</span>
            <h1>Carregando dashboard...</h1>
            <p>Buscando dados do MySQL.</p>
          </div>
        </section>
      </div>
    )
  }

  if (error) {
    return (
      <div className="db-dashboard">
        <section className="db-hero-card">
          <div>
            <span className="db-kicker">Área Administrativa</span>
            <h1>Dashboard de Vendas</h1>
            <p>{error}</p>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="db-dashboard">
      <section className="db-hero-card">
        <div>
          <span className="db-kicker">Área Administrativa</span>
          <h1>Dashboard Posto Via 14</h1>
          <p>Dados carregados diretamente do banco MySQL.</p>
        </div>

        <div className="db-hero-badge">
          {competencias.length} competências
        </div>
      </section>

      <section id="visao" className="db-section">
        <div className="db-section-title">
          <h2>Visão Geral</h2>
          <span>Resumo financeiro e operacional</span>
        </div>

        <div className="db-kpi-grid">
          <article className="db-product-card" style={{ '--product-color': '#4682B4' } as CSSProperties}>
            <div className="db-product-head">
              <strong>Receita Total</strong>
              <span />
            </div>
            <div className="db-kpi-list">
              <div className="db-kpi db-kpi-full">
                <label>Vendas</label>
                <strong>{fmtBRL(resumo?.receitaTotal || 0)}</strong>
                <small>Total vindo do LMC</small>
              </div>
            </div>
          </article>

          <article className="db-product-card" style={{ '--product-color': '#84CC16' } as CSSProperties}>
            <div className="db-product-head">
              <strong>Litros Vendidos</strong>
              <span />
            </div>
            <div className="db-kpi-list">
              <div className="db-kpi db-kpi-full">
                <label>Litros</label>
                <strong>{fmtNum(resumo?.quantidadeTotal || 0)}</strong>
                <small>Total de litros vendidos</small>
              </div>
            </div>
          </article>

          <article className="db-product-card" style={{ '--product-color': '#F97316' } as CSSProperties}>
            <div className="db-product-head">
              <strong>Compras</strong>
              <span />
            </div>
            <div className="db-kpi-list">
              <div className="db-kpi db-kpi-full">
                <label>Total comprado</label>
                <strong>{fmtBRL(resumo?.comprasTotal || 0)}</strong>
                <small>Notas de compras importadas</small>
              </div>
            </div>
          </article>

          <article className="db-product-card" style={{ '--product-color': '#111827' } as CSSProperties}>
            <div className="db-product-head">
              <strong>Saldo Financeiro</strong>
              <span />
            </div>
            <div className="db-kpi-list">
              <div className="db-kpi db-kpi-full">
                <label>Extratos</label>
                <strong>{fmtBRL(resumo?.saldoFinanceiro || 0)}</strong>
                <small>SPOT + ITAÚ</small>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section className="db-section">
        <div className="db-section-title">
          <h2>Produtos</h2>
          <span>KPIs por combustível</span>
        </div>

        <div className="db-grid-3">
          {produtos.map((item) => {
            const produtoNorm = normalizarProduto(item.produto)
            const cor =
              produtoNorm.includes('GASOLINA') ? COLORS.GASOLINA :
              produtoNorm.includes('ETANOL') ? COLORS.ETANOL :
              produtoNorm.includes('DIESEL') ? COLORS.DIESEL :
              '#4682B4'

            const ticket =
              Number(item.quantidade || 0) > 0
                ? Number(item.receita || 0) / Number(item.quantidade || 0)
                : 0

            return (
              <article
                className="db-product-card"
                style={{ '--product-color': cor } as CSSProperties}
                key={item.produto}
              >
                <div className="db-product-head">
                  <strong>{item.produto}</strong>
                  <span />
                </div>

                <div className="db-kpi-list">
                  <div className="db-kpi db-kpi-full">
                    <label>Receita</label>
                    <strong>{fmtBRL(item.receita)}</strong>
                    <small>Total vendido</small>
                  </div>

                  <div className="db-kpi">
                    <label>Litros</label>
                    <strong>{fmtNum(item.quantidade)}</strong>
                    <small>Litros vendidos</small>
                  </div>

                  <div className="db-kpi">
                    <label>Preço Médio</label>
                    <strong>{fmtBRL(ticket)}</strong>
                    <small>Receita ÷ litros</small>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section id="analises" className="db-section">
        <div className="db-section-title">
          <h2>Análises de Vendas</h2>
          <span>Receita mensal por produto</span>
        </div>

        <div className="db-grid-2">
          <article className="db-panel">
            <h3>Gráfico de receita por mês</h3>
            <p>Colunas comparativas de Gasolina, Etanol e Diesel.</p>

            <MonthlyChart dados={mensal} />

            <div className="db-legend">
              {PRODUTOS.map((produto) => (
                <span key={produto}>
                  <i style={{ background: COLORS[produto] }} />
                  {produto}
                </span>
              ))}
            </div>
          </article>

          <article className="db-panel">
            <h3>Participação por produto</h3>
            <p>Distribuição da receita total.</p>

            <DonutChart produtos={produtos} />

            <table className="db-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Receita</th>
                  <th>Part.</th>
                </tr>
              </thead>

              <tbody>
                {produtos.map((item) => {
                  const part =
                    resumo?.receitaTotal
                      ? (Number(item.receita || 0) / resumo.receitaTotal) * 100
                      : 0

                  return (
                    <tr key={item.produto}>
                      <td>{item.produto}</td>
                      <td>{fmtBRL(item.receita)}</td>
                      <td>{part.toFixed(1)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </article>
        </div>
      </section>

      <section className="db-section">
        <div className="db-section-title">
          <h2>Financeiro</h2>
          <span>Entradas e saídas dos extratos bancários</span>
        </div>

        <div className="db-grid-3">
          <article className="db-panel">
            <h3>Entradas</h3>
            <strong>{fmtBRL(totalEntradas)}</strong>

            <table className="db-table db-simple-table">
              <tbody>
                {financeiro?.entradas?.map((item) => (
                  <tr key={item.origem}>
                    <td>{item.origem}</td>
                    <td>{fmtBRL(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <article className="db-panel">
            <h3>Saídas</h3>
            <strong>{fmtBRL(totalSaidas)}</strong>

            <table className="db-table db-simple-table">
              <tbody>
                {financeiro?.saidas?.map((item) => (
                  <tr key={item.origem}>
                    <td>{item.origem}</td>
                    <td>{fmtBRL(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <article className="db-panel db-dark-panel">
            <h3>Saldo</h3>
            <p>Resultado consolidado dos extratos.</p>
            <div className="db-total-proj">
              {fmtBRL(financeiro?.saldo || 0)}
            </div>
          </article>
        </div>
      </section>
    </div>
  )
}