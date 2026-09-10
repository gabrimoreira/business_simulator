/**
 * Passo 10 do tick e as regras derivadas do jogador. TypeScript puro.
 * Todos os números vêm de `src/data/` (CLAUDE.md §5).
 */
import type { EndingKind, GameState, LogEntry, Skills, StartArchetype } from './types'
import type { DayMarkers } from './clock'
import { CAREER, ENDGAME, RETIREMENT_AGE, VITALS } from '../data/config'
import { MONTHLY_BILLS } from '../data/living'
import { findJob } from '../data/jobs'
import { findAsset } from '../data/assets'
import { ASSETS_CONFIG } from '../data/config'
import { nominal } from './macro'
import { debit } from './banking'
import { netWorth } from './selectors'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const clampVital = (value: number): number => clamp(value, 0, VITALS.max)

/**
 * Penalidade multiplicativa de humor baixo sobre produtividade e qualidade de
 * decisão (spec §5.1). Usada pelo trabalho e, a partir da Fase 5, pela gestão.
 */
export function moodMultiplier(mood: number): number {
  if (mood < VITALS.veryLowMoodThreshold) return VITALS.veryLowMoodMultiplier
  if (mood < VITALS.lowMoodThreshold) return VITALS.lowMoodMultiplier
  return 1
}

/** Recuperação do sono na virada do dia — automática, não consome bloco (C3). */
export function sleepRecovery(state: GameState): number {
  const { health, mood, hunger } = state.player
  const healthFactor = 0.6 + 0.4 * (health / VITALS.max)
  const moodFactor = 0.8 + 0.2 * (mood / VITALS.max)
  // Moradia melhor dorme melhor: é o retorno concreto de comprar um imóvel.
  const residence = state.personalAssets.residenceId
    ? (findAsset(
        state.personalAssets.assets.find((asset) => asset.id === state.personalAssets.residenceId)
          ?.assetId ?? '',
      )?.comfort ?? 1)
    : 1
  const base = VITALS.sleepBase * healthFactor * moodFactor * residence
  const penalty = hunger < VITALS.lowHungerThreshold ? VITALS.lowHungerSleepPenalty : 0
  return Math.max(0, base - penalty)
}

export function skillValue(skills: Skills, key: keyof Skills): number {
  return skills[key]
}

/** Salário do mês corrente, já com o reajuste acumulado. */
function payday(draft: GameState, log: LogEntry[]): void {
  const { player } = draft
  if (!player.currentJobId) return
  const salary = player.career.salary
  if (salary <= 0) return
  player.money += salary
  log.push({
    id: `pay-${draft.date.dayIndex}`,
    dayIndex: draft.date.dayIndex,
    severity: 'bom',
    source: 'player',
    text: 'Salário creditado.',
    amount: salary,
  })
  settleOverdue(draft, log)
}

/** Quita o que estiver atrasado assim que entra dinheiro. */
function settleOverdue(draft: GameState, log: LogEntry[]): void {
  const { player } = draft
  if (player.overdueBills <= 0) return
  const unpaid = debit(draft, player.overdueBills)
  const paid = player.overdueBills - unpaid
  if (paid <= 0) return
  player.overdueBills = unpaid
  log.push({
    id: `overdue-pay-${draft.date.dayIndex}`,
    dayIndex: draft.date.dayIndex,
    severity: 'info',
    source: 'player',
    text: 'Contas atrasadas quitadas.',
    amount: -paid,
  })
}

function billsDay(draft: GameState, log: LogEntry[]): void {
  const { player, personalAssets } = draft
  // As constantes estão em R$ do ano 0: convertidas para o nominal de hoje.
  const total = nominal(
    draft.macro,
    personalAssets.monthlyRent + MONTHLY_BILLS.transport + MONTHLY_BILLS.health,
  )
  let unpaid = debit(draft, total)

  // Sobrou conta? O cartão cobre o rombo — a um custo que dói depois.
  for (const card of draft.banking.cards) {
    if (unpaid <= 0) break
    const room = Math.max(0, card.limit - card.balance)
    const charged = Math.min(room, unpaid)
    card.balance += charged
    unpaid -= charged
  }

  const paid = total - unpaid
  if (unpaid > 0) {
    player.overdueBills += unpaid
    log.push({
      id: `bills-${draft.date.dayIndex}`,
      dayIndex: draft.date.dayIndex,
      severity: 'ruim',
      source: 'player',
      text: 'Não deu para pagar todas as contas do mês.',
      amount: -paid,
    })
  } else {
    log.push({
      id: `bills-${draft.date.dayIndex}`,
      dayIndex: draft.date.dayIndex,
      severity: 'info',
      source: 'player',
      text: 'Contas do mês pagas.',
      amount: -paid,
    })
  }
}

