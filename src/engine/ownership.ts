/**
 * Participação, controle e M&A (spec §5.6). TypeScript puro.
 *
 * Os limiares não são decoração: cada um destrava um poder concreto, e o de 50%
 * troca `managedBy` para `player` — é o que faz o painel de gestão da empresa
 * própria valer também para uma listada tomada de assalto, com **a mesma**
 * engine de operação.
 */
import type {
  Company,
  ControlLevel,
  GameState,
  HolderId,
  LogEntry,
  Tender,
} from './types'
import { CONTROL } from '../data/config'
import { OWNER_BLOCKS } from '../data/companies.seed'
import { chance } from './rng'
import { annualizedProfit } from './companies'

export function totalShares(company: Company): number {
  return company.ownership.reduce((sum, entry) => sum + entry.shares, 0)
}

/** Fração do capital nas mãos de um detentor. */
export function stakeOf(company: Company, holderId: HolderId): number {
  const total = totalShares(company)
  if (total <= 0) return 0
  const held = company.ownership
    .filter((entry) => entry.holderId === holderId)
    .reduce((sum, entry) => sum + entry.shares, 0)
  return held / total
}

export function controlLevelFor(stake: number): ControlLevel {
  if (stake >= CONTROL.squeezeOutStake) return 'fechamento'
  if (stake > CONTROL.controlStake) return 'controle'
  if (stake >= CONTROL.blockingStake) return 'bloqueio'
  if (stake >= CONTROL.boardStake) return 'conselho'
  if (stake >= CONTROL.relevantStake) return 'relevante'
  return 'nenhum'
}

/** O que cada nível destrava, para a UI dizer ao jogador. */
export const CONTROL_LABEL: Record<ControlLevel, string> = {
  nenhum: 'sem poder',
  relevante: 'acionista relevante — divulgação obrigatória',
  conselho: 'assento no conselho',
  bloqueio: 'poder de bloqueio',
  controle: 'controle: você dirige a empresa',
  fechamento: 'pode fechar o capital',
}

/** Preço de referência da oferta: média dos últimos 60 pregões. */
export function referencePrice(company: Company): number {
  const stock = company.stock
  if (!stock) return 0
  const recent = stock.history.slice(-CONTROL.referenceWindowDays)
  if (recent.length === 0) return stock.price
  return recent.reduce((sum, candle) => sum + candle.close, 0) / recent.length
}

/**
 * Regra dura do Herdeiro (spec §5.12): **recusa qualquer OPA, com qualquer
 * prêmio**, enquanto a família mantiver o controle. Não é probabilidade — é
 * recusa, e é o que torna a empresa dele intocável até uma crise de sucessão.
 */
export function familyRefuses(state: GameState, company: Company, holderId: string): boolean {
  if (!holderId.startsWith('familia@')) return false
  const agent = state.ai.agents[company.id]
  if (agent?.profileId !== 'herdeiro') return false
  // Se a família já perdeu o bloco, a regra deixa de valer.
  return stakeOf(company, holderId) >= 0.1
}

/** Lealdade declarada do bloco; blocos desconhecidos resistem pouco. */
function loyaltyOf(holderId: string): number {
  const prefix = holderId.split('@')[0]
  return OWNER_BLOCKS.find((block) => block.id === prefix)?.loyalty ?? 0.2
}

/**
 * Confiança na gestão atual: lucro em alta e boa reputação seguram o acionista.
 * Empresa mal gerida se entrega barato — é assim que o Abutre vive.
 */
export function managementConfidence(company: Company): number {
  const profit = annualizedProfit(company)
  const margin = company.revenue > 0 ? profit / company.revenue : 0
  return Math.max(0, Math.min(1, 0.5 + margin * 2 + (company.reputation - 50) / 200))
}

/** Humor da imprensa sobre a empresa nos últimos 60 dias. */
export function pressSentiment(state: GameState, companyId: string): number {
  const recent = state.news.headlines.filter(
    (headline) =>
      headline.subject.kind === 'company' &&
      headline.subject.id === companyId &&
      state.date.dayIndex - headline.dayIndex <= 60,
  )
  if (recent.length === 0) return 0
  return recent.reduce((sum, headline) => sum + headline.sentiment, 0) / recent.length
}

