/**
 * Derivações do estado. TypeScript puro, sem memoização (o estado é imutável e a
 * UI recalcula por render). Só entra aqui o que tem pelo menos dois consumidores
 * concretos hoje (spec §10.6).
 */
import type { GameState } from './types'
import { real } from './macro'
import { valuationOf } from './companies'
import { sectorMultiple } from './market'
import { findIndustry } from '../data/industries'

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

/** Patrimônio em R$ do ano 0 — a única medida comparável ao longo de 47 anos. */
export function realNetWorth(state: GameState): number {
  return real(state.macro, netWorth(state))
}
