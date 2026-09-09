/**
 * Passo 4 do tick: orquestração dos agentes NPC.
 *
 * Este arquivo faz a ponte entre o mundo e `engine/ai/`, que por regra de
 * arquitetura não pode importar dados nem ler o `GameState`. Aqui montamos o que
 * o agente enxerga (tudo público), injetamos a projeção e aplicamos a decisão.
 *
 * Cadência escalonada (spec §5.12 Regra 3): reavaliação a cada 90 dias com
 * offset `hash(companyId) % 90`, distribuindo o custo pelos ticks.
 */
import type {
  AgentState,
  Company,
  DefenseKind,
  GameState,
  LogEntry,
  WorldEvent,
} from './types'
import type { DayMarkers } from './clock'
import { AI, CONTROL, DEFENSE, MARKET, TYCOONS } from '../data/config'
import { hashId } from './rng'
import { fairValue, slippageFor } from './market'
import {
  applyControl,
  buyFromFloat,
  buyback,
  sellToFloat,
  poisonPill,
  referencePrice,
  stakeOf,
  whiteKnight,
} from './ownership'
import { findIndustry } from '../data/industries'
import { projectQuarter, unitCost, type CandidateOverride } from './companies'
import { decide, mandatoryOverrides } from './ai/companyAgent'
import type { Guardrails, SectorView } from './ai/utility'

const GUARDRAILS: Guardrails = {
  hysteresis: AI.hysteresis,
  priceRateLimit: AI.priceRateLimit,
  marketingCap: AI.marketingCap,
  warFatigueLimit: AI.warFatigueLimit,
}

/** O que é público sobre o setor: preço médio, menor preço e o líder. */
function sectorViewFor(state: GameState, industryId: string, selfId: string): SectorView {
  const ids = state.industries[industryId]?.companyOrder ?? []
  const rivals = ids
    .map((id) => state.companies[id])
    .filter((company): company is Company => !!company && company.id !== selfId && company.status === 'ativa')

  if (rivals.length === 0) {
    const self = state.companies[selfId]
    const price = self?.price ?? 1
    return { averagePrice: price, minPrice: price, leaderPrice: price, leaderMarketingRatio: 0.03 }
  }

  const averagePrice = rivals.reduce((sum, company) => sum + company.price, 0) / rivals.length
  const minPrice = Math.min(...rivals.map((company) => company.price))
  const leader = rivals.reduce((best, company) =>
    company.marketShare > best.marketShare ? company : best,
  )
  return {
    averagePrice,
    minPrice,
    leaderPrice: leader.price,
    leaderMarketingRatio: leader.directives.marketingRatio,
  }
}

function applyOverride(company: Company, override: CandidateOverride): void {
  if (override.price !== undefined) {
    company.price = override.price
    company.directives.price = override.price
  }
  if (override.marketingRatio !== undefined) company.directives.marketingRatio = override.marketingRatio
  if (override.rndRatio !== undefined) company.directives.rndRatio = override.rndRatio
  if (override.headcountTarget !== undefined) company.directives.headcountTarget = override.headcountTarget
  if (override.payoutRatio !== undefined) company.directives.payoutRatio = override.payoutRatio
  if (override.capitalAdd) {
    company.capitalStock += override.capitalAdd
    company.cash -= override.capitalAdd
  }
}

/**
 * Assédio de talentos (spec §5.12 reações): quem paga acima do mercado e tem
 * moral alta vira alvo. O rival sobe o próprio salário e leva gente.
 */