/**
 * Probabilidade de um bloco aceitar a oferta. O termo de imprensa é o que
 * transforma o jornal em arma: campanha negativa contra o alvo derruba a
 * confiança na gestão e barateia a aquisição.
 */
export function acceptanceChance(
  state: GameState,
  company: Company,
  holderId: string,
  premium: number,
): number {
  const chanceValue =
    CONTROL.acceptBase +
    premium * CONTROL.acceptPremiumWeight -
    loyaltyOf(holderId) * CONTROL.acceptLoyaltyWeight -
    managementConfidence(company) * CONTROL.acceptManagementWeight -
    pressSentiment(state, company.id) * CONTROL.acceptSentimentWeight
  return Math.max(0.01, Math.min(0.95, chanceValue))
}

function transfer(company: Company, from: string, to: HolderId, shares: number): void {
  const source = company.ownership.find((entry) => entry.holderId === from)
  if (!source) return
  source.shares -= shares
  let target = company.ownership.find((entry) => entry.holderId === to)
  if (!target) {
    target = { holderId: to, shares: 0 }
    company.ownership.push(target)
  }
  target.shares += shares
}

/**
 * Resolve uma OPA no vencimento. Cada bloco decide sozinho; o float entra
 * inteiro se o prêmio for positivo, porque quem está no mercado vende no preço.
 */
export function resolveTender(draft: GameState, tender: Tender, log: LogEntry[]): void {
  const company = draft.companies[tender.companyId]
  if (!company || tender.status !== 'aberta') return

  let acquired = 0
  let cost = 0
  const total = totalShares(company)

  for (const entry of [...company.ownership]) {
    if (entry.holderId === tender.bidderId || entry.shares <= 0) continue
    if (acquired >= tender.sharesSought) break

    const wanted = Math.min(entry.shares, tender.sharesSought - acquired)
    const accepts =
      entry.holderId === 'float'
        ? tender.premium > 0
        : familyRefuses(draft, company, entry.holderId)
          ? false
          : chance(draft.rng, acceptanceChance(draft, company, entry.holderId, tender.premium))
    if (!accepts) continue

    const price = wanted * tender.pricePerShare
    const purse =
      tender.bidderId === 'player'
        ? draft.player.money
        : (draft.ai.tycoons[tender.bidderId]?.cash ?? 0)
    if (purse < cost + price) break

    transfer(company, entry.holderId, tender.bidderId, wanted)
    acquired += wanted
    cost += price
  }

  tender.acceptedShares = acquired
  tender.status = acquired > 0 ? 'aceita' : 'recusada'

  if (tender.bidderId === 'player') {
    draft.player.money -= cost
    // Notoriedade: tomar empresa à força chama atenção da imprensa e do fisco.
    draft.player.notoriety = Math.min(100, draft.player.notoriety + (tender.hostile ? 8 : 3))
  } else {
    const tycoon = draft.ai.tycoons[tender.bidderId]
    if (tycoon) {
      tycoon.cash -= cost
      tycoon.notoriety = Math.min(100, tycoon.notoriety + (tender.hostile ? 8 : 3))
    }
  }

  const stake = stakeOf(company, tender.bidderId)
  log.push({
    id: `opa-${tender.id}`,
    dayIndex: draft.date.dayIndex,
    severity: acquired > 0 ? 'bom' : 'ruim',
    source: 'ownership',
    text:
      acquired > 0
        ? `OPA sobre ${company.name}: ${((acquired / total) * 100).toFixed(1)}% aceitaram.`
        : `OPA sobre ${company.name} foi recusada por todos os blocos.`,
    amount: acquired > 0 ? -cost : null,
  })

  applyControl(draft, company, log)
  void stake
}

/**
 * Reavalia quem manda na empresa. Passar de 50% troca o `managedBy` — a partir
 * daí a listada é dirigida pelo mesmo painel da empresa própria.
 */