/** Reajuste anual do salário pela inflação (spec §5.1). */
function adjustSalary(draft: GameState, log: LogEntry[]): void {
  const { player } = draft
  if (!player.currentJobId || player.career.salary <= 0) return
  const before = player.career.salary
  player.career.salary = before * (1 + draft.macro.inflation)
  player.career.daysSinceLastRaise = 0
  log.push({
    id: `raise-${draft.date.dayIndex}`,
    dayIndex: draft.date.dayIndex,
    severity: 'info',
    source: 'player',
    text: 'Salário reajustado pela inflação.',
    amount: player.career.salary - before,
  })
}

/**
 * Ativos pessoais (spec §5.10): valor anda, aluguel entra, manutenção sai e o
 * luxo cobra notoriedade todo dia — porque aparecer tem preço.
 */
function stepAssets(draft: GameState, markers: DayMarkers, log: LogEntry[]): void {
  const { personalAssets, player } = draft
  if (personalAssets.assets.length === 0) return

  let rent = 0
  let upkeep = 0

  for (const asset of personalAssets.assets) {
    const definition = findAsset(asset.assetId)
    if (!definition) continue

    // Imóvel acompanha a inflação por cima da valorização real.
    const drift =
      asset.kind === 'imovel'
        ? definition.annualValueChange + draft.macro.inflation
        : definition.annualValueChange
    asset.currentValue = Math.max(0, asset.currentValue * (1 + drift / 365))

    if (asset.notorietyCost > 0) {
      player.notoriety = clamp(
        player.notoriety + asset.notorietyCost * ASSETS_CONFIG.notorietyPerDay,
        0,
        100,
      )
    }

    if (markers.isMonthStart) {
      // Só rende quem não é a sua casa.
      if (!asset.isResidence) rent += nominal(draft.macro, definition.monthlyIncome)
      upkeep += nominal(draft.macro, definition.upkeep)
    }
  }

  if (rent > 0) {
    player.money += rent
    log.push({
      id: `rent-${draft.date.dayIndex}`,
      dayIndex: draft.date.dayIndex,
      severity: 'bom',
      source: 'assets',
      text: 'Aluguéis recebidos.',
      amount: rent,
    })
  }
  if (upkeep > 0) {
    const unpaid = debit(draft, upkeep)
    player.overdueBills += unpaid
    log.push({
      id: `upkeep-${draft.date.dayIndex}`,
      dayIndex: draft.date.dayIndex,
      severity: 'info',
      source: 'assets',
      text: 'Manutenção dos bens.',
      amount: -(upkeep - unpaid),
    })
  }
}

/**
 * Passo 10: sono, decaimento, dinheiro do mês, envelhecimento e fim de jogo.
 * Roda depois que a data já avançou (passo 1).
 */
export function stepPlayer(draft: GameState, markers: DayMarkers, log: LogEntry[]): void {
  const { player } = draft

  // Sono: acontece antes do decaimento porque é a virada da noite anterior.
  player.energy = clampVital(player.energy + sleepRecovery(draft))

  player.hunger = clampVital(player.hunger - VITALS.hungerDecayPerDay)
  player.mood = clampVital(player.mood - VITALS.moodDecayPerDay)

  if (player.hunger <= 0) {
    player.health = clampVital(player.health - VITALS.starvingHealthDrain)
  }
  if (player.mood < VITALS.veryLowMoodThreshold) {
    player.health = clampVital(player.health - VITALS.lowMoodHealthDrain)
  }
  if (player.age >= VITALS.agingStartsAtAge) {
    player.health = clampVital(player.health - VITALS.agingHealthDrainPerDay)
  }
  if (
    player.hunger > VITALS.healthRecoveryMinHunger &&
    player.energy > VITALS.healthRecoveryMinEnergy
  ) {
    player.health = clampVital(player.health + VITALS.healthRecoveryPerDay)
  }
  if (player.overdueBills > 0) {
    player.mood = clampVital(player.mood - VITALS.overdueMoodDrainPerDay)
    player.creditScore = clamp(player.creditScore - VITALS.overdueScoreDrainPerDay, 0, 1000)
  }

  if (player.currentJobId) {
    player.career.daysInJob += 1
    player.career.daysSinceLastRaise += 1
    // Desempenho decai todo dia; trabalhar repõe com folga. Sem isso, quem foi
    // promovido uma vez ficaria elegível para sempre sem aparecer no serviço.
    player.career.performance = clamp(
      player.career.performance - CAREER.performanceDecayPerIdleDay,
      0,
      100,
    )
  }
  if (player.incarceratedDays > 0) player.incarceratedDays -= 1

  stepAssets(draft, markers, log)

  if (markers.isPayday) payday(draft, log)
  if (markers.isBillsDay && draft.date.dayIndex >= CAREER.firstBillsGraceDays) {
    billsDay(draft, log)
  }
  if (markers.isYearStart) adjustSalary(draft, log)

  if (markers.isBirthday) {
    log.push({
      id: `birthday-${draft.date.dayIndex}`,
      dayIndex: draft.date.dayIndex,
      severity: 'info',
      source: 'player',
      text: `Você fez ${player.age} anos.`,
      amount: null,
    })
  }

  checkEnding(draft, log)
}