function poachTalent(draft: GameState, raider: Company, industryId: string, log: LogEntry[]): void {
  const ids = draft.industries[industryId]?.companyOrder ?? []
  let target: Company | null = null
  for (const id of ids) {
    const company = draft.companies[id]
    if (!company || company.id === raider.id || company.status !== 'ativa') continue
    if (company.workforce.morale < 75) continue
    if (company.workforce.avgSalary <= raider.workforce.avgSalary) continue
    if (!target || company.workforce.avgSalary > target.workforce.avgSalary) target = company
  }
  if (!target || target.workforce.headcount < 10) return

  const moved = Math.max(1, Math.round(target.workforce.headcount * 0.02))
  const newSalary = target.workforce.avgSalary * 1.05
  const total = raider.workforce.headcount + moved
  raider.workforce.avgSalary =
    (raider.workforce.avgSalary * raider.workforce.headcount + newSalary * moved) / total
  raider.workforce.headcount = total
  target.workforce.headcount -= moved
  target.workforce.morale = Math.max(0, target.workforce.morale - 3)

  log.push({
    id: `poach-${raider.id}-${draft.date.dayIndex}`,
    dayIndex: draft.date.dayIndex,
    severity: 'info',
    source: 'ai',
    text: `${raider.name} leva profissionais de ${target.name} com salário maior.`,
    amount: null,
  })
}

function emitDecisionEvent(draft: GameState, company: Company, label: string, priority: number): void {
  const event: WorldEvent = {
    id: `ai-${company.id}-${draft.date.dayIndex}`,
    definitionId: 'decisao-npc',
    dayIndex: draft.date.dayIndex,
    scope: 'empresa',
    subject: { kind: 'company', id: company.id },
    priority,
    pending: false,
    resolvesDayIndex: null,
    willHappen: true,
    applied: true,
  }
  draft.events.pending.push(event)
  draft.news.headlines.push({
    id: `hl-ai-${company.id}-${draft.date.dayIndex}`,
    outletId: 'portal',
    dayIndex: draft.date.dayIndex,
    text: `${company.name}: ${label}`,
    subject: event.subject,
    sentiment: 0,
    isRumor: false,
    accuracy: 1,
    isTrue: true,
    planted: false,
    eventId: event.id,
  })
}

/** Trimestre fechado: estresse, fadiga, quebra de personagem e sucessão. */
function reviewQuarter(draft: GameState, company: Company, agent: AgentState, log: LogEntry[]): void {
  const profile = draft.ai.profiles[agent.profileId]
  if (!profile) return

  const lastProfit = company.profitHistory[0] ?? 0
  const margin = company.revenue > 0 ? (lastProfit * 4) / company.revenue : 0

  if (lastProfit < 0) {
    agent.stress += AI.stressPerLossQuarter
    agent.badQuarters += 1
  } else {
    agent.stress = Math.max(0, agent.stress - AI.stressReliefPerGoodQuarter)
    agent.badQuarters = 0
  }

  // Fadiga tem teto: um contador que sobe a 20 nunca deixa o agente voltar a
  // brigar, e a guerra de preços deixa de ser um episódio para virar estado.
  if (margin < profile.minMargin) {
    agent.warFatigue = Math.min(AI.warFatigueLimit + 2, agent.warFatigue + 1)
  } else {
    agent.warFatigue = Math.max(0, agent.warFatigue - 1)
  }

  // Quebra de personagem: `stress ≥ conviction` suspende as regras duras por 4
  // trimestres. É o momento em que a Fortaleza finalmente corta o dividendo.
  if (agent.stress >= profile.conviction && agent.breakUntilDayIndex === null) {
    agent.breakUntilDayIndex = draft.date.dayIndex + AI.breakQuarters * 90
    agent.stress = profile.conviction * AI.breakStressReset
    log.push({
      id: `break-${company.id}-${draft.date.dayIndex}`,
      dayIndex: draft.date.dayIndex,
      severity: 'critico',
      source: 'ai',
      text: `${company.name} abandona a própria cartilha depois de trimestres no vermelho.`,
      amount: null,
    })
    emitDecisionEvent(draft, company, 'muda de estratégia sob pressão', 8)
  }

  if (agent.breakUntilDayIndex !== null && draft.date.dayIndex >= agent.breakUntilDayIndex) {
    agent.breakUntilDayIndex = null
  }

  // Sucessão: o conselho troca o CEO e o arquétipo muda junto.
  if (agent.badQuarters >= AI.badQuartersToSuccession) {
    const next = agent.profileId === 'fortaleza' ? 'abutre' : 'fortaleza'
    agent.profileId = next
    agent.badQuarters = 0
    agent.stress = 0
    agent.breakUntilDayIndex = null
    log.push({
      id: `ceo-${company.id}-${draft.date.dayIndex}`,
      dayIndex: draft.date.dayIndex,
      severity: 'ruim',
      source: 'ai',
      text: `Conselho de ${company.name} troca o comando.`,
      amount: null,
    })
    emitDecisionEvent(draft, company, 'troca o comando', 8)
  }

  // Rancor esfria com o tempo.
  for (const key of Object.keys(agent.grudge)) {
    const value = (agent.grudge[key] ?? 0) * (1 - AI.grudgeDecayPerDay * 90)
    if (value <= 0.01) delete agent.grudge[key]
    else agent.grudge[key] = value
  }
}

