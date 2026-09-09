/**
 * Os 7 setores da tabela de `docs/GAME_DESIGN.md §3.7`.
 *
 * `multipleBase` é o múltiplo de lucro pago pelo mercado com a Selic na
 * referência de 10%; ele encolhe quando a Selic sobe (ver `sectorMultiple` em
 * `src/engine/market.ts`). `rateSensitivity` é o quanto o **resultado** do setor
 * sofre com juro alto — coisa diferente do múltiplo, que é precificação.
 */

export interface IndustryDefinition {
  id: string
  name: string
  multipleBase: number
  /** Desvio-padrão do retorno diário da ação. */
  volatility: number
  /** Margem operacional de referência do setor. */
  baseMargin: number
  taxRate: number
  /** 0 a 1: quanto o lucro do setor encolhe quando a Selic sobe. */
  rateSensitivity: number
  /** Receita anual agregada do setor, em R$ do ano 0. */
  marketSize: number
  /** Crescimento real anual de tendência do setor. */
  realGrowth: number
  /** Receita anual por funcionário, em R$ do ano 0. Define a capacidade. */
  outputPerEmployee: number
  /** Fração da receita que vai para a folha em operação normal. */
  payrollRatio: number
  /** Giro do ativo: receita anual por real de capital instalado. */
  capitalTurnover: number
  /** Multiplicador de demanda por mês (jan a dez). */
  seasonality: number[]
}

const FLAT = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]

export const INDUSTRIES: IndustryDefinition[] = [
  {
    id: 'tecnologia',
    capitalTurnover: 1.0,
    outputPerEmployee: 800000,
    payrollRatio: 0.35,
    realGrowth: 0.06,
    name: 'Tecnologia',
    multipleBase: 22,
    volatility: 0.028,
    baseMargin: 0.22,
    taxRate: 0.34,
    rateSensitivity: 0.7,
    marketSize: 18e9,
    seasonality: FLAT,
  },
  {
    id: 'saude',
    capitalTurnover: 1.2,
    outputPerEmployee: 400000,
    payrollRatio: 0.3,
    realGrowth: 0.035,
    name: 'Saúde',
    multipleBase: 18,
    volatility: 0.016,
    baseMargin: 0.14,
    taxRate: 0.34,
    rateSensitivity: 0.3,
    marketSize: 22e9,
    seasonality: [1.05, 1.02, 1, 1, 1, 1.05, 1.08, 1.06, 1, 0.97, 0.95, 0.97],
  },
  {
    id: 'varejo',
    capitalTurnover: 3.0,
    outputPerEmployee: 350000,
    payrollRatio: 0.12,
    realGrowth: 0.02,
    name: 'Varejo',
    multipleBase: 12,
    volatility: 0.02,
    baseMargin: 0.07,
    taxRate: 0.34,
    rateSensitivity: 0.8,
    // Dezembro carrega o ano inteiro do varejo.
    seasonality: [0.85, 0.82, 0.9, 0.95, 1.02, 0.95, 0.98, 0.98, 1, 1.05, 1.15, 1.45],
    marketSize: 45e9,
  },
  {
    id: 'midia',
    capitalTurnover: 1.5,
    outputPerEmployee: 500000,
    payrollRatio: 0.28,
    realGrowth: 0.005,
    name: 'Mídia',
    multipleBase: 11,
    volatility: 0.024,
    baseMargin: 0.1,
    taxRate: 0.25,
    rateSensitivity: 0.6,
    marketSize: 6e9,
    seasonality: FLAT,
  },
  {
    id: 'energia',
    capitalTurnover: 0.5,
    outputPerEmployee: 1500000,
    payrollRatio: 0.1,
    realGrowth: 0.025,
    name: 'Energia',
    multipleBase: 9,
    volatility: 0.019,
    baseMargin: 0.18,
    taxRate: 0.3,
    rateSensitivity: 0.4,
    marketSize: 30e9,
    seasonality: [1.05, 1.05, 1, 0.97, 0.95, 1, 1.08, 1.06, 1, 0.97, 0.98, 1.02],
  },
  {
    id: 'bancos',
    capitalTurnover: 2.0,
    outputPerEmployee: 900000,
    payrollRatio: 0.22,
    realGrowth: 0.03,
    name: 'Bancos',
    multipleBase: 8,
    volatility: 0.018,
    baseMargin: 0.28,
    taxRate: 0.34,
    // Banco ganha com juro alto: a sensibilidade entra com sinal invertido em
    // `cycleEarningsFactor`.
    rateSensitivity: -0.9,
    marketSize: 40e9,
    seasonality: FLAT,
  },
  {
    id: 'mineracao',
    capitalTurnover: 0.6,
    outputPerEmployee: 1800000,
    payrollRatio: 0.09,
    realGrowth: 0.015,
    name: 'Mineração',
    multipleBase: 7,
    volatility: 0.026,
    baseMargin: 0.2,
    taxRate: 0.34,
    rateSensitivity: 0.5,
    marketSize: 25e9,
    seasonality: FLAT,
  },
]

export function findIndustry(id: string): IndustryDefinition | null {
  return INDUSTRIES.find((industry) => industry.id === id) ?? null
}
