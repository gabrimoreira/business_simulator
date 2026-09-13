/**
 * O que é seu, junto num lugar só.
 *
 * O jogo tem sete tipos de coisa que o jogador possui e cada uma mora numa tela
 * diferente: ação aparece como uma linha dentro da lista de *todas* as empresas
 * da bolsa, bem fica no Mundo entre banco e política, empresa em Negócios,
 * jornal dentro do painel de imprensa, dívida em lugar nenhum. Nada respondia
 * "o que eu tenho" — foi a queixa do playtest.
 *
 * **O invariante que faz isto valer alguma coisa:** a soma dos grupos bate com
 * `netWorth` ao centavo. É a mesma disciplina do extrato pessoal (`ledger.ts`) e
 * do demonstrativo da empresa (`companyStatement.ts`) — quadro que não fecha com
 * o caixa é pior que nenhum. `tests/holdings.spec.ts` cobra isso, então um
 * sistema novo que passe a valer dinheiro e não apareça aqui derruba o teste em
 * vez de aparecer como diferença silenciosa na tela.
 *
 * Dado puro, sem Vue e sem DOM, pelo mesmo motivo dos outros dois: a regra de
 * classificação é o que erra, e regra que erra precisa de teste.
 */
import type { GameState, Money } from '@/engine/types'
import {
  bankBalance,
  outletPrice,
  portfolioValue,
  privateHoldingsValue,
  totalDebt,
} from '@/engine/selectors'
import { valuationOf } from '@/engine/companies'
import { sectorMultiple } from '@/engine/market'
import { findIndustry } from '@/data/industries'
import { findBank } from '@/data/banks'

/** Para onde a linha leva, quando há onde agir sobre ela. */
export type HoldingRoute = '/mercado' | '/negocios' | '/mundo' | null

export interface HoldingLine {
  id: string
  label: string
  /** Quanto vale hoje. Negativo em dívida. */
  value: Money
  /** Uma linha de contexto: quantidade, preço médio, aluguel, prazo. */
  detail?: string
  /** Resultado não realizado, quando faz sentido (ações). */
  change?: number
  route: HoldingRoute
}

export interface HoldingGroup {
  label: string
  total: Money
  lines: HoldingLine[]
  /** Explica o que o grupo é, para quem abriu a tela pela primeira vez. */
  hint: string
}

export interface Holdings {
  groups: HoldingGroup[]
  /** Soma de tudo que vale dinheiro, antes das dívidas. */
  assets: Money
  /** Dívidas, negativo. */
  debts: Money
  /** `assets + debts`. Igual a `netWorth(state)`, e há teste. */
  total: Money
}

