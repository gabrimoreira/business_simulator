import { describe, expect, it } from 'vitest'
import { applyAction } from '@/engine/actions'
import { finishRun } from '@/engine/player'
import { worldTick } from '@/engine/tick'
import { netWorth } from '@/engine/selectors'
import { createInitialState } from '@/engine/newGame'
import { ASSETS, findAsset } from '@/data/assets'
import { ENDGAME, RETIREMENT_AGE } from '@/data/config'
import type { GameState } from '@/engine/types'
import { advance, fresh, funded, liveDay } from './helpers'

/** Encerra a partida por dentro, como o passo do jogador faria. */
function ended(state: GameState, ending: 'morte' | 'aposentadoria' = 'aposentadoria'): GameState {
  const next = {
    ...state,
    meta: { ...state.meta, ranking: [...state.meta.ranking] },
    news: { ...state.news, headlines: [...state.news.headlines] },
  }
  finishRun(next, ending, [])
  return next
}

describe('ativos pessoais', () => {
  it('comprar debita, entra no patrimônio e paga humor', () => {
    const before = funded(fresh(), 2_000_000)
    const asset = findAsset('apartamento')!

    const after = applyAction(before, { kind: 'comprarAtivo', assetId: 'apartamento', financed: false }).state

    expect(after.personalAssets.assets).toHaveLength(1)
    expect(after.player.money).toBeCloseTo(before.player.money - asset.price, 0)
    expect(after.player.mood).toBeGreaterThan(before.player.mood)
    // O bem entra no patrimônio: o dinheiro virou coisa, não sumiu.
    expect(netWorth(after)).toBeCloseTo(netWorth(before), 0)
  })

  it('luxo cobra notoriedade todo dia', () => {
    let state = funded(fresh(), 20_000_000)
    state = applyAction(state, { kind: 'comprarAtivo', assetId: 'iate', financed: false }).state
    const before = state.player.notoriety
    const after = advance(state, 60).state
    expect(after.player.notoriety).toBeGreaterThan(before)
  })

  it('imóvel valoriza e veículo deprecia', () => {
    let state = funded(fresh(), 5_000_000)
    state = applyAction(state, { kind: 'comprarAtivo', assetId: 'apartamento', financed: false }).state
    state = applyAction(state, { kind: 'comprarAtivo', assetId: 'sedan', financed: false }).state

    const after = advance(state, 365).state
    const imovel = after.personalAssets.assets.find((item) => item.assetId === 'apartamento')!
    const veiculo = after.personalAssets.assets.find((item) => item.assetId === 'sedan')!

    expect(imovel.currentValue).toBeGreaterThan(imovel.purchasePrice)
    expect(veiculo.currentValue).toBeLessThan(veiculo.purchasePrice)
  })

  it('morar no que é seu tira o aluguel do orçamento e melhora o sono', () => {
    let state = funded(fresh(), 2_000_000)
    state = applyAction(state, { kind: 'comprarAtivo', assetId: 'casa-alto-padrao', financed: false }).state
    const id = state.personalAssets.assets[0]!.id

    const rentBefore = state.personalAssets.monthlyRent
    const moved = applyAction(state, { kind: 'mudarResidencia', id }).state

    expect(moved.personalAssets.monthlyRent).toBe(0)
    expect(rentBefore).toBeGreaterThan(0)
    expect(moved.personalAssets.assets[0]!.isResidence).toBe(true)

    // Casa melhor dorme melhor: mais energia recuperada por noite.
    const tiredHere = liveDay({ ...moved, player: { ...moved.player, energy: 10 } }).state
    const tiredThere = liveDay({ ...state, player: { ...state.player, energy: 10 } }).state
    expect(tiredHere.player.energy).toBeGreaterThan(tiredThere.player.energy)
  })

  it('vender sai com deságio', () => {
    let state = funded(fresh(), 2_000_000)
    state = applyAction(state, { kind: 'comprarAtivo', assetId: 'apartamento', financed: false }).state
    const asset = state.personalAssets.assets[0]!
    const cashBefore = state.player.money

    const sold = applyAction(state, { kind: 'venderAtivo', id: asset.id }).state
    expect(sold.personalAssets.assets).toHaveLength(0)
    expect(sold.player.money - cashBefore).toBeLessThan(asset.currentValue)
    expect(sold.player.money - cashBefore).toBeGreaterThan(asset.currentValue * 0.9)
  })

  it('o catálogo cobre as três classes do §5.10', () => {
    const kinds = new Set(ASSETS.map((asset) => asset.kind))
    expect(kinds).toEqual(new Set(['imovel', 'veiculo', 'luxo']))
  })
})