export function applyControl(draft: GameState, company: Company, log: LogEntry[]): void {
  // Um tycoon que passa de 50% tira a empresa de você. É o antagonista do
  // §5.12 fazendo o que o jogador faz — mesma regra, mesmo limiar.
  for (const tycoonId of draft.ai.tycoonOrder) {
    const tycoon = draft.ai.tycoons[tycoonId]
    if (!tycoon) continue
    if (stakeOf(company, tycoonId) <= CONTROL.controlStake) continue

    const wasPlayers = company.managedBy === 'player'
    if (!tycoon.controlledCompanyIds.includes(company.id)) {
      tycoon.controlledCompanyIds.push(company.id)
    }
    if (company.managedBy !== 'ai') {
      company.managedBy = 'ai'
      draft.ai.agents[company.id] = {
        companyId: company.id,
        profileId: tycoon.profileId,
        stress: 0,
        breakUntilDayIndex: null,
        warFatigue: 0,
        grudge: {},
        lastReviewDayIndex: -1,
        reviewOffset: draft.date.dayIndex % 90,
        cooldowns: {},
        badQuarters: 0,
        imitationTargetId: null,
        appointedByPlayer: false,
      }
      if (!draft.ai.agentOrder.includes(company.id)) draft.ai.agentOrder.push(company.id)
      log.push({
        id: `lost-${company.id}-${draft.date.dayIndex}`,
        dayIndex: draft.date.dayIndex,
        severity: wasPlayers ? 'critico' : 'ruim',
        source: 'ownership',
        text: wasPlayers
          ? `${tycoon.name} tomou o controle de ${company.name}. A empresa não é mais sua.`
          : `${tycoon.name} assumiu o controle de ${company.name}.`,
        amount: null,
      })
    }
    return
  }

  const stake = stakeOf(company, 'player')
  const level = controlLevelFor(stake)

  if (level === 'controle' || level === 'fechamento') {
    // CEO nomeado pelo jogador continua no comando: a delegação é uma escolha,
    // não um acidente de contagem de ações.
    if (draft.ai.agents[company.id]?.appointedByPlayer) return

    if (company.managedBy !== 'player') {
      company.managedBy = 'player'
      delete draft.ai.agents[company.id]
      draft.ai.agentOrder = draft.ai.agentOrder.filter((id) => id !== company.id)
      log.push({
        id: `control-${company.id}-${draft.date.dayIndex}`,
        dayIndex: draft.date.dayIndex,
        severity: 'bom',
        source: 'ownership',
        text: `Você assumiu o controle de ${company.name}.`,
        amount: null,
      })
    }
  } else if (company.managedBy === 'player' && company.isPublic) {
    // Perdeu o controle: a empresa volta para a mão de um arquétipo.
    company.managedBy = 'ai'
  }
}

/**
 * Marcos de divulgação. A regra real é divulgar ao **cruzar** faixa, não a cada
 * ação comprada: sem isso uma acumulação de um ano gerava 56 comunicados e 40
 * manchetes idênticas, e o feed virava ruído.
 */
const DISCLOSURE_STEPS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 0.9]

function stepReached(stake: number): number | null {
  let reached: number | null = null
  for (const step of DISCLOSURE_STEPS) {
    if (stake >= step) reached = step
  }
  return reached
}

// ---------------------------------------------------------------------------
// Defesas do conselho (spec §5.12)
// ---------------------------------------------------------------------------

/** Move ações do float para um detentor, pelo preço dado. Devolve o custo. */
export function buyFromFloat(company: Company, holderId: HolderId, shares: number, price: number): number {
  const float = company.ownership.find((entry) => entry.holderId === 'float')
  if (!float || float.shares <= 0 || shares <= 0) return 0
  const taken = Math.min(float.shares, Math.floor(shares))
  if (taken <= 0) return 0
  transfer(company, 'float', holderId, taken)
  return taken * price
}

/** Devolve ações ao float, pelo preço dado. Devolve o valor apurado. */
export function sellToFloat(company: Company, holderId: HolderId, shares: number, price: number): number {
  const holder = company.ownership.find((entry) => entry.holderId === holderId)
  if (!holder || holder.shares <= 0 || shares <= 0) return 0
  const sold = Math.min(holder.shares, Math.floor(shares))
  if (sold <= 0) return 0
  transfer(company, String(holderId), 'float', sold)
  return sold * price
}