export function holdingsFor(state: GameState): Holdings {
  const groups: HoldingGroup[] = []

  // --- caixa ---------------------------------------------------------------
  if (state.player.money !== 0) {
    groups.push({
      label: 'Caixa',
      total: state.player.money,
      hint: 'Dinheiro na mão. É daqui que sai comida e conta do dia a dia.',
      lines: [
        { id: 'caixa', label: 'Dinheiro vivo', value: state.player.money, route: null },
      ],
    })
  }

  // --- contas e aplicações -------------------------------------------------
  const contas: HoldingLine[] = []
  for (const account of state.banking.accounts) {
    const bank = findBank(account.bankId)
    const nome = bank?.name ?? account.bankId
    if (account.checking !== 0) {
      contas.push({
        id: `cc-${account.bankId}`,
        label: `${nome} — conta`,
        value: account.checking,
        detail: 'saque imediato',
        route: '/mundo',
      })
    }
    if (account.savings !== 0) {
      const locked =
        account.savingsLockedUntilDayIndex !== null &&
        state.date.dayIndex < account.savingsLockedUntilDayIndex
      contas.push({
        id: `ap-${account.bankId}`,
        label: `${nome} — aplicado`,
        value: account.savings,
        detail: locked
          ? `preso por mais ${account.savingsLockedUntilDayIndex! - state.date.dayIndex} d`
          : 'resgate livre',
        route: '/mundo',
      })
    }
  }
  if (contas.length > 0) {
    groups.push({
      label: 'Contas e aplicações',
      total: bankBalance(state),
      hint: 'O que está no banco. A aplicação rende, mas pode estar presa na carência.',
      lines: contas,
    })
  }

  // --- ações ---------------------------------------------------------------
  // O `shortShares` fica de fora do valor de propósito: `portfolioValue` também
  // o ignora, e o invariante da tela é fechar com `netWorth`. Aparece como
  // detalhe para não sumir da vista.
  const acoes: HoldingLine[] = []
  for (const companyId of state.market.positionOrder) {
    const position = state.market.positions[companyId]
    const company = state.companies[companyId]
    if (!position || !company?.stock || position.shares === 0) continue
    const value = position.shares * company.stock.price
    const custo = position.shares * position.avgPrice
    acoes.push({
      id: `acao-${companyId}`,
      label: company.name,
      value,
      detail:
        `${Math.round(position.shares)} papéis · médio ${money(position.avgPrice)}` +
        (position.shortShares > 0 ? ` · ${Math.round(position.shortShares)} vendidos a descoberto` : ''),
      ...(custo > 0 ? { change: value - custo } : {}),
      route: '/mercado',
    })
  }
  if (acoes.length > 0) {
    groups.push({
      label: 'Ações',
      total: portfolioValue(state),
      hint: 'Papéis em carteira, a preço de fechamento de hoje.',
      lines: acoes,
    })
  }

  // --- empresas privadas ---------------------------------------------------
  // Só as privadas: a participação em empresa listada já está em Ações, e
  // contá-la duas vezes era o jeito mais fácil de a tela mentir.
  const empresas: HoldingLine[] = []
  for (const companyId of state.companyOrder) {
    const company = state.companies[companyId]
    if (!company || company.isPublic) continue
    const industry = findIndustry(company.industryId)
    if (!industry) continue
    const total = company.ownership.reduce((sum, entry) => sum + entry.shares, 0)
    const mine = company.ownership.reduce(
      (sum, entry) => (entry.holderId === 'player' ? sum + entry.shares : sum),
      0,
    )
    if (total <= 0 || mine <= 0) continue
    const stake = mine / total
    const value = stake * valuationOf(company, sectorMultiple(industry.multipleBase, state.macro.selic))
    empresas.push({
      id: `empresa-${companyId}`,
      label: company.name,
      value,
      detail: `${Math.round(stake * 100)}% · ${industry.name}${company.managedBy === 'ai' ? ' · CEO nomeado' : ''}`,
      route: '/negocios',
    })
  }
  if (empresas.length > 0) {
    groups.push({
      label: 'Empresas',
      total: privateHoldingsValue(state),
      hint: 'Sua fatia do que a empresa vale — lucro do ano vezes o múltiplo do setor, a mesma conta de quando você vende.',
      lines: empresas,
    })
  }

  // --- bens ----------------------------------------------------------------
  const bens: HoldingLine[] = state.personalAssets.assets.map((asset) => ({
    id: `bem-${asset.id}`,
    label: asset.name,
    value: asset.currentValue,
    detail:
      (asset.isResidence ? 'você mora aqui' : asset.monthlyIncome > 0 ? `aluga por ${money(asset.monthlyIncome)}/mês` : 'parado') +
      (asset.pledgedToLoanId ? ' · dado em garantia' : ''),
    route: '/mundo',
  }))
  if (bens.length > 0) {
    groups.push({
      label: 'Bens',
      total: bens.reduce((sum, line) => sum + line.value, 0),
      hint: 'Imóvel e veículo. Imóvel valoriza, veículo deprecia.',
      lines: bens,
    })
  }

  // --- imprensa ------------------------------------------------------------
  const veiculos: HoldingLine[] = []
  for (const outletId of state.news.outletOrder) {
    const outlet = state.news.outlets[outletId]
    if (!outlet || outlet.ownerId !== 'player') continue
    veiculos.push({
      id: `veiculo-${outletId}`,
      label: outlet.name,
      value: outletPrice(state, outlet),
      detail: `alcance ${Math.round(outlet.reach)} · credibilidade ${Math.round(outlet.credibility)}`,
      route: '/mundo',
    })
  }
  if (veiculos.length > 0) {
    groups.push({
      label: 'Imprensa',
      total: veiculos.reduce((sum, line) => sum + line.value, 0),
      hint: 'Veículos que são seus. Valem pelo alcance, e não há como vendê-los.',
      lines: veiculos,
    })
  }

  // --- dívidas -------------------------------------------------------------
  const dividas: HoldingLine[] = []
  for (const loan of state.banking.loans) {
    if (loan.borrower !== 'player' || loan.remaining <= 0) continue
    const bank = findBank(loan.bankId)
    dividas.push({
      id: `emp-${loan.id}`,
      label: `${bank?.name ?? loan.bankId} — ${loan.kind}`,
      value: -loan.remaining,
      detail:
        `${Math.round(loan.rate * 100)}% ao ano · ${money(loan.dailyPayment * 30)}/mês` +
        (loan.daysOverdue > 0 ? ` · ${loan.daysOverdue} d em atraso` : ''),
      route: '/mundo',
    })
  }
  for (const card of state.banking.cards) {
    if (card.balance <= 0) continue
    const bank = findBank(card.bankId)
    dividas.push({
      id: `cartao-${card.bankId}`,
      label: `${bank?.name ?? card.bankId} — cartão`,
      value: -card.balance,
      detail: `rotativo de ${(card.revolvingMonthlyRate * 100).toFixed(1)}% ao mês`,
      route: '/mundo',
    })
  }
  for (const debt of state.market.taxDebts) {
    dividas.push({
      id: `imposto-${debt.id}`,
      label: 'Imposto atrasado',
      value: -(debt.amount + debt.penalty),
      detail: debt.penalty > 0 ? `${money(debt.penalty)} só de multa` : 'sem multa ainda',
      route: '/mercado',
    })
  }
  if (dividas.length > 0) {
    groups.push({
      label: 'Dívidas',
      total: -totalDebt(state),
      hint: 'O que você deve. Sai do patrimônio inteiro, não só da parcela do mês.',
      lines: dividas,
    })
  }

  // **Somado dos grupos, não lido de `netWorth`.** Devolver `netWorth(state)`
  // aqui faria o total bater sempre — inclusive quando um grupo estivesse
  // faltando —, e o teste de reconciliação deixaria de testar qualquer coisa.
  const assets = groups
    .filter((group) => group.label !== 'Dívidas')
    .reduce((sum, group) => sum + group.total, 0)
  const debts = -totalDebt(state)

  return { groups, assets, debts, total: assets + debts }
}

/** Formatação mínima para os detalhes; a tela usa a sua própria para os totais. */
function money(value: Money): string {
  return `R$ ${Math.round(value).toLocaleString('pt-BR')}`
}
