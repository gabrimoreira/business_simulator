/**
 * Passo 3 do tick: sorteio de eventos do mundo e resolução de rumores.
 * TypeScript puro.
 *
 * Um evento pode nascer **rumor**: publicável hoje, com efeito só no dia em que
 * se resolver — e uma parte dos rumores nunca se confirma. É isso que dá ao
 * jogador algo em que apostar e, a partir da Fase 5b, o que faz um NPC reagir a
 * algo que não aconteceu (spec §5.12 Regra 2).
 */
import type { Company, EventEffect, GameState, LogEntry, WorldEvent } from './types'
import type { DayMarkers } from './clock'
import { chance, nextInt, pickWeighted } from './rng'
import { EVENTS } from '../data/config'
import { EVENT_DEFS, findEventDef, type EventContext, type EventDef } from '../data/events'
import { findIndustry } from '../data/industries'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Empresa sorteada entre as ativas, com peso igual. */
function pickCompany(draft: GameState): Company | null {
  const active = draft.companyOrder
    .map((id) => draft.companies[id])
    .filter((company): company is Company => !!company && company.status === 'ativa')
  if (active.length === 0) return null
  return active[nextInt(draft.rng, 0, active.length)] ?? null
}

function pickIndustry(draft: GameState): string | null {
  if (draft.industryOrder.length === 0) return null
  return draft.industryOrder[nextInt(draft.rng, 0, draft.industryOrder.length)] ?? null
}

function subjectName(draft: GameState, event: WorldEvent): string {
  switch (event.subject.kind) {
    case 'company':
      return draft.companies[event.subject.id]?.name ?? 'a empresa'
    case 'player':
      return draft.player.name
    default:
      return findIndustry(event.subject.id)?.name ?? event.subject.id
  }
}

/** Texto final da manchete, com o alvo substituído. */
export function renderHeadline(draft: GameState, event: WorldEvent, template: string): string {
  return template.replace('{alvo}', subjectName(draft, event))
}

function applyEffect(draft: GameState, event: WorldEvent, effect: EventEffect): void {
  const apply = (current: number): number => {
    if (effect.mode === 'set') return effect.value
    if (effect.mode === 'multiply') return current * effect.value
    return current + effect.value
  }

  switch (effect.target) {
    case 'company.revenue':
    case 'company.cash':
    case 'company.capacity':
    case 'company.baseMargin':
    case 'company.reputation': {
      const company = draft.companies[event.subject.id]
      if (!company) return
      const field = effect.target.split('.')[1] as
        | 'revenue'
        | 'cash'
        | 'capacity'
        | 'baseMargin'
        | 'reputation'
      // `multiply` sobre caixa negativo pioraria a dívida em vez de reduzi-la.
      const base = field === 'cash' && effect.mode === 'multiply' ? Math.abs(company.cash) : company[field]
      const next = field === 'cash' && effect.mode === 'multiply' ? company.cash + base * effect.value : apply(company[field])
      company[field] = field === 'reputation' ? clamp(next, 0, 100) : next
      return
    }
    case 'industry.marketSize': {
      const industryId = event.scope === 'setor' ? event.subject.id : null
      const targets = industryId ? [industryId] : draft.industryOrder
      for (const id of targets) {
        const industry = draft.industries[id]
        if (industry) industry.marketSize = apply(industry.marketSize)
      }
      return
    }
    case 'macro.confidence':
      draft.macro.confidence = clamp(apply(draft.macro.confidence), 0, 100)
      return
    case 'macro.inflation':
      draft.macro.inflation = apply(draft.macro.inflation)
      return
    case 'player.money':
      draft.player.money = Math.max(0, apply(draft.player.money))
      return
    case 'player.health':
      draft.player.health = clamp(apply(draft.player.health), 0, 100)
      return
    case 'player.mood':
      draft.player.mood = clamp(apply(draft.player.mood), 0, 100)
      return
    case 'player.energy':
      draft.player.energy = clamp(apply(draft.player.energy), 0, 100)
      return
    case 'player.notoriety':
      draft.player.notoriety = clamp(apply(draft.player.notoriety), 0, 100)
      return
    default:
      return
  }
}