// ---------------------------------------------------------------------------
// Defesas do conselho (spec §5.12 — reações ao jogador)
// ---------------------------------------------------------------------------

interface Threat {
  holderId: string
  stake: number
  hostile: boolean
}

/**
 * O que o conselho enxerga de ameaça — **só o que é público**: divulgações de
 * participação e ofertas abertas. O agente lê o `PublicView` congelado ontem,
 * nunca o estado real.
 *
 * A defesa precisa acontecer na faixa de 5% a 50%, antes de o atacante fechar o
 * controle: passado esse ponto o agente já foi embora e não há quem reaja.
 */
function detectThreat(draft: GameState, companyId: string): Threat | null {
  let worst: Threat | null = null

  for (const disclosure of draft.publicView.disclosures) {
    if (disclosure.companyId !== companyId) continue
    if (disclosure.stakePct < DEFENSE.wakeStake) continue
    if (draft.date.dayIndex - disclosure.dayIndex > AI.triggerCooldownDays) continue
    if (!worst || disclosure.stakePct > worst.stake) {
      worst = { holderId: disclosure.holderId, stake: disclosure.stakePct, hostile: false }
    }
  }

  for (const tender of draft.tenders) {
    if (tender.companyId !== companyId || tender.status !== 'aberta') continue
    worst = { holderId: tender.bidderId, stake: worst?.stake ?? DEFENSE.wakeStake, hostile: true }
  }

  return worst
}

/**
 * Escolhe a defesa pelo arquétipo e pelo caixa. Quem tem dinheiro recompra;
 * quem tem família no bloco engole a pílula; quem não tem nem uma coisa nem
 * outra procura um cavaleiro branco.
 */
function defend(
  draft: GameState,
  company: Company,
  agent: AgentState,
  threat: Threat,
  log: LogEntry[],
): void {
  const profile = draft.ai.profiles[agent.profileId]
  if (!profile || !company.stock) return

  // Rancor: quem ataca fica marcado, e a retaliação é direcionada a ele.
  const weight = threat.hostile ? DEFENSE.grudgeOnTender : DEFENSE.grudgeOnDisclosure
  agent.grudge[threat.holderId] = (agent.grudge[threat.holderId] ?? 0) + weight * profile.vindictiveness

  const cashPower = company.revenue > 0 ? company.cash / company.revenue : 0
  let kind: DefenseKind
  if (cashPower > 0.15 && profile.weights.caixa >= 0.5) kind = 'recompra'
  else if (agent.profileId === 'herdeiro' || agent.profileId === 'padrinho') kind = 'pilulaDeVeneno'
  else if (cashPower > 0.08) kind = 'bancoDeDefesa'
  else kind = 'cavaleiroBranco'

  let text = ''
  let cost = 0

  if (kind === 'recompra') {
    const budget = company.cash * DEFENSE.buybackCashRatio
    const shares = buyback(draft, company, budget)
    if (shares <= 0) kind = 'cavaleiroBranco'
    else {
      cost = shares * company.stock.price
      text = `${company.name} anuncia recompra de ações e encarece o próprio papel.`
    }
  }

  if (kind === 'pilulaDeVeneno') {
    const issued = poisonPill(company, threat.holderId, DEFENSE.poisonPillIssue)
    if (issued <= 0) kind = 'cavaleiroBranco'
    else text = `${company.name} aprova emissão diluidora contra investidor hostil.`
  }

  if (kind === 'bancoDeDefesa') {
    cost = company.cash * DEFENSE.defenseBankCashRatio
    company.cash -= cost
    company.reputation = Math.min(100, company.reputation + 8)
    text = `${company.name} contrata banco de defesa e fecha posição com o conselho.`
  }

  if (kind === 'cavaleiroBranco') {
    const shares = whiteKnight(company, `cavaleiro@${company.id}`, DEFENSE.whiteKnightFloat)
    if (shares <= 0) return
    text = `${company.name} encontra cavaleiro branco e tira papéis do mercado.`
  }

  draft.ai.defenses.push({
    id: `def-${company.id}-${draft.date.dayIndex}`,
    companyId: company.id,
    kind,
    againstId: threat.holderId,
    dayIndex: draft.date.dayIndex,
    cost,
  })
  agent.cooldowns.defesa = draft.date.dayIndex + DEFENSE.cooldownDays

  log.push({
    id: `def-${company.id}-${draft.date.dayIndex}`,
    dayIndex: draft.date.dayIndex,
    severity: 'ruim',
    source: 'ai',
    text,
    amount: cost > 0 ? -cost : null,
  })
  emitDecisionEvent(draft, company, text, 8)
}

