/**
 * Derivações do estado. TypeScript puro, sem memoização (o estado é imutável e a
 * UI recalcula por render). Só entra aqui o que tem pelo menos dois consumidores
 * concretos hoje (spec §10.6).
 */
import type { GameState, Money } from './types'
import { nominal, real } from './macro'
import { valuationOf } from './companies'
import { sectorMultiple } from './market'
import { findIndustry } from '../data/industries'
import { MONTHLY_BILLS } from '../data/living'
import { findAsset } from '../data/assets'
import { CAREER } from '../data/config'

/** Caixa em conta corrente + aplicações, somando todos os bancos. */
export function bankBalance(state: GameState): number {
  let total = 0
  for (const account of state.banking.accounts) {
    total += account.checking + account.savings
  }
  return total
}

/** Valor de mercado da carteira de ações, a preço de fechamento de hoje. */
export function portfolioValue(state: GameState): number {
  let total = 0
  for (const companyId of state.market.positionOrder) {
    const position = state.market.positions[companyId]
    const company = state.companies[companyId]
    if (!position || !company?.stock) continue
    total += position.shares * company.stock.price
  }
  return total
}

/**
 * Valor das empresas privadas do jogador, pela participação que ele detém.
 *
 * Avalia pelo **mesmo `valuationOf` que `venderEmpresa` usa** — lucro anualizado
 * vezes o múltiplo do setor, com piso na receita. Antes valia `caixa − dívida`,
 * o saldo da conta corrente da empresa: uma companhia com R$ 312 milhões de
 * receita e R$ 37 milhões de capital entrava no patrimônio do dono pelo que
 * tivesse no banco naquele dia.
 *
 * Isso não era só um número baixo, era uma arbitragem: vender rendia bilhões e
 * possuir rendia dezenas de milhões, então a jogada ótima era vender a empresa
 * todo dia e recomprá-la. Patrimônio é o que você consegue por aquilo — a mesma
 * conta dos dois lados.
 */
export function privateHoldingsValue(state: GameState): number {
  let total = 0
  for (const companyId of state.companyOrder) {
    const company = state.companies[companyId]
    if (!company || company.isPublic) continue
    const industry = findIndustry(company.industryId)
    if (!industry) continue
    const shares = company.ownership.reduce(
      (sum, entry) => (entry.holderId === 'player' ? sum + entry.shares : sum),
      0,
    )
    const totalShares = company.ownership.reduce((sum, entry) => sum + entry.shares, 0)
    if (totalShares <= 0) continue
    const value = valuationOf(company, sectorMultiple(industry.multipleBase, state.macro.selic))
    total += (shares / totalShares) * value
  }
  return total
}

/** Soma das dívidas pessoais: empréstimos, cartão e pendência de imposto. */
export function totalDebt(state: GameState): number {
  let total = 0
  for (const loan of state.banking.loans) {
    if (loan.borrower === 'player') total += loan.remaining
  }
  for (const card of state.banking.cards) total += card.balance
  for (const debt of state.market.taxDebts) total += debt.amount + debt.penalty
  return total
}

/** Patrimônio líquido. */
export function netWorth(state: GameState): number {
  const assets = state.personalAssets.assets.reduce((sum, asset) => sum + asset.currentValue, 0)
  return (
    state.player.money +
    bankBalance(state) +
    portfolioValue(state) +
    privateHoldingsValue(state) +
    assets -
    totalDebt(state)
  )
}

/** Renda diária recorrente: salário rateado + aluguéis recebidos. */
export function dailyIncome(state: GameState): number {
  const salary = state.player.career.salary / 30
  const rents = state.personalAssets.assets.reduce((sum, asset) => sum + asset.monthlyIncome / 30, 0)
  return salary + rents
}

/** Uma linha do extrato: de onde vem, ou para onde vai. */
export interface BudgetLine {
  label: string
  amount: Money
}

export interface MonthlyBudget {
  income: BudgetLine[]
  expenses: BudgetLine[]
  totalIncome: Money
  totalExpenses: Money
  net: Money
}