describe('fim de jogo', () => {
  it('a manchete de encerramento sai antes de o tick parar', () => {
    const state = ended(funded(fresh(), 10_000_000), 'aposentadoria')
    const closing = state.news.headlines.find((headline) => headline.id.startsWith('hl-fim-'))

    expect(closing).toBeDefined()
    expect(closing!.text).toContain(state.player.name)
    // Sai pelo veículo de maior alcance da praça.
    const reach = state.news.outlets[closing!.outletId]!.reach
    const maxReach = Math.max(...state.news.outletOrder.map((id) => state.news.outlets[id]!.reach))
    expect(reach).toBe(maxReach)
  })

  it('registra a corrida no ranking, ordenado por patrimônio', () => {
    const rich = ended(funded(fresh(), 50_000_000))
    expect(rich.meta.ranking).toHaveLength(1)
    expect(rich.meta.ranking[0]!.netWorth).toBeCloseTo(netWorth(rich), 0)
    expect(rich.meta.ranking[0]!.ending).toBe('aposentadoria')

    const second = {
      ...rich,
      meta: { ...rich.meta, ending: null },
      player: { ...rich.player, money: 1000 },
    }
    const both = ended(second, 'morte')
    expect(both.meta.ranking).toHaveLength(2)
    expect(both.meta.ranking[0]!.netWorth).toBeGreaterThanOrEqual(both.meta.ranking[1]!.netWorth)
  })

  it('o tick para depois do encerramento', () => {
    const state = ended(funded(fresh(), 1_000_000))
    // `worldTick` direto: o helper `advance` lança de propósito quando a
    // partida encerrou, e aqui a parada **é** o que está sob teste.
    const frozen = worldTick(state, 10)
    expect(frozen.state.date.dayIndex).toBe(state.date.dayIndex)
    expect(frozen.log).toHaveLength(0)
  })

  it('aposentadoria dispara aos 65 sozinha', () => {
    const old = {
      ...funded(fresh(), 1_000_000),
      player: { ...fresh().player, age: RETIREMENT_AGE, money: 1_000_000 },
    }
    const after = liveDay(old).state
    expect(after.meta.ending).toBe('aposentadoria')
  })
})

describe('New Game+', () => {
  it('patrimônio alto desbloqueia arquétipo inicial', () => {
    const modest = ended(funded(fresh(), 1_000_000))
    expect(modest.meta.unlockedArchetypes).toEqual(['comum'])

    const rich = ended(funded(fresh(), 30_000_000))
    expect(rich.meta.unlockedArchetypes).toContain('herdeiro')
    expect(rich.meta.unlockedArchetypes).toContain('genio')
  })

  it('o arquétipo inicial troca vantagem por desvantagem', () => {
    const comum = createInitialState({ seed: 1, playerName: 'A', now: 0 })
    const herdeiro = createInitialState({
      seed: 1,
      playerName: 'B',
      startArchetype: 'herdeiro',
      now: 0,
    })
    const genio = createInitialState({ seed: 1, playerName: 'C', startArchetype: 'genio', now: 0 })

    // Herdeiro: dinheiro na mão, reputação manchada.
    expect(herdeiro.player.money).toBeGreaterThan(comum.player.money)
    expect(herdeiro.player.publicReputation).toBeLessThan(comum.player.publicReputation)

    // Gênio: inteligência alta, carisma baixo.
    expect(genio.player.skills.intelligence).toBeGreaterThan(comum.player.skills.intelligence)
    expect(genio.player.skills.charisma).toBeLessThan(comum.player.skills.charisma)
  })

  it('a nova partida herda ranking e desbloqueios', () => {
    const finished = ended(funded(fresh(), 30_000_000))
    const next = createInitialState({
      seed: 2,
      playerName: 'Segunda',
      now: 0,
      carryOver: {
        ranking: finished.meta.ranking,
        unlockedArchetypes: finished.meta.unlockedArchetypes,
      },
    })

    expect(next.meta.ranking).toHaveLength(1)
    expect(next.meta.unlockedArchetypes).toContain('herdeiro')
    expect(next.meta.ending).toBeNull()
    expect(next.date.dayIndex).toBe(0)
  })

  it('todo arquétipo declarado tem trade-off', () => {
    for (const [id, archetype] of Object.entries(ENDGAME.archetypes)) {
      if (id === 'comum') continue
      const gains = archetype.money + archetype.charisma + archetype.intelligence
      const losses =
        Math.min(0, archetype.reputation) + Math.min(0, archetype.charisma) - archetype.notoriety
      expect(gains).toBeGreaterThan(0)
      expect(losses).toBeLessThan(0)
    }
  })
})
