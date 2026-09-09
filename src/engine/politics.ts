/**
 * Passo 8 do tick: aprovação, tramitação de políticas, eleições e investigação.
 * TypeScript puro.
 *
 * O efeito de uma política aprovada é **recalculado a partir do conjunto de
 * aprovadas**, não somado incrementalmente ao estado. Somar deltas a cada
 * aprovação parece mais barato, mas acumula erro: revogar não desfaz, e um save
 * carregado reaplica. Recalcular no momento em que o conjunto muda custa uma
 * varredura por votação — não por tick.
 */
import type { GameState, LogEntry, MacroDelta, Policy } from './types'
import type { DayMarkers } from './clock'
import { chance, nextFloat, nextNormal, pickWeighted } from './rng'
import { POLITICS } from '../data/config'
import { INDUSTRIES } from '../data/industries'
import { POLICY_DEFS, findPolicyDef } from '../data/policies'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Soma dos deltas de todas as políticas aprovadas. */
export function activeDeltasOf(state: GameState): MacroDelta {
  const total: MacroDelta = {
    taxRateByIndustry: {},
    subsidyByIndustry: {},
    importTariffByIndustry: {},
  }
  let inflationTarget = 0
  let creditLooseness = 0
  let minimumWage = 0

  for (const id of state.politics.policyOrder) {
    const policy = state.politics.policies[id]
    if (!policy || policy.status !== 'aprovada') continue
    const effects = policy.effects

    for (const [industryId, value] of Object.entries(effects.taxRateByIndustry ?? {})) {
      total.taxRateByIndustry![industryId] = (total.taxRateByIndustry![industryId] ?? 0) + value
    }
    for (const [industryId, value] of Object.entries(effects.subsidyByIndustry ?? {})) {
      total.subsidyByIndustry![industryId] = (total.subsidyByIndustry![industryId] ?? 0) + value
    }
    for (const [industryId, value] of Object.entries(effects.importTariffByIndustry ?? {})) {
      total.importTariffByIndustry![industryId] =
        (total.importTariffByIndustry![industryId] ?? 0) + value
    }
    inflationTarget += effects.inflationTarget ?? 0
    creditLooseness += effects.creditLooseness ?? 0
    minimumWage += effects.minimumWage ?? 0
  }

  if (inflationTarget !== 0) total.inflationTarget = inflationTarget
  if (creditLooseness !== 0) total.creditLooseness = creditLooseness
  if (minimumWage !== 0) total.minimumWage = minimumWage
  return total
}

/**
 * Reescreve os parâmetros do mundo a partir da base de dados mais os deltas
 * vigentes. Chamado quando o conjunto de políticas aprovadas muda.
 */
export function applyActiveDeltas(draft: GameState): void {
  const deltas = activeDeltasOf(draft)
  draft.politics.activeDeltas = deltas

  for (const industry of INDUSTRIES) {
    const state = draft.industries[industry.id]
    if (!state) continue
    state.taxRate = clamp(industry.taxRate + (deltas.taxRateByIndustry?.[industry.id] ?? 0), 0, 0.7)
    state.subsidyRatio = clamp(deltas.subsidyByIndustry?.[industry.id] ?? 0, 0, 0.3)
    state.importTariff = clamp(deltas.importTariffByIndustry?.[industry.id] ?? 0, 0, 0.5)
  }

  draft.macro.inflationTarget = clamp(0.045 + (deltas.inflationTarget ?? 0), 0.01, 0.12)
}

/** Peso do político na casa: aprovação mais o cargo que ele ocupa. */
function influenceOf(approval: number, office: string | null): number {
  const seat = office === 'presidente' ? 2 : office === 'senador' ? 1.5 : office ? 1.2 : 0.6
  return (approval / 100) * seat
}

/** Posição média da casa sobre a pauta da política. */
function houseStance(state: GameState, topic: string): number {
  let weighted = 0
  let weight = 0
  for (const id of state.politics.politicianOrder) {
    const politician = state.politics.politicians[id]
    if (!politician) continue
    const influence = influenceOf(politician.approval, politician.office)
    weighted += (politician.stance[topic] ?? 0) * influence
    weight += influence
  }
  return weight > 0 ? weighted / weight : 0
}

