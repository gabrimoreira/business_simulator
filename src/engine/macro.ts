/**
 * Passo 2 do tick: ciclo econômico, Selic, inflação e confiança.
 * TypeScript puro.
 *
 * A Selic é o parâmetro mais importante do jogo (spec §5.2): ela define o
 * rendimento da renda fixa, o custo do crédito, o desconto no valuation das
 * ações e o custo da dívida das empresas. Tudo aqui existe para que ela se mova
 * por um motivo legível, e não por ruído.
 */
import type { CyclePhase, GameState, LogEntry, MacroState } from './types'
import type { DayMarkers } from './clock'
import { nextNormal, nextFloat, range } from './rng'
import { CENTRAL_BANK_MEETING_DAYS, MACRO } from '../data/config'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Converte um valor em R$ do ano 0 para o nominal de hoje. */
export function nominal(macro: MacroState, value: number): number {
  return value * macro.priceLevel
}

/** Converte um valor nominal de hoje para R$ do ano 0 — usado no balanceamento. */
export function real(macro: MacroState, value: number): number {
  return value / macro.priceLevel
}

/** Fator de demanda da fase, consumido pelas empresas a partir da Fase 5. */
export function demandFactor(macro: MacroState): number {
  return MACRO.demandFactor[macro.cyclePhase]
}

/** Sorteia a duração da fase, em dias. Consome 1 draw. */
function rollPhaseDuration(state: GameState, phase: CyclePhase): number {
  const [min, max] = MACRO.cycleDurations[phase]
  return Math.round(range(state.rng, min, max))
}

/**
 * Próxima fase. A sequência é a natural, com dois desvios probabilísticos: a
 * expansão pode desabar direto em recessão (choque), e a recuperação pode
 * recair (double dip). Sem eles o ciclo vira um relógio previsível.
 */
function nextPhase(state: GameState, phase: CyclePhase): CyclePhase {
  const roll = nextFloat(state.rng)
  switch (phase) {
    case 'expansao':
      return roll < MACRO.shockFromExpansionChance ? 'recessao' : 'pico'
    case 'pico':
      return 'recessao'
    case 'recessao':
      return 'recuperacao'
    case 'recuperacao':
      return roll < MACRO.doubleDipChance ? 'recessao' : 'expansao'
  }
}

const PHASE_LABEL: Record<CyclePhase, string> = {
  expansao: 'expansão',
  pico: 'pico do ciclo',
  recessao: 'recessão',
  recuperacao: 'recuperação',
}

/** Taxa que o banco central perseguiria hoje (Taylor simplificada). */
export function taylorRate(macro: MacroState): number {
  const target =
    macro.inflation +
    MACRO.neutralRealRate +
    MACRO.taylorInflationWeight * (macro.inflation - macro.inflationTarget) -
    MACRO.taylorGapWeight * macro.outputGap
  return clamp(target, MACRO.selicMin, MACRO.selicMax)
}

export function stepMacro(draft: GameState, _markers: DayMarkers, log: LogEntry[]): void {
  const macro = draft.macro

  // Duração da fase é sorteada na primeira vez que a fase roda.
  if (macro.cycleTargetDays <= 0) {
    macro.cycleTargetDays = rollPhaseDuration(draft, macro.cyclePhase)
  }

  macro.cycleDayCounter += 1
  if (macro.cycleDayCounter >= macro.cycleTargetDays) {
    const phase = nextPhase(draft, macro.cyclePhase)
    macro.cyclePhase = phase
    macro.cycleDayCounter = 0
    macro.cycleTargetDays = rollPhaseDuration(draft, phase)
    log.push({
      id: `macro-phase-${draft.date.dayIndex}`,
      dayIndex: draft.date.dayIndex,
      severity: phase === 'recessao' ? 'ruim' : phase === 'expansao' ? 'bom' : 'info',
      source: 'macro',
      text: `A economia entrou em ${PHASE_LABEL[phase]}.`,
      amount: null,
    })
  }

  const phase = macro.cyclePhase

  // Convergência suave para os alvos da fase.
  const confidenceTarget = MACRO.confidenceTarget[phase]
  const confidenceStep = Math.sign(confidenceTarget - macro.confidence) * MACRO.confidenceSpeed
  macro.confidence = clamp(
    Math.abs(confidenceTarget - macro.confidence) < MACRO.confidenceSpeed
      ? confidenceTarget
      : macro.confidence + confidenceStep,
    0,
    100,
  )

  const unemploymentTarget = MACRO.unemploymentTarget[phase]
  macro.unemployment = clamp(
    macro.unemployment + (unemploymentTarget - macro.unemployment) * MACRO.unemploymentSpeed,
    0.01,
    0.35,
  )

  const gapTarget = MACRO.outputGapTarget[phase]
  macro.outputGap += (gapTarget - macro.outputGap) * MACRO.outputGapSpeed

  // Inflação persegue meta + pressão de demanda − juro real. O termo do juro
  // real é o que fecha o laço e impede espiral.
  const realRate = macro.selic - macro.inflation
  const equilibrium =
    macro.inflationTarget +
    macro.outputGap * MACRO.inflationPassthrough -
    realRate * MACRO.inflationSelicWeight
  macro.inflation = clamp(
    macro.inflation +
      (equilibrium - macro.inflation) * MACRO.inflationSpeed +
      nextNormal(draft.rng) * MACRO.inflationNoise,
    MACRO.inflationMin,
    MACRO.inflationMax,
  )

  // Índice de preços: capitaliza a inflação anual em base diária.
  macro.priceLevel *= 1 + macro.inflation / 365

  // Reunião do banco central.
  if (draft.date.dayIndex >= macro.nextMeetingDayIndex) {
    const before = macro.selic
    const target = taylorRate(macro)
    macro.selic = clamp(
      before + (target - before) * MACRO.selicSmoothing,
      MACRO.selicMin,
      MACRO.selicMax,
    )
    macro.nextMeetingDayIndex = draft.date.dayIndex + CENTRAL_BANK_MEETING_DAYS

    const delta = macro.selic - before
    if (Math.abs(delta) >= 0.0025) {
      log.push({
        id: `macro-selic-${draft.date.dayIndex}`,
        dayIndex: draft.date.dayIndex,
        severity: 'info',
        source: 'macro',
        text: `Banco central ${delta > 0 ? 'elevou' : 'reduziu'} a Selic para ${(
          macro.selic * 100
        ).toFixed(2)}%.`,
        amount: null,
      })
    }
  }
}