// ---------------------------------------------------------------------------
// Tycoons rivais (spec §5.12)
// ---------------------------------------------------------------------------

/** Alvo do tycoon: papel barato em relação ao valor justo, com preferência por
 *  quem já o incomodou e por empresa do jogador quando a ambição é alta. */
export function pickTarget(draft: GameState, tycoonId: string): Company | null {
  const tycoon = draft.ai.tycoons[tycoonId]
  if (!tycoon) return null

  let best: Company | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const id of draft.companyOrder) {
    const company = draft.companies[id]
    if (!company?.stock || company.status !== 'ativa') continue
    if (stakeOf(company, tycoonId) > CONTROL.controlStake) continue

    // Sem papel em circulação não há o que comprar. Sem esta linha o rival
    // elegia o alvo mais barato, esgotava o float dele e insistia no mesmo nome
    // pelo resto da partida, comprando zero todo dia.
    const float = company.ownership.find((entry) => entry.holderId === 'float')?.shares ?? 0
    if (float <= company.stock.sharesOutstanding * 0.005) continue

    const fair = fairValue(draft, company)
    // `continue`, não `return`: um único papel sem valor justo abortava a busca
    // inteira e os tycoons passavam a partida parados.
    if (fair <= 0) continue
    const ratio = company.stock.price / fair
    if (ratio > TYCOONS.cheapThreshold) continue

    // Rancor e ambição puxam o alvo para quem já cruzou o caminho dele; a
    // posição já formada puxa mais ainda. Sem essa persistência o rival
    // pulverizava o caixa em oito nomes e não chegava a base nenhuma.
    const grudge = tycoon.grudge[company.id] ?? 0
    const playerBonus = company.managedBy === 'player' ? tycoon.ambition * 0.15 : 0
    const held = stakeOf(company, tycoonId)
    const score = ratio - grudge * 0.1 - playerBonus - held * 2
    if (score < bestScore) {
      bestScore = score
      best = company
    }
  }
  return best
}