/**
 * O extrato do mês: o que entra e o que sai, discriminado.
 *
 * Existe porque o jogo tem treze fluxos de dinheiro e a interface mostrava dois
 * números — caixa e patrimônio — mais um log cronológico. As saídas grandes são
 * **automáticas e em dias fixos** (salário no 5, contas no 10), e o débito tira
 * da conta corrente antes do caixa, então o número do topo caía sozinho sem o
 * jogador ter clicado em nada.
 *
 * Só entra aqui o que é **recorrente e previsível**. Compra de ação, venda de
 * empresa e empréstimo são eventos, não orçamento: mostrá-los aqui faria o saldo
 * do mês oscilar sem significar nada.
 *
 * Tudo em nominal de hoje, que é a moeda em que o caixa é exibido.
 */
export function monthlyBudget(state: GameState): MonthlyBudget {
  const income: BudgetLine[] = []
  const expenses: BudgetLine[] = []

  if (state.player.career.salary > 0) {
    income.push({ label: 'Salário', amount: state.player.career.salary })
  }

  // Aluguel e manutenção saem da **definição**, com `nominal` por cima — é
  // exatamente o que `stepAssets` faz na virada do mês. Ler o campo guardado no
  // estado daria outro número, e um extrato que não bate com o caixa é pior que
  // não ter extrato.
  let rents = 0
  let upkeep = 0
  for (const asset of state.personalAssets.assets) {
    const definition = findAsset(asset.assetId)
    if (!definition) continue
    if (!asset.isResidence) rents += nominal(state.macro, definition.monthlyIncome)
    upkeep += nominal(state.macro, definition.upkeep)
  }
  if (rents > 0) income.push({ label: 'Aluguéis', amount: rents })

  // Moradia sai do estado e não da tabela: mudar de residência muda o aluguel.
  const housing = nominal(state.macro, state.personalAssets.monthlyRent)
  if (housing > 0) expenses.push({ label: 'Moradia', amount: housing })
  expenses.push({
    label: 'Transporte e saúde',
    amount: nominal(state.macro, MONTHLY_BILLS.transport + MONTHLY_BILLS.health),
  })

  if (upkeep > 0) expenses.push({ label: 'Manutenção de bens', amount: upkeep })

  // Parcela é diária no motor; aqui vira mensal para caber na mesma régua.
  const loans = state.banking.loans.reduce(
    (sum, loan) => (loan.borrower === 'player' ? sum + loan.dailyPayment * 30 : sum),
    0,
  )
  if (loans > 0) expenses.push({ label: 'Parcelas de empréstimo', amount: loans })

  const subscriptions = state.market.subscriptions.reduce(
    (sum, item) => sum + nominal(state.macro, item.monthlyCost),
    0,
  )
  if (subscriptions > 0) expenses.push({ label: 'Assinaturas', amount: subscriptions })

  const totalIncome = income.reduce((sum, line) => sum + line.amount, 0)
  const totalExpenses = expenses.reduce((sum, line) => sum + line.amount, 0)
  return { income, expenses, totalIncome, totalExpenses, net: totalIncome - totalExpenses }
}

/**
 * Quantos dias faltam para o próximo evento de dinheiro, e qual é.
 *
 * Salário e contas caem em dia fixo do mês. Sem isto o jogador via o caixa
 * despencar no dia 10 sem entender por quê.
 */
export function nextMoneyEvent(state: GameState): { label: string; days: number } {
  const today = state.date.day
  const until = (target: number): number => (target >= today ? target - today : 30 - today + target)
  const payday = until(CAREER.paydayDay)
  const bills = until(CAREER.billsDay)
  return payday <= bills
    ? { label: 'salário', days: payday }
    : { label: 'contas', days: bills }
}

/** Patrimônio em R$ do ano 0 — a única medida comparável ao longo de 47 anos. */
export function realNetWorth(state: GameState): number {
  return real(state.macro, netWorth(state))
}
