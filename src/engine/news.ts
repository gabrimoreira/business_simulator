/**
 * Passo 9 do tick: converte os eventos da rodada em manchetes por veículo.
 * TypeScript puro.
 *
 * Notícia é sempre a **penúltima** etapa do dia: ela reporta o que já aconteceu
 * (spec §3.3). O choque de preço que ela produz é escrito em
 * `stock.eventShockToday` e consumido pelo passo de mercado **amanhã** — o
 * atraso de um dia entre a manchete e o preço é de propósito, e é o que dá
 * tempo de agir sobre o que se leu.
 */
import type { GameState, Headline, LogEntry, WorldEvent } from './types'
import type { DayMarkers } from './clock'
import { chance } from './rng'
import { HEADLINE_WINDOW_SIZE, NEWS } from '../data/config'
import { NEWS_OUTLETS, type NewsOutletDefinition } from '../data/newsOutlets'
import { findEventDef } from '../data/events'
import { renderHeadline } from './events'
import { nominal } from './macro'
import { debit } from './banking'

/** Um veículo só cobre o que passa do piso de relevância dele. */
function covers(outlet: NewsOutletDefinition, priority: number): boolean {
  const threshold = NEWS.minPriorityByReach * (outlet.reach / 100)
  return priority >= threshold
}

/** Viés do veículo sobre o assunto, somado ao sentimento do evento. */
function biasedSentiment(outlet: NewsOutletDefinition, topic: string, sentiment: number): number {
  const bias = outlet.bias[topic] ?? 0
  // Viés positivo em 'escandalo' significa apetite por escândalo: amplifica o
  // que é negativo em vez de suavizar.
  const amplified = sentiment < 0 ? sentiment * (1 + bias * 0.5) : sentiment * (1 - bias * 0.2)
  return Math.max(-1, Math.min(1, amplified))
}

function isSubscribed(state: GameState, outletId: string): boolean {
  return state.market.subscriptions.some((subscription) => subscription.outletId === outletId)
}

/** Choque de preço de uma manchete sobre o papel do alvo. */
function applyShock(draft: GameState, headline: Headline, outlet: NewsOutletDefinition): void {
  if (headline.subject.kind !== 'company') return
  const stock = draft.companies[headline.subject.id]?.stock
  if (!stock) return

  const shock =
    headline.sentiment * (outlet.reach / 100) * (outlet.credibility / 100) * NEWS.priceCoefficient
  stock.eventShockToday += shock
}

function publish(
  draft: GameState,
  event: WorldEvent,
  outlet: NewsOutletDefinition,
  log: LogEntry[],
): void {
  const def = findEventDef(event.definitionId)
  if (!def) return

  // Filtro editorial do rumor. `rumorAccuracy` é o acerto do veículo, não a
  // vontade de publicar: quem apura bem publica quase todo rumor verdadeiro e
  // quase nenhum falso. Usar a precisão como chance de publicação — como estava
  // — fazia o jornal sério publicar **mais** boato que o tabloide, o oposto do
  // que a tabela do §3.11 descreve.
  if (event.pending) {
    const willPublish = event.willHappen ? outlet.rumorAccuracy : 1 - outlet.rumorAccuracy
    if (!chance(draft.rng, willPublish)) return
  }

  const sentiment = biasedSentiment(outlet, def.topic, def.sentiment)
  const headline: Headline = {
    id: `hl-${event.id}-${outlet.id}`,
    outletId: outlet.id,
    dayIndex: draft.date.dayIndex,
    text: event.pending
      ? `Rumor: ${renderHeadline(draft, event, def.headline).toLowerCase()}`
      : renderHeadline(draft, event, def.headline),
    subject: event.subject,
    sentiment,
    isRumor: event.pending,
    accuracy: outlet.rumorAccuracy,
    // Falso é falso mesmo publicado por veículo sério — e ninguém avisa.
    isTrue: event.willHappen,
    planted: false,
    eventId: event.id,
  }

  draft.news.headlines.push(headline)
  applyShock(draft, headline, outlet)

  if (def.priority >= 8) {
    log.push({
      id: `news-${headline.id}`,
      dayIndex: draft.date.dayIndex,
      severity: sentiment <= -0.5 ? 'ruim' : sentiment >= 0.5 ? 'bom' : 'info',
      source: 'news',
      text: `${outlet.name}: ${headline.text}`,
      amount: null,
    })
  }
}

/** Cobrança mensal das assinaturas premium. */
function chargeSubscriptions(draft: GameState, markers: DayMarkers, log: LogEntry[]): void {
  if (!markers.isMonthStart || draft.market.subscriptions.length === 0) return

  let total = 0
  const kept: typeof draft.market.subscriptions = []
  for (const subscription of draft.market.subscriptions) {
    const cost = nominal(draft.macro, subscription.monthlyCost)
    const unpaid = debit(draft, cost)
    if (unpaid > 0.005) {
      log.push({
        id: `sub-cancel-${subscription.outletId}-${draft.date.dayIndex}`,
        dayIndex: draft.date.dayIndex,
        severity: 'ruim',
        source: 'news',
        text: 'Assinatura cancelada por falta de pagamento.',
        amount: null,
      })
      continue
    }
    total += cost
    kept.push(subscription)
  }
  draft.market.subscriptions = kept

  if (total > 0) {
    log.push({
      id: `sub-${draft.date.dayIndex}`,
      dayIndex: draft.date.dayIndex,
      severity: 'info',
      source: 'news',
      text: 'Assinaturas de imprensa.',
      amount: -total,
    })
  }
}

export function stepNews(draft: GameState, markers: DayMarkers, log: LogEntry[]): void {
  chargeSubscriptions(draft, markers, log)

  // O choque de ontem decai antes de receber o de hoje: sem isso, uma sequência
  // de más notícias empilha choque no teto e o preço passa a andar só por
  // manchete.
  for (const id of draft.companyOrder) {
    const stock = draft.companies[id]?.stock
    if (stock) stock.eventShockToday *= NEWS.shockDecay
  }

  for (const event of draft.events.pending) {
    for (const outlet of NEWS_OUTLETS) {
      // Veículo premium só publica para assinante.
      if (outlet.premium && !isSubscribed(draft, outlet.id)) continue

      const dueDay = event.dayIndex + outlet.publishLagDays
      if (draft.date.dayIndex !== dueDay) continue

      const def = findEventDef(event.definitionId)
      if (!def || !covers(outlet, def.priority)) continue

      publish(draft, event, outlet, log)
    }
  }

  if (draft.news.headlines.length > HEADLINE_WINDOW_SIZE) {
    draft.news.headlines.splice(0, draft.news.headlines.length - HEADLINE_WINDOW_SIZE)
  }
}