/** Lobby: R$ 500 mil movem 1 ponto percentual, com retorno decrescente. */
export function lobbyShift(amount: number): number {
  if (amount <= 0) return 0
  return (amount / POLITICS.lobbyUnit) ** POLITICS.lobbyExponent * 0.01
}

/**
 * Saldo líquido do lobby sobre uma política — **é um leilão**: quem gastou mais
 * move o apoio, e o contra-lobby do concorrente cancela o seu real a real.
 */
export function netLobby(state: GameState, policyId: string): number {
  let favor = 0
  let against = 0
  for (const effort of state.politics.lobbyEfforts) {
    if (effort.policyId !== policyId) continue
    if (effort.direction > 0) favor += effort.amount
    else against += effort.amount
  }
  return clamp(
    lobbyShift(favor) - lobbyShift(against),
    -POLITICS.lobbyMaxShift,
    POLITICS.lobbyMaxShift,
  )
}

function tallyVote(draft: GameState, policy: Policy, log: LogEntry[]): void {
  const definition = findPolicyDef(policy.id)
  const support = clamp(policy.supportPct + netLobby(draft, policy.id), 0, 1)
  const approved = support >= POLITICS.approvalThreshold

  policy.status = approved ? 'aprovada' : 'rejeitada'
  policy.supportPct = support

  log.push({
    id: `policy-${policy.id}-${draft.date.dayIndex}`,
    dayIndex: draft.date.dayIndex,
    severity: approved ? 'info' : 'info',
    source: 'politics',
    text: `${policy.name} foi ${approved ? 'aprovada' : 'rejeitada'} com ${(support * 100).toFixed(0)}% de apoio.`,
    amount: null,
  })

  draft.news.headlines.push({
    id: `hl-policy-${policy.id}-${draft.date.dayIndex}`,
    outletId: 'referencia',
    dayIndex: draft.date.dayIndex,
    text: `Congresso ${approved ? 'aprova' : 'rejeita'} ${policy.name.toLowerCase()}`,
    subject: { kind: 'politician', id: policy.sponsorId },
    sentiment: approved ? 0.3 : -0.1,
    isRumor: false,
    accuracy: 1,
    isTrue: true,
    planted: false,
    eventId: null,
  })

  // O lobby daquela política se encerra com a votação.
  draft.politics.lobbyEfforts = draft.politics.lobbyEfforts.filter(
    (effort) => effort.policyId !== policy.id,
  )

  if (!approved) return

  applyActiveDeltas(draft)

  // Política sob medida para setor onde você tem empresa cobra notoriedade.
  const benefits = definition?.beneficiaryIndustryIds ?? []
  const mine = draft.companyOrder.some((id) => {
    const company = draft.companies[id]
    return company?.managedBy === 'player' && benefits.includes(company.industryId)
  })
  const lobbied = draft.politics.lobbyEfforts.some(
    (effort) => effort.policyId === policy.id && effort.actorId === 'player',
  )
  if (mine && (lobbied || (draft.politics.politicians[policy.sponsorId]?.loyaltyToPlayer ?? 0) > 20)) {
    draft.player.notoriety = clamp(
      draft.player.notoriety + POLITICS.notorietyPerTailoredPolicy,
      0,
      100,
    )
    log.push({
      id: `tailored-${policy.id}-${draft.date.dayIndex}`,
      dayIndex: draft.date.dayIndex,
      severity: 'ruim',
      source: 'politics',
      text: 'A imprensa notou que a nova política beneficia exatamente o seu setor.',
      amount: null,
    })
  }
}