/**
 * Encerra a partida (spec §5.11).
 *
 * A manchete de fecho é escrita **aqui**, e não no passo de notícias: o tick
 * para de avançar assim que `meta.ending` é marcado, e o passo 9 do dia seguinte
 * nunca chegaria a rodar. Sai pelo veículo de maior alcance, como o spec pede.
 */
export function finishRun(draft: GameState, ending: EndingKind, log: LogEntry[]): void {
  if (draft.meta.ending) return
  draft.meta.ending = ending

  const worth = netWorth(draft)
  const founded = draft.meta.companiesFoundedCount

  const closing: Record<EndingKind, string> = {
    aposentadoria: `${draft.player.name} se aposenta aos ${draft.player.age} com ${formatBig(worth)}`,
    morte: `Morre ${draft.player.name}, aos ${draft.player.age} anos`,
    falencia: `${draft.player.name} perde tudo e sai de cena`,
    prisao: `${draft.player.name} termina a vida pública atrás das grades`,
    desistencia: `${draft.player.name} deixa os negócios aos ${draft.player.age}, com ${formatBig(worth)}`,
  }

  // Veículo de maior alcance da praça.
  const outlet = draft.news.outletOrder.reduce(
    (best, id) => {
      const current = draft.news.outlets[id]
      if (!current) return best
      return !best || current.reach > best.reach ? current : best
    },
    null as (typeof draft.news.outlets)[string] | null,
  )

  const headline = closing[ending]
  if (outlet) {
    draft.news.headlines.push({
      id: `hl-fim-${draft.date.dayIndex}`,
      outletId: outlet.id,
      dayIndex: draft.date.dayIndex,
      text: headline,
      subject: { kind: 'player', id: 'player' },
      sentiment: ending === 'aposentadoria' ? 0.5 : -0.7,
      isRumor: false,
      accuracy: 1,
      isTrue: true,
      planted: false,
      eventId: null,
    })
  }

  draft.meta.ranking.push({
    id: `run-${draft.createdAt}-${draft.date.dayIndex}`,
    playerName: draft.player.name,
    endedAtDayIndex: draft.date.dayIndex,
    ending,
    netWorth: worth,
    companiesFounded: founded,
    officesHeld: [...draft.meta.officesHeld],
    finalHeadline: headline,
    startArchetype: draft.meta.startArchetype,
  })
  draft.meta.ranking.sort((a, b) => b.netWorth - a.netWorth)
  if (draft.meta.ranking.length > ENDGAME.rankingSize) {
    draft.meta.ranking.length = ENDGAME.rankingSize
  }

  // New Game+: patrimônio alcançado destrava arquétipo inicial.
  for (const [id, archetype] of Object.entries(ENDGAME.archetypes)) {
    if (archetype.unlockNetWorth <= 0) continue
    if (worth < archetype.unlockNetWorth) continue
    if (draft.meta.unlockedArchetypes.includes(id as StartArchetype)) continue
    draft.meta.unlockedArchetypes.push(id as StartArchetype)
    log.push({
      id: `unlock-${id}`,
      dayIndex: draft.date.dayIndex,
      severity: 'bom',
      source: 'meta',
      text: `Novo começo desbloqueado: ${id}.`,
      amount: null,
    })
  }

  log.push({
    id: `end-${draft.date.dayIndex}`,
    dayIndex: draft.date.dayIndex,
    severity: ending === 'aposentadoria' ? 'info' : 'critico',
    source: 'player',
    text: headline,
    amount: null,
  })
}

