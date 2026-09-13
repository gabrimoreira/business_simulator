/**
 * O demonstrativo da empresa: para onde vai o dinheiro, e o que segura a receita.
 *
 * Duas perguntas que o jogo não respondia. O card mostrava receita, lucro,
 * caixa e quadro, mas nenhuma linha dizia **por que** o lucro era aquele nem
 * **o que impede** a receita de crescer — e quando a empresa começava a afundar,
 * não havia aviso antes da recuperação judicial.
 *
 * Refaz a mesma conta de `stepCompanyDay` (`engine/companies.ts`), em base
 * anual. Não é uma segunda fórmula: é a mesma, e há teste cobrando que o lucro
 * daqui bata com o que o motor produz. Demonstrativo que não fecha com o caixa
 * é pior que nenhum.
 */
import type { Company, GameState, Money } from '@/engine/types'
import type { IndustryDefinition } from '@/data/industries'
import { capacityOf, debtInterest, unitCost } from '@/engine/companies'
import { MARKET } from '@/data/config'

export interface StatementLine {
  label: string
  amount: Money
  hint?: string
}

export type Bottleneck = 'mão de obra' | 'capital' | 'demanda'

export interface CompanyStatement {
  lines: StatementLine[]
  profit: Money
  /** Capacidade anual instalada, e o que a está segurando. */
  capacity: number
  bottleneck: Bottleneck
  /** Capital que cada funcionário a mais exige, no giro do setor. */
  capitalPerHead: Money
  /** Trimestres de caixa negativo e quantos faltam para a recuperação judicial. */
  negativeQuarters: number
  quartersToBankruptcy: number
}

export function statementFor(
  state: GameState,
  company: Company,
  industry: IndustryDefinition,
): CompanyStatement {
  const revenue = company.revenue
  const price = company.price * state.macro.priceLevel
  // `units` a partir da receita: é a grandeza que `stepCompanyDay` usa para o
  // custo variável, e derivá-la aqui evita guardar um campo só para a tela.
  const units = price > 0 ? revenue / price : 0

  const variable = units * unitCost(industry, company) * state.macro.priceLevel
  const payroll = company.workforce.headcount * company.workforce.avgSalary
  const marketing = revenue * company.directives.marketingRatio
  const rnd = revenue * company.directives.rndRatio
  const interest = debtInterest(state, company)
  const pretax = revenue - variable - payroll - marketing - rnd - interest
  const taxRate = state.industries[industry.id]?.taxRate ?? industry.taxRate
  const tax = pretax > 0 ? pretax * taxRate : 0

  const lines: StatementLine[] = [
    { label: 'Receita', amount: revenue },
    { label: 'Custo do produto', amount: -variable, hint: 'insumos e produção' },
    { label: 'Folha', amount: -payroll, hint: `${Math.round(company.workforce.headcount)} pessoas` },
    { label: 'Marketing', amount: -marketing, hint: 'diretriz' },
    { label: 'P&D', amount: -rnd, hint: 'diretriz' },
  ]
  if (interest > 0) lines.push({ label: 'Juros da dívida', amount: -interest })
  if (tax > 0) lines.push({ label: 'Imposto', amount: -tax, hint: `${Math.round(taxRate * 100)}%` })

  // Os dois lados da capacidade, como `capacityOf` os calcula.
  const productivity = company.workforce.productivity / 100
  const labor = company.workforce.headcount * industry.outputPerEmployee * productivity
  const fromCapital = company.capitalStock * industry.capitalTurnover
  const capacity = capacityOf(company, industry)

  // Se a produção cabe folgada na capacidade, quem limita é a demanda: não
  // adianta contratar nem comprar máquina.
  const bottleneck: Bottleneck =
    capacity > 0 && units * state.macro.priceLevel < capacity * 0.9
      ? 'demanda'
      : labor <= fromCapital
        ? 'mão de obra'
        : 'capital'

  return {
    lines,
    profit: pretax - tax,
    capacity,
    bottleneck,
    capitalPerHead: (industry.outputPerEmployee * productivity) / industry.capitalTurnover,
    negativeQuarters: company.quartersNegativeCash,
    quartersToBankruptcy: MARKET.quartersToBankruptcy,
  }
}
