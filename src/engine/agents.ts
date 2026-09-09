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
import type { AgentState, Company, GameState, LogEntry, WorldEvent } from './types'
import type { DayMarkers } from './clock'
import { AI } from '../data/config'
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

export function stepAi(draft: GameState, markers: DayMarkers, log: LogEntry[]): void {
  for (const id of draft.companyOrder) {
    const company = draft.companies[id]
    const agent = draft.ai.agents[id]
    if (!company || !agent || company.managedBy !== 'ai' || company.status !== 'ativa') continue

    if (markers.isQuarterEnd) reviewQuarter(draft, company, agent, log)

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
}