/** Político leal propõe política alinhada ao setor de quem o financia. */
function proposeFromLoyalty(draft: GameState, log: LogEntry[]): void {
  if (draft.date.dayIndex % POLITICS.proposalIntervalDays !== 0) return

  for (const id of draft.politics.politicianOrder) {
    const politician = draft.politics.politicians[id]
    if (!politician || politician.loyaltyToPlayer < POLITICS.loyaltyToPropose) continue

    const mine = draft.companyOrder
      .map((companyId) => draft.companies[companyId])
      .filter((company) => company?.managedBy === 'player')
    if (mine.length === 0) continue

    const wanted = POLICY_DEFS.filter(
      (definition) =>
        definition.beneficiaryIndustryIds.some((industryId) =>
          mine.some((company) => company!.industryId === industryId),
        ) && !draft.politics.policies[definition.id],
    )
    if (wanted.length === 0) continue

    const definition = wanted[0]!
    draft.politics.policies[definition.id] = {
      id: definition.id,
      name: definition.name,
      effects: definition.effects,
      sponsorId: politician.id,
      status: 'tramitando',
      supportPct: definition.baseSupport,
      proposedDayIndex: draft.date.dayIndex,
      voteDayIndex: draft.date.dayIndex + definition.debateDays,
      beneficiaryIndustryIds: definition.beneficiaryIndustryIds,
    }
    draft.politics.policyOrder.push(definition.id)

    log.push({
      id: `proposal-${definition.id}-${draft.date.dayIndex}`,
      dayIndex: draft.date.dayIndex,
      severity: 'bom',
      source: 'politics',
      text: `${politician.name} propôs ${definition.name} — sob medida para você.`,
      amount: null,
    })
    return
  }
}

/**
 * Nova política entra em tramitação sozinha de tempos em tempos.
 *
 * Projeto rejeitado **volta** depois de um tempo: sem isso o Congresso esgotava
 * o catálogo em cinco anos e passava as quatro décadas seguintes parado.
 */
function spontaneousProposal(draft: GameState, log: LogEntry[]): void {
  const available = POLICY_DEFS.filter((definition) => {
    const existing = draft.politics.policies[definition.id]
    if (!existing) return true
    if (existing.status !== 'rejeitada') return false
    const voted = existing.voteDayIndex ?? existing.proposedDayIndex
    return draft.date.dayIndex - voted >= POLITICS.reproposalDelayDays
  })
  if (available.length === 0) return
  if (!chance(draft.rng, 0.004)) return

  const sponsors = draft.politics.politicianOrder
    .map((id) => draft.politics.politicians[id])
    .filter((politician) => !!politician)
  if (sponsors.length === 0) return

  const definition = pickWeighted(draft.rng, available, () => 1)
  const sponsor = pickWeighted(draft.rng, sponsors, (politician) =>
    Math.max(0.1, 1 + (politician!.stance[definition.topic] ?? 0)),
  )!

  const reproposal = draft.politics.policies[definition.id] !== undefined
  draft.politics.policies[definition.id] = {
    id: definition.id,
    name: definition.name,
    effects: definition.effects,
    sponsorId: sponsor.id,
    status: 'tramitando',
    supportPct: definition.baseSupport,
    proposedDayIndex: draft.date.dayIndex,
    voteDayIndex: draft.date.dayIndex + definition.debateDays,
    beneficiaryIndustryIds: definition.beneficiaryIndustryIds,
  }
  if (!reproposal) draft.politics.policyOrder.push(definition.id)

  draft.news.headlines.push({
    id: `hl-prop-${definition.id}-${draft.date.dayIndex}`,
    outletId: 'portal',
    dayIndex: draft.date.dayIndex,
    text: `${sponsor.name} apresenta ${definition.name.toLowerCase()}`,
    subject: { kind: 'politician', id: sponsor.id },
    sentiment: 0.1,
    isRumor: false,
    accuracy: 1,
    isTrue: true,
    planted: false,
    eventId: null,
  })
  void log
}

/** Aprovação dos políticos: economia manda, mídia e doação empurram. */
function driftApproval(draft: GameState): void {
  const economy =
    (draft.macro.confidence - 50) / 50 - draft.macro.unemployment * 2 - draft.macro.inflation * 3

  for (const id of draft.politics.politicianOrder) {
    const politician = draft.politics.politicians[id]
    if (!politician) continue
    const incumbent = politician.office !== null ? 1 : 0.3
    const target = clamp(50 + economy * 18 * incumbent, 5, 95)
    politician.approval += (target - politician.approval) * 0.004
    politician.loyaltyToPlayer = Math.max(
      0,
      politician.loyaltyToPlayer - POLITICS.loyaltyDecayPerDay,
    )
  }
}

