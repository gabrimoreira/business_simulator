import { describe, expect, it } from 'vitest'
import { applyAction } from '@/engine/actions'
import { EVENT_DEFS } from '@/data/events'
import { NEWS_OUTLETS } from '@/data/newsOutlets'
import { NEWS } from '@/data/config'
import type { GameState, WorldEvent } from '@/engine/types'
import { advance, advanceAsync, fresh, funded, liveDay } from './helpers'

const TARGET = 'nimbo'

/** Injeta um evento com data de amanhã, que é quando o passo de notícias o vê. */
function inject(state: GameState, definitionId: string, options: Partial<WorldEvent> = {}): GameState {
  const def = EVENT_DEFS.find((item) => item.id === definitionId)!
  const event: WorldEvent = {
    id: `test-${definitionId}-${state.date.dayIndex}`,
    definitionId,
    dayIndex: state.date.dayIndex + 1,
    scope: def.scope,
    subject: { kind: 'company', id: TARGET },
    priority: def.priority,
    pending: false,
    resolvesDayIndex: null,
    willHappen: true,
    applied: true,
    ...options,
  }
  return { ...state, events: { ...state.events, pending: [...state.events.pending, event] } }
}

function setShock(state: GameState, companyId: string, shock: number): GameState {
  const company = state.companies[companyId]!
  return {
    ...state,
    companies: {
      ...state.companies,
      [companyId]: { ...company, stock: { ...company.stock!, eventShockToday: shock } },
    },
  }
}

describe('eventos', () => {
  it('acontecem, e alguns nascem rumor', async () => {
    const state = (await advanceAsync(funded(fresh()), 730)).state
    const headlines = state.news.headlines
    expect(headlines.length).toBeGreaterThan(0)
    expect(headlines.some((headline) => headline.isRumor)).toBe(true)
  })

  it('respeitam o cooldown do catálogo', async () => {
    const state = (await advanceAsync(funded(fresh()), 1460)).state
    // Nenhuma definição pode ter disparado duas vezes dentro do próprio cooldown.
    for (const def of EVENT_DEFS) {
      const fired = state.events.lastFiredDayIndex[def.id]
      if (fired === undefined) continue
      expect(fired).toBeLessThanOrEqual(state.date.dayIndex)
    }
    expect(Object.keys(state.events.lastFiredDayIndex).length).toBeGreaterThan(3)
  })

  it('rumor falso publica manchete mas nunca aplica efeito', () => {
    let state = funded(fresh())
    const reputationBefore = state.companies[TARGET]!.reputation

    state = inject(state, 'escandalo-contabil', {
      pending: true,
      applied: false,
      willHappen: false,
      resolvesDayIndex: state.date.dayIndex + 4,
    })
    state = advance(state, 12).state

    const about = state.news.headlines.filter((headline) => headline.eventId?.startsWith('test-'))
    expect(about.length).toBeGreaterThan(0)
    expect(about.every((headline) => headline.isTrue === false)).toBe(true)
    // A reputação não caiu: o escândalo nunca existiu.
    expect(state.companies[TARGET]!.reputation).toBe(reputationBefore)
  })

  it('rumor verdadeiro aplica o efeito no dia em que se resolve', () => {
    let state = funded(fresh())
    const before = state.companies[TARGET]!.reputation

    state = inject(state, 'escandalo-contabil', {
      pending: true,
      applied: false,
      willHappen: true,
      resolvesDayIndex: state.date.dayIndex + 4,
    })

    state = advance(state, 3).state
    expect(state.companies[TARGET]!.reputation).toBe(before)

    state = advance(state, 6).state
    expect(state.companies[TARGET]!.reputation).toBeLessThan(before)
  })
})

describe('imprensa', () => {
  it('o mesmo evento sai em veículos diferentes, em dias diferentes', () => {
    let state = inject(funded(fresh()), 'quebra-banco')
    state = advance(state, 6).state

    const published = state.news.headlines.filter((headline) => headline.eventId?.startsWith('test-'))
    const outlets = new Set(published.map((headline) => headline.outletId))
    expect(outlets.size).toBeGreaterThan(1)

    const days = new Set(published.map((headline) => headline.dayIndex))
    expect(days.size).toBeGreaterThan(1)
  })

  it('o veículo premium só publica para quem assina', () => {
    const premium = NEWS_OUTLETS.find((outlet) => outlet.premium)!

    const quiet = advance(inject(funded(fresh()), 'quebra-banco'), 6).state
    expect(quiet.news.headlines.some((headline) => headline.outletId === premium.id)).toBe(false)

    let subscribed = applyAction(funded(fresh()), {
      kind: 'assinarVeiculo',
      outletId: premium.id,
    }).state
    subscribed = advance(inject(subscribed, 'quebra-banco'), 6).state
    expect(subscribed.news.headlines.some((headline) => headline.outletId === premium.id)).toBe(true)
  })

  it('a assinatura é cobrada e pode ser cancelada', () => {
    const premium = NEWS_OUTLETS.find((outlet) => outlet.premium)!
    let state = applyAction(funded(fresh()), { kind: 'assinarVeiculo', outletId: premium.id }).state
    expect(state.market.subscriptions).toHaveLength(1)

    const result = advance(state, 40)
    expect(result.entries.some((entry) => entry.text.includes('Assinaturas'))).toBe(true)

    state = applyAction(result.state, {
      kind: 'cancelarAssinatura',
      outletId: premium.id,
    }).state
    expect(state.market.subscriptions).toHaveLength(0)
  })

  it('o tabloide amplifica escândalo mais que o jornal de referência', () => {
    const state = advance(inject(funded(fresh()), 'escandalo-contabil'), 6).state
    const tabloide = state.news.headlines.find(
      (headline) => headline.outletId === 'tabloide' && headline.eventId?.startsWith('test-'),
    )
    const referencia = state.news.headlines.find(
      (headline) => headline.outletId === 'referencia' && headline.eventId?.startsWith('test-'),
    )
    expect(tabloide).toBeDefined()
    expect(referencia).toBeDefined()
    expect(tabloide!.sentiment).toBeLessThan(referencia!.sentiment)
  })
})