function stepTycoons(draft: GameState, log: LogEntry[]): void {
  for (const tycoonId of draft.ai.tycoonOrder) {
    const tycoon = draft.ai.tycoons[tycoonId]
    if (!tycoon) continue

    for (const key of Object.keys(tycoon.grudge)) {
      const value = (tycoon.grudge[key] ?? 0) * (1 - AI.grudgeDecayPerDay)
      if (value <= 0.01) delete tycoon.grudge[key]
      else tycoon.grudge[key] = value
    }

    // O alvo é reescolhido a cada 30 dias, não a cada pregão: varrer todas as
    // listadas por rival todo dia dobrou o custo do tick e estourou o tempo dos
    // testes de dez anos.
    if (
      tycoon.targetCompanyId === null ||
      draft.date.dayIndex - tycoon.lastTargetDayIndex >= 30 ||
      draft.companies[tycoon.targetCompanyId]?.status !== 'ativa'
    ) {
      tycoon.targetCompanyId = pickTarget(draft, tycoonId)?.id ?? null
      tycoon.lastTargetDayIndex = draft.date.dayIndex
    }
    const target = tycoon.targetCompanyId ? draft.companies[tycoon.targetCompanyId] : null
    if (!target?.stock) continue

    const stake = stakeOf(target, tycoonId)

    // A acumulação é **diária**, como a de qualquer comprador: o teto de volume
    // é por pregão, e comprar só na reavaliação trimestral levaria 25 anos para
    // formar uma posição relevante. A reavaliação decide o alvo e a hora de
    // atacar; a compra acontece todo dia.
    if (stake < TYCOONS.tenderFromStake) {
      // Gira a carteira: se o caixa acabou, vende o que **não** é o alvo para
      // financiar o que é. Sem isso o rival investia tudo, ficava sem dinheiro
      // e passava a partida parado em 12% de uma empresa qualquer.
      if (tycoon.cash < tycoon.wealthFloor) {
        for (const otherId of draft.companyOrder) {
          if (otherId === target.id) continue
          const other = draft.companies[otherId]
          if (!other?.stock) continue
          const held = other.ownership.find((entry) => entry.holderId === tycoonId)
          if (!held || held.shares <= 0) continue
          const lot = Math.min(
            held.shares,
            other.stock.sharesOutstanding * MARKET.dailyVolumeRatio * TYCOONS.dailyVolumeShare,
          )
          const proceeds = sellToFloat(other, tycoonId, lot, other.stock.price)
          tycoon.cash += proceeds
          if (proceeds > 0) break
        }
      }

      const budget = tycoon.cash * tycoon.ambition * 0.02
      const maxShares = target.stock.sharesOutstanding * MARKET.dailyVolumeRatio * TYCOONS.dailyVolumeShare
      const price = target.stock.price * (1 + slippageFor(target.stock, maxShares))
      const shares = Math.min(maxShares, budget / price)
      const cost = buyFromFloat(target, tycoonId, shares, price)
      if (cost > 0) {
        tycoon.cash -= cost
        const now = stakeOf(target, tycoonId)
        if (now >= CONTROL.relevantStake) {
          draft.ownershipDisclosures.push({
            id: `disc-${target.id}-${tycoonId}-${draft.date.dayIndex}`,
            companyId: target.id,
            holderId: tycoonId,
            stakePct: now,
            dayIndex: draft.date.dayIndex,
          })
          draft.news.headlines.push({
            id: `hl-tyc-${target.id}-${draft.date.dayIndex}`,
            outletId: 'portal',
            dayIndex: draft.date.dayIndex,
            text: `${tycoon.name} amplia posição em ${target.name} para ${(now * 100).toFixed(1)}%`,
            subject: { kind: 'company', id: target.id },
            sentiment: 0.1,
            isRumor: false,
            accuracy: 1,
            isTrue: true,
            planted: false,
            eventId: null,
          })
        }
        applyControl(draft, target, log)
      }
      continue
    }

    // Base formada: a oferta pública só sai na reavaliação, com a cadência
    // escalonada da Regra 3.
    const due =
      (draft.date.dayIndex - (hashId(tycoonId) % TYCOONS.reviewIntervalDays)) %
        TYCOONS.reviewIntervalDays ===
      0
    if (!due || draft.date.dayIndex === tycoon.lastReviewDayIndex) continue
    tycoon.lastReviewDayIndex = draft.date.dayIndex

    if (draft.tenders.some((item) => item.companyId === target.id && item.status === 'aberta')) continue

    const outside = target.ownership
      .filter((entry) => entry.holderId !== tycoonId)
      .reduce((sum, entry) => sum + entry.shares, 0)
    const pricePerShare = referencePrice(target) * (1 + TYCOONS.tenderPremium)
    const affordable = Math.floor((tycoon.cash * tycoon.ambition) / Math.max(0.01, pricePerShare))
    const sought = Math.min(outside, affordable)
    if (sought <= 0) continue

    draft.tenders.push({
      id: `opa-${tycoonId}-${target.id}-${draft.date.dayIndex}`,
      companyId: target.id,
      bidderId: tycoonId,
      premium: TYCOONS.tenderPremium,
      pricePerShare,
      sharesSought: sought,
      hostile: true,
      openedDayIndex: draft.date.dayIndex,
      expiresDayIndex: draft.date.dayIndex + CONTROL.tenderDays,
      status: 'aberta',
      acceptedShares: 0,
    })

    draft.news.headlines.push({
      id: `hl-opa-${tycoonId}-${target.id}-${draft.date.dayIndex}`,
      outletId: 'referencia',
      dayIndex: draft.date.dayIndex,
      text: `${tycoon.name} lança oferta hostil por ${target.name}`,
      subject: { kind: 'company', id: target.id },
      sentiment: -0.2,
      isRumor: false,
      accuracy: 1,
      isTrue: true,
      planted: false,
      eventId: null,
    })

    log.push({
      id: `tyc-opa-${tycoonId}-${draft.date.dayIndex}`,
      dayIndex: draft.date.dayIndex,
      severity: target.managedBy === 'player' ? 'critico' : 'ruim',
      source: 'ai',
      text:
        target.managedBy === 'player'
          ? `${tycoon.name} lançou uma oferta hostil pela sua ${target.name}.`
          : `${tycoon.name} lançou oferta hostil por ${target.name}.`,
      amount: null,
    })
  }
}