/** Humor da imprensa sobre um político nos últimos 120 dias. */
function mediaScore(state: GameState, politicianId: string): number {
  const recent = state.news.headlines.filter(
    (headline) =>
      headline.subject.kind === 'politician' &&
      headline.subject.id === politicianId &&
      state.date.dayIndex - headline.dayIndex <= 120,
  )
  if (recent.length === 0) return 0
  return recent.reduce((sum, headline) => sum + headline.sentiment, 0) / recent.length
}

function runElection(draft: GameState, log: LogEntry[]): void {
  const candidates = draft.politics.politicianOrder
    .map((id) => draft.politics.politicians[id])
    .filter((politician) => !!politician)
  if (candidates.length === 0) return

  const economy =
    (draft.macro.confidence - 50) / 50 - draft.macro.unemployment * 2 - draft.macro.inflation * 2

  const results: Record<string, number> = {}
  let best: { id: string; score: number } | null = null

  for (const politician of candidates) {
    const donations = Math.min(1, politician!.donationsFromPlayer / (POLITICS.donationUnit * 20))
    const score =
      POLITICS.approvalWeight * (politician!.approval / 100) +
      POLITICS.donationWeight * donations +
      POLITICS.mediaWeight * ((mediaScore(draft, politician!.id) + 1) / 2) +
      POLITICS.economyWeight * clamp((economy + 1) / 2, 0, 1) +
      nextNormal(draft.rng) * POLITICS.resultNoise

    results[politician!.id] = score
    if (!best || score > best.score) best = { id: politician!.id, score }
  }

  if (!best) return

  for (const politician of candidates) {
    politician!.office = politician!.id === best.id ? 'presidente' : politician!.office === 'presidente' ? 'senador' : politician!.office
  }

  draft.politics.elections.push({
    id: `eleicao-${draft.date.dayIndex}`,
    scope: 'federal',
    dayIndex: draft.date.dayIndex,
    candidateIds: candidates.map((politician) => politician!.id),
    winnerId: best.id,
    results,
  })

  const winner = draft.politics.politicians[best.id]!
  log.push({
    id: `eleicao-${draft.date.dayIndex}`,
    dayIndex: draft.date.dayIndex,
    severity: winner.loyaltyToPlayer > 20 ? 'bom' : 'info',
    source: 'politics',
    text: `${winner.name} (${winner.party}) venceu a eleição presidencial.`,
    amount: null,
  })
  draft.news.headlines.push({
    id: `hl-eleicao-${draft.date.dayIndex}`,
    outletId: 'referencia',
    dayIndex: draft.date.dayIndex,
    text: `${winner.name} eleito presidente`,
    subject: { kind: 'politician', id: winner.id },
    sentiment: 0.3,
    isRumor: false,
    accuracy: 1,
    isTrue: true,
    planted: false,
    eventId: null,
  })
}

/**
 * Investigação (spec §5.7). Notoriedade abre o processo; **prova** condena.
 * Uma aquisição hostil chama atenção da imprensa, mas não é crime — quem leva à
 * condenação é a doação rastreável, a matéria plantada e a demissão em massa.
 */