/** Materializa os efeitos de um evento e marca como aplicado. */
export function resolveEvent(draft: GameState, event: WorldEvent, log: LogEntry[]): void {
  const def = findEventDef(event.definitionId)
  if (!def || event.applied) return

  for (const effect of def.effects) {
    applyEffect(draft, event, effect)
    if (effect.durationDays > 0) {
      draft.events.active.push({
        id: `eff-${event.id}-${draft.events.active.length}`,
        eventId: event.id,
        effect,
        remainingDays: effect.durationDays,
      })
    }
  }

  event.applied = true
  log.push({
    id: `evt-${event.id}`,
    dayIndex: draft.date.dayIndex,
    severity: def.sentiment >= 0.3 ? 'bom' : def.sentiment <= -0.3 ? 'ruim' : 'info',
    source: 'events',
    text: renderHeadline(draft, event, def.headline),
    amount: null,
  })
}

/**
 * Chave do cooldown. Inclui o alvo de propósito: greve na empresa A não pode
 * bloquear greve na empresa B por um ano. Com a chave só na definição, o mundo
 * ficava mudo depois dos primeiros quinze eventos — medido no navegador, com a
 * manchete mais recente do feed tendo 19 dias.
 */
export function cooldownKey(definitionId: string, subjectId: string): string {
  return `${definitionId}:${subjectId}`
}

function candidatesFor(draft: GameState, company: Company | null, industryId: string | null): EventDef[] {
  const context: EventContext = { state: draft, company, industryId }
  return EVENT_DEFS.filter((def) => {
    const subjectId =
      def.scope === 'empresa' ? company?.id : def.scope === 'setor' ? industryId : 'player'
    const last = draft.events.lastFiredDayIndex[cooldownKey(def.id, subjectId ?? 'global')]
    if (last !== undefined && draft.date.dayIndex - last < def.cooldownDays) return false
    if (def.scope === 'empresa' && !company) return false
    if (def.scope === 'setor' && !industryId) return false
    return def.when(context)
  })
}

export function stepEvents(draft: GameState, _markers: DayMarkers, log: LogEntry[]): void {
  // 1. Efeitos com duração continuam agindo.
  for (const active of draft.events.active) {
    const event = draft.events.pending.find((item) => item.id === active.eventId)
    if (event) applyEffect(draft, event, active.effect)
    active.remainingDays -= 1
  }
  draft.events.active = draft.events.active.filter((active) => active.remainingDays > 0)

  // 2. Rumores que venceram: os verdadeiros acontecem, os falsos morrem.
  for (const event of draft.events.pending) {
    if (!event.pending) continue
    if (event.resolvesDayIndex === null || draft.date.dayIndex < event.resolvesDayIndex) continue
    event.pending = false
    if (event.willHappen) resolveEvent(draft, event, log)
  }

  // 3. Descarta o que já saiu da janela de noticiabilidade.
  draft.events.pending = draft.events.pending.filter(
    (event) =>
      event.pending || draft.date.dayIndex - event.dayIndex <= EVENTS.pendingWindowDays,
  )

  // 4. Sorteia o evento do dia.
  if (!chance(draft.rng, EVENTS.dailyChance)) return

  const company = pickCompany(draft)
  const industryId = pickIndustry(draft)
  const candidates = candidatesFor(draft, company, industryId)
  if (candidates.length === 0) return

  const def = pickWeighted(draft.rng, candidates, (item) => item.weight)
  const subject =
    def.scope === 'empresa' && company
      ? ({ kind: 'company', id: company.id } as const)
      : def.scope === 'setor' && industryId
        ? ({ kind: 'industry', id: industryId } as const)
        : ({ kind: 'player', id: 'player' } as const)

  const isRumor = def.rumorable && chance(draft.rng, EVENTS.rumorChance)
  const willHappen = isRumor ? !chance(draft.rng, EVENTS.falseRumorChance) : true

  const event: WorldEvent = {
    id: `ev-${draft.date.dayIndex}-${def.id}`,
    definitionId: def.id,
    dayIndex: draft.date.dayIndex,
    scope: def.scope,
    subject,
    priority: def.priority,
    pending: isRumor,
    resolvesDayIndex: isRumor
      ? draft.date.dayIndex + nextInt(draft.rng, EVENTS.rumorMinDays, EVENTS.rumorMaxDays)
      : null,
    willHappen,
    applied: false,
  }

  draft.events.pending.push(event)
  draft.events.lastFiredDayIndex[cooldownKey(def.id, subject.id)] = draft.date.dayIndex

  // Evento não-rumor acontece agora; rumor só na data de resolução.
  if (!isRumor) resolveEvent(draft, event, log)
}