/**
 * Recompra de ações: a empresa gasta caixa comprando o próprio papel no
 * mercado e o **retira de circulação**. Menos ações para o mesmo lucro eleva o
 * valor justo por ação, e o preço sobe atrás — que é o efeito real de encarecer
 * o alvo para quem está acumulando.
 */
export function buyback(draft: GameState, company: Company, budget: number): number {
  const stock = company.stock
  const float = company.ownership.find((entry) => entry.holderId === 'float')
  if (!stock || !float || float.shares <= 0 || budget <= 0) return 0

  const shares = Math.min(float.shares, Math.floor(budget / stock.price))
  if (shares <= 0) return 0

  const cost = shares * stock.price
  company.cash -= cost
  float.shares -= shares
  stock.sharesOutstanding -= shares
  void draft
  return shares
}

/**
 * Pílula de veneno: emissão diluidora para todo mundo **menos** o atacante.
 *
 * O preço cai na exata proporção da emissão, para o valor de mercado da empresa
 * não mudar — a pílula não cria nem destrói riqueza, ela **transfere** valor do
 * atacante para os demais acionistas. Sem esse ajuste, diluir inventaria
 * dinheiro do nada e o índice da bolsa mentiria.
 */
export function poisonPill(company: Company, raiderId: HolderId, issueRatio: number): number {
  const stock = company.stock
  if (!stock || issueRatio <= 0) return 0

  const before = totalShares(company)
  const issued = Math.floor(before * issueRatio)
  if (issued <= 0) return 0

  const eligible = company.ownership.filter(
    (entry) => entry.holderId !== raiderId && entry.shares > 0,
  )
  const eligibleShares = eligible.reduce((sum, entry) => sum + entry.shares, 0)
  if (eligibleShares <= 0) return 0

  for (const entry of eligible) {
    entry.shares += Math.floor((issued * entry.shares) / eligibleShares)
  }

  const after = totalShares(company)
  stock.sharesOutstanding = after
  stock.price *= before / after
  return after - before
}

/**
 * Cavaleiro branco: um aliado compra parte do float e passa a segurar o papel.
 * Não custa caixa à empresa — custa liquidez a quem queria comprar.
 */
export function whiteKnight(company: Company, allyId: string, floatRatio: number): number {
  const float = company.ownership.find((entry) => entry.holderId === 'float')
  if (!float || float.shares <= 0) return 0
  const shares = Math.floor(float.shares * floatRatio)
  if (shares <= 0) return 0
  transfer(company, 'float', allyId, shares)
  return shares
}

/** Divulgação obrigatória a partir de 5% (§5.6): vira notícia. */
export function checkDisclosure(draft: GameState, company: Company, log: LogEntry[]): void {
  const stake = stakeOf(company, 'player')
  if (stake < CONTROL.relevantStake) return

  const step = stepReached(stake)
  if (step === null) return

  const already = draft.ownershipDisclosures.some(
    (disclosure) =>
      disclosure.companyId === company.id &&
      disclosure.holderId === 'player' &&
      stepReached(disclosure.stakePct) === step,
  )
  if (already) return

  draft.ownershipDisclosures.push({
    id: `disc-${company.id}-${draft.date.dayIndex}`,
    companyId: company.id,
    holderId: 'player',
    stakePct: stake,
    dayIndex: draft.date.dayIndex,
  })

  draft.news.headlines.push({
    id: `hl-disc-${company.id}-${draft.date.dayIndex}`,
    outletId: 'portal',
    dayIndex: draft.date.dayIndex,
    text: `Investidor acumula ${(stake * 100).toFixed(1)}% de ${company.name}`,
    subject: { kind: 'company', id: company.id },
    sentiment: 0.2,
    isRumor: false,
    accuracy: 1,
    isTrue: true,
    planted: false,
    eventId: null,
  })

  log.push({
    id: `disc-${company.id}-${draft.date.dayIndex}`,
    dayIndex: draft.date.dayIndex,
    severity: 'info',
    source: 'ownership',
    text: `Sua posição em ${company.name} passou de ${(stake * 100).toFixed(1)}% e virou notícia.`,
    amount: null,
  })
}