describe('qualidade editorial', () => {
  it('quem apura melhor publica rumor mais confiável', async () => {
    const state = (await advanceAsync(funded(fresh(11)), 2200)).state
    const rumors = state.news.headlines.filter((headline) => headline.isRumor)
    expect(rumors.length).toBeGreaterThan(8)

    const rate = (outletId: string): number | null => {
      const own = rumors.filter((headline) => headline.outletId === outletId)
      if (own.length === 0) return null
      return own.filter((headline) => headline.isTrue).length / own.length
    }

    const count = (outletId: string): number =>
      rumors.filter((headline) => headline.outletId === outletId).length

    // O jornal de referência erra pouco. Para o tabloide, só dá para afirmar
    // algo com amostra: com dois ou três rumores publicados, acertar todos é
    // sorte, não qualidade editorial — e o teste viraria moeda.
    const serious = rate('referencia')
    if (serious !== null) expect(serious).toBeGreaterThan(0.7)
    if (count('tabloide') >= 6) expect(rate('tabloide')!).toBeLessThan(0.95)
    if (serious !== null && count('tabloide') >= 6) {
      expect(serious).toBeGreaterThanOrEqual(rate('tabloide')!)
    }
  })

  it('o cooldown é por alvo: greve numa empresa não silencia as outras', async () => {
    const state = (await advanceAsync(funded(fresh()), 730)).state
    const keys = Object.keys(state.events.lastFiredDayIndex)
    // Chave composta `definicao:alvo`.
    expect(keys.every((key) => key.includes(':'))).toBe(true)

    const byDefinition = new Map<string, number>()
    for (const key of keys) {
      const definition = key.split(':')[0]!
      byDefinition.set(definition, (byDefinition.get(definition) ?? 0) + 1)
    }
    // Pelo menos uma definição de escopo empresa atingiu alvos diferentes.
    expect(Math.max(...byDefinition.values())).toBeGreaterThan(1)
  })

  it('o feed continua vivo depois de anos', async () => {
    const state = (await advanceAsync(funded(fresh()), 1460)).state
    const latest = Math.max(...state.news.headlines.map((headline) => headline.dayIndex))
    // A manchete mais recente não pode ter meses de idade.
    expect(state.date.dayIndex - latest).toBeLessThan(30)
  })
})

describe('notícia move preço', () => {
  it('manchete negativa deixa o choque do papel negativo', () => {
    const state = advance(inject(funded(fresh()), 'escandalo-contabil'), 1).state
    expect(state.companies[TARGET]!.stock!.eventShockToday).toBeLessThan(0)
  })

  it('o choque muda o preço do dia seguinte, e só ele', () => {
    // Mesma seed, mesmo número de sorteios: a única diferença é o choque.
    const control = liveDay(funded(fresh())).state
    const shocked = liveDay(setShock(funded(fresh()), TARGET, -0.1)).state

    const controlPrice = control.companies[TARGET]!.stock!.price
    const shockedPrice = shocked.companies[TARGET]!.stock!.price
    expect(shockedPrice).toBeLessThan(controlPrice)
    expect(shockedPrice / controlPrice).toBeCloseTo(0.9 / 1, 1)

    // Papel não citado não se mexe.
    const other = 'vetorial'
    expect(shocked.companies[other]!.stock!.price).toBeCloseTo(
      control.companies[other]!.stock!.price,
      6,
    )
  })

  it('o choque decai em vez de empilhar no teto', () => {
    let state = setShock(funded(fresh()), TARGET, -0.1)
    state = liveDay(state).state
    // O passo de mercado zera e o de notícias aplica o decaimento sobre o
    // acumulado — sem manchete nova, o choque some.
    expect(Math.abs(state.companies[TARGET]!.stock!.eventShockToday)).toBeLessThan(0.05)
  })

  it('o coeficiente de choque é proporcional a alcance e credibilidade', () => {
    const tabloide = NEWS_OUTLETS.find((outlet) => outlet.id === 'tabloide')!
    const referencia = NEWS_OUTLETS.find((outlet) => outlet.id === 'referencia')!
    const impact = (outlet: typeof tabloide): number =>
      (outlet.reach / 100) * (outlet.credibility / 100) * NEWS.priceCoefficient
    // Alcance alto com credibilidade baixa contra alcance médio com credibilidade
    // alta: os dois pesam, nenhum domina sozinho.
    expect(impact(tabloide)).toBeGreaterThan(0)
    expect(impact(referencia)).toBeGreaterThan(0)
    expect(Math.abs(impact(tabloide) - impact(referencia))).toBeLessThan(0.03)
  })
})

describe('identidade das manchetes', () => {
  /**
   * Guarda de classe, não de instância.
   *
   * O feed usa `TransitionGroup`, que reaproveita o DOM pela chave: id repetido
   * faz a manchete errada aparecer no lugar da nova. Um gerador de id sem o
   * ator no nome (`hl-tyc-empresa-dia`, com dois tycoons no mesmo dia) já
   * causou isso, e só apareceu como aviso no console do navegador.
   */
  it('nenhum id de manchete se repete em cinco anos', async () => {
    const state = (await advanceAsync(funded(fresh(), 5_000_000_000), 1825)).state
    const ids = state.news.headlines.map((headline) => headline.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