function stepInvestigations(draft: GameState, log: LogEntry[]): void {
  const open = draft.politics.investigations.find(
    (item) => item.targetId === 'player' && item.status === 'aberta',
  )

  if (!open && draft.player.notoriety >= POLITICS.investigationThreshold) {
    const evidence =
      draft.politics.donations
        .filter((donation) => donation.donorId === 'player' && donation.traceable)
        .reduce((sum) => sum + POLITICS.evidenceDonation, 0) +
      draft.news.headlines.filter((headline) => headline.planted).length *
        POLITICS.evidencePlantedStory

    const shield = draft.politics.politicianOrder.find((id) => {
      const politician = draft.politics.politicians[id]
      return politician && politician.office !== null && politician.loyaltyToPlayer > 60
    })

    draft.politics.investigations.push({
      id: `inq-${draft.date.dayIndex}`,
      targetId: 'player',
      openedDayIndex: draft.date.dayIndex,
      deadlineDayIndex: draft.date.dayIndex + POLITICS.investigationDeadlineDays,
      evidence,
      status: 'aberta',
      lawyerSpend: 0,
      shieldedByPoliticianId: shield ?? null,
    })

    log.push({
      id: `inq-${draft.date.dayIndex}`,
      dayIndex: draft.date.dayIndex,
      severity: 'critico',
      source: 'politics',
      text: shield
        ? 'Uma investigação foi aberta sobre você — mas um aliado no poder está segurando.'
        : 'Uma investigação foi aberta sobre você.',
      amount: null,
    })
    return
  }

  if (!open || draft.date.dayIndex < open.deadlineDayIndex) return

  // Político leal engaveta.
  const shield = open.shieldedByPoliticianId
    ? draft.politics.politicians[open.shieldedByPoliticianId]
    : null
  if (shield && shield.loyaltyToPlayer > 40 && shield.office !== null) {
    open.status = 'arquivada'
    draft.player.notoriety = clamp(draft.player.notoriety - 20, 0, 100)
    log.push({
      id: `inq-shelf-${open.id}`,
      dayIndex: draft.date.dayIndex,
      severity: 'bom',
      source: 'politics',
      text: `${shield.name} engavetou a investigação.`,
      amount: null,
    })
    return
  }

  const probability = open.evidence / (open.evidence + POLITICS.evidenceDivisor)
  if (!chance(draft.rng, probability)) {
    open.status = 'arquivada'
    draft.player.notoriety = clamp(draft.player.notoriety - 25, 0, 100)
    log.push({
      id: `inq-abs-${open.id}`,
      dayIndex: draft.date.dayIndex,
      severity: 'bom',
      source: 'politics',
      text: 'Investigação arquivada por falta de provas.',
      amount: null,
    })
    return
  }

  open.status = 'condenada'
  const fine = draft.player.money * POLITICS.convictionFineRatio
  draft.player.money -= fine
  draft.player.incarceratedDays = POLITICS.convictionPrisonDays
  draft.player.publicReputation = clamp(draft.player.publicReputation - 40, -100, 100)
  draft.player.notoriety = clamp(draft.player.notoriety - 30, 0, 100)

  log.push({
    id: `inq-cond-${open.id}`,
    dayIndex: draft.date.dayIndex,
    severity: 'critico',
    source: 'politics',
    text: 'Você foi condenado: multa pesada e prisão.',
    amount: -fine,
  })
  draft.news.headlines.push({
    id: `hl-cond-${open.id}`,
    outletId: 'tabloide',
    dayIndex: draft.date.dayIndex,
    text: `Empresário ${draft.player.name} é condenado`,
    subject: { kind: 'player', id: 'player' },
    sentiment: -0.9,
    isRumor: false,
    accuracy: 1,
    isTrue: true,
    planted: false,
    eventId: null,
  })
}

export function stepPolitics(draft: GameState, markers: DayMarkers, log: LogEntry[]): void {
  driftApproval(draft)

  // Notoriedade esfria com o tempo: chamar atenção não é crime permanente.
  draft.player.notoriety = Math.max(0, draft.player.notoriety - POLITICS.notorietyDecayPerDay)

  const houseCache = new Map<string, number>()
  for (const id of draft.politics.policyOrder) {
    const policy = draft.politics.policies[id]
    if (!policy || policy.status !== 'tramitando') continue

    const topic = findPolicyDef(policy.id)?.topic ?? 'imposto'
    if (!houseCache.has(topic)) houseCache.set(topic, houseStance(draft, topic))
    const stance = houseCache.get(topic) ?? 0

    policy.supportPct = clamp(
      policy.supportPct + stance * POLITICS.supportDrift + nextFloat(draft.rng) * 0.0004 - 0.0002,
      0,
      1,
    )

    if (policy.voteDayIndex !== null && draft.date.dayIndex >= policy.voteDayIndex) {
      tallyVote(draft, policy, log)
    }
  }

  spontaneousProposal(draft, log)
  proposeFromLoyalty(draft, log)
  stepInvestigations(draft, log)

  if (
    markers.isMonthStart &&
    draft.date.month === POLITICS.electionMonth &&
    draft.date.year % 4 === 1
  ) {
    runElection(draft, log)
  }
}