export function stepAi(draft: GameState, markers: DayMarkers, log: LogEntry[]): void {
  for (const id of draft.companyOrder) {
    const company = draft.companies[id]
    const agent = draft.ai.agents[id]
    if (!company || !agent || company.managedBy !== 'ai' || company.status !== 'ativa') continue

    if (markers.isQuarterEnd) reviewQuarter(draft, company, agent, log)

    // Gatilho fora do ciclo: participação relevante divulgada no próprio capital
    // acorda o conselho, com cooldown próprio (Regra 3).
    const threat = detectThreat(draft, id)
    const defenseReady = draft.date.dayIndex >= (agent.cooldowns.defesa ?? -1)
    if (threat && defenseReady && threat.holderId !== id) {
      defend(draft, company, agent, threat, log)
    }

    const due = (draft.date.dayIndex - agent.reviewOffset) % AI.reviewIntervalDays === 0
    if (!due || draft.date.dayIndex === agent.lastReviewDayIndex) continue

    const industry = findIndustry(company.industryId)
    const profile = draft.ai.profiles[agent.profileId]
    if (!industry || !profile) continue

    agent.lastReviewDayIndex = draft.date.dayIndex

    // Obrigações do arquétipo entram sempre, fora do leque de utilidade.
    const broken = agent.breakUntilDayIndex !== null && draft.date.dayIndex < agent.breakUntilDayIndex
    applyOverride(company, mandatoryOverrides(profile, broken))

    const rivals = (draft.industries[company.industryId]?.companyOrder ?? [])
      .map((rivalId) => draft.companies[rivalId])
      .filter((rival): rival is Company => !!rival && rival.id !== id && rival.status === 'ativa')

    const decision = decide({
      view: draft.publicView,
      company,
      profile,
      agent,
      sector: sectorViewFor(draft, company.industryId, id),
      guardrails: GUARDRAILS,
      unitCost: unitCost(industry, company),
      dayIndex: draft.date.dayIndex,
      project: (override) =>
        projectQuarter(
          draft,
          company,
          industry,
          rivals,
          override,
          AI.projectionSteps,
          AI.projectionStepDays,
        ),
    })

    if (!decision) continue

    applyOverride(company, decision.candidate.override)
    const cooldown = AI.actionCooldownDays[decision.candidate.kind] ?? 30
    agent.cooldowns[decision.candidate.kind] = draft.date.dayIndex + cooldown

    if (decision.candidate.kind === 'contratar') {
      poachTalent(draft, company, company.industryId, log)
    }

    // Visibilidade: se o jogador não lê "concorrente anuncia corte de preços",
    // toda esta IA é trabalho invisível (spec §5.12).
    const priority = decision.candidate.kind === 'ajustarPreco' ? 6 : 4
    emitDecisionEvent(draft, company, decision.candidate.label, priority)
  }

  stepTycoons(draft, log)
}