/** Formatação curta só para a manchete; a UI tem a sua própria. */
function formatBig(value: number): string {
  if (Math.abs(value) >= 1e9) return `R$ ${(value / 1e9).toFixed(1)} bi`
  if (Math.abs(value) >= 1e6) return `R$ ${(value / 1e6).toFixed(1)} mi`
  return `R$ ${Math.round(value)}`
}

function checkEnding(draft: GameState, log: LogEntry[]): void {
  const { player, meta } = draft
  if (meta.ending) return

  if (player.health <= 0) {
    finishRun(draft, 'morte', log)
    return
  }
  if (player.age >= RETIREMENT_AGE) {
    finishRun(draft, 'aposentadoria', log)
  }
}

/** Energia gasta ao trabalhar, ajustada pelo desgaste do cargo. */
export function workEnergyCost(state: GameState, baseCost: number): number {
  const job = state.player.currentJobId ? findJob(state.player.currentJobId) : null
  if (!job) return baseCost
  const multipliers = { baixo: 0.85, medio: 1, alto: 1.15 } as const
  return baseCost * multipliers[job.wear]
}

/** Ganho de desempenho de um dia de trabalho, penalizado por exaustão e humor. */
export function performanceGain(state: GameState): number {
  const tired = state.player.energy < CAREER.lowEnergyThreshold
  const base = CAREER.performanceGainPerWork * moodMultiplier(state.player.mood)
  return tired ? base * CAREER.lowEnergyPerformancePenalty : base
}

export interface Eligibility {
  ok: boolean
  /** Motivos legíveis do porquê não pode — a UI lista, a ação recusa. */
  missing: string[]
}

/**
 * Requisitos de uma vaga (spec §5.1). Consumido pela ação `candidatar` e pela
 * lista de vagas do Perfil — os dois precisam da mesma resposta, sempre.
 */
export function jobEligibility(state: GameState, jobId: string): Eligibility {
  const job = findJob(jobId)
  if (!job) return { ok: false, missing: ['Vaga inexistente.'] }

  const { player } = state
  const missing: string[] = []

  const labels: Record<keyof Skills, string> = {
    intelligence: 'Inteligência',
    charisma: 'Carisma',
    technical: 'Técnica',
    fitness: 'Preparo físico',
  }
  for (const [key, required] of Object.entries(job.requirements.skills) as Array<
    [keyof Skills, number]
  >) {
    if (player.skills[key] < required) {
      missing.push(`${labels[key]} ${Math.floor(player.skills[key])}/${required}`)
    }
  }

  for (const courseId of job.requirements.education) {
    if (!player.education.includes(courseId)) missing.push(`Formação: ${courseId}`)
  }

  if (job.requirements.minDaysInPreviousJob > 0) {
    if (!player.currentJobId) {
      missing.push('Exige experiência no cargo anterior')
    } else if (player.career.daysInJob < job.requirements.minDaysInPreviousJob) {
      missing.push(
        `Tempo no cargo ${player.career.daysInJob}/${job.requirements.minDaysInPreviousJob} dias`,
      )
    } else if (player.career.performance < CAREER.minPerformanceForPromotion) {
      missing.push(
        `Desempenho ${Math.floor(player.career.performance)}/${CAREER.minPerformanceForPromotion}`,
      )
    }
  }

  return { ok: missing.length === 0, missing }
}

/**
 * Probabilidade de ser contratado, dada a folga sobre o mínimo exigido.
 * Requisito atendido não garante a vaga — é o que dá peso a carisma e reputação.
 */
export function hireChance(state: GameState, jobId: string): number {
  const job = findJob(jobId)
  if (!job) return 0
  const { player } = state

  let margin = 0
  for (const [key, required] of Object.entries(job.requirements.skills) as Array<
    [keyof Skills, number]
  >) {
    margin += player.skills[key] - required
  }

  const chance =
    CAREER.hireBaseChance +
    margin * CAREER.hireSkillMarginWeight +
    player.skills.charisma * CAREER.hireCharismaWeight +
    player.publicReputation * CAREER.hireReputationWeight

  return clamp(chance, 0.02, CAREER.hireMaxChance)
}
