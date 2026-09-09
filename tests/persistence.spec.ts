import { beforeEach, describe, expect, it } from 'vitest'
import { createInitialState } from '@/engine/newGame'
import { assertPureJson, cloneState, ImpureStateError, toJson } from '@/persistence/serialize'
import { MissingMigrationError, migrate, SaveTooNewError } from '@/persistence/migrations'
import { clearSave, closeDb, getHistory, loadState, putHistory, saveState } from '@/persistence/db'
import { SAVE_VERSION } from '@/data/config'
import type { Candle } from '@/engine/types'

function fixture() {
  return createInitialState({ seed: 42, playerName: 'Teste', now: 1_700_000_000_000 })
}

describe('serialização', () => {
  it('round-trip preserva o estado exato', () => {
    const state = fixture()
    expect(cloneState(state)).toEqual(state)
  })

  it('recusa undefined, NaN, Infinity e objetos de classe', () => {
    expect(() => assertPureJson({ a: undefined })).toThrow(ImpureStateError)
    expect(() => assertPureJson({ a: Number.NaN })).toThrow(ImpureStateError)
    expect(() => assertPureJson({ a: Number.POSITIVE_INFINITY })).toThrow(ImpureStateError)
    expect(() => assertPureJson({ a: new Date() })).toThrow(ImpureStateError)
    expect(() => assertPureJson({ a: new Map() })).toThrow(ImpureStateError)
    expect(() => assertPureJson({ a: new Set() })).toThrow(ImpureStateError)
  })

  it('aponta o caminho do campo impuro', () => {
    expect(() => assertPureJson({ player: { skills: { intelligence: Number.NaN } } })).toThrow(
      /\$\.player\.skills\.intelligence/,
    )
  })

  it('o estado inicial é JSON puro', () => {
    expect(() => toJson(fixture())).not.toThrow()
  })
})

describe('migrations', () => {
  /** Desfaz na mão o que a migration N-1 → N deve refazer. */
  function migrated0(save: Record<string, unknown>): Record<string, unknown> {
    const ai = save.ai as Record<string, unknown>
    // Volta à versão 7: sem rivais e sem a marca de CEO nomeado.
    ai.tycoons = {}
    ai.tycoonOrder = []
    const agents = ai.agents as Record<string, Record<string, unknown>>
    for (const agent of Object.values(agents)) delete agent.appointedByPlayer
    return save
  }

  it('save da versão N-1 carrega na versão N', () => {
    const legacy = JSON.parse(toJson(fixture())) as Record<string, unknown>
    legacy.saveVersion = SAVE_VERSION - 1
    // A migration mais nova (4 → 5) trocou a lista de funcionários pelo quadro
    // agregado e deu capital instalado a cada empresa. Um save da versão N-1 é
    // um save com `employees` e sem `workforce`.
    // A migration mais nova (7 → 8) traz os tycoons rivais e a marca de CEO
    // nomeado. Um save da versão N-1 não tem rival nenhum.
    migrated0(legacy)

    const migrated = migrate(legacy)

    expect(migrated.saveVersion).toBe(SAVE_VERSION)
    expect(migrated.ai.tycoonOrder.length).toBeGreaterThan(0)
    const tycoon = migrated.ai.tycoons[migrated.ai.tycoonOrder[0]!]!
    expect(tycoon.cash).toBeGreaterThan(0)
    expect(tycoon.targetCompanyId).toBeNull()
    const agent = migrated.ai.agents[migrated.ai.agentOrder[0]!]!
    expect(agent.appointedByPlayer).toBe(false)
  })

  it('percorre a cadeia inteira a partir da versão 0', () => {
    const legacy = JSON.parse(toJson(fixture())) as Record<string, unknown>
    legacy.saveVersion = 0
    const player = legacy.player as Record<string, unknown>
    delete player.routine
    delete player.blocksUsedToday
    delete player.overdueBills
    delete legacy.meta
    delete (legacy.macro as Record<string, unknown>).priceLevel
    legacy.companies = {}
    legacy.companyOrder = []
    legacy.industries = {}
    legacy.industryOrder = []

    const migrated = migrate(legacy)

    expect(migrated.saveVersion).toBe(SAVE_VERSION)
    expect(migrated.player.routine.length).toBeGreaterThan(0)
    expect(migrated.player.blocksUsedToday).toBe(0)
    expect(migrated.player.overdueBills).toBe(0)
    expect(migrated.macro.priceLevel).toBe(1)
    expect(migrated.companyOrder).toHaveLength(28)
    expect(migrated.meta.startArchetype).toBe('comum')
  })

  it('save sem versão é tratado como versão 0', () => {
    const raw = JSON.parse(toJson(fixture())) as Record<string, unknown>
    delete raw.saveVersion
    expect(migrate(raw).saveVersion).toBe(SAVE_VERSION)
  })

  it('recusa save mais novo que o app', () => {
    expect(() => migrate({ saveVersion: SAVE_VERSION + 5 })).toThrow(SaveTooNewError)
  })

  it('acusa migration faltando na cadeia', () => {
    // Uma versão intermediária sem migration registrada deve falhar alto, não
    // carregar um estado meio-migrado.
    expect(() => migrate({ saveVersion: -1 })).toThrow(MissingMigrationError)
  })
})

describe('IndexedDB', () => {
  beforeEach(async () => {
    await clearSave()
  })

  it('grava e lê o save preservando o estado', async () => {
    const state = fixture()
    await saveState(state)
    const loaded = await loadState()
    expect(loaded).toEqual(state)
  })

  it('devolve null quando não há partida salva', async () => {
    expect(await loadState()).toBeNull()
  })

  it('guarda séries de preço no store separado', async () => {
    const candles: Candle[] = [
      { dayIndex: 1, open: 10, high: 11, low: 9.5, close: 10.5, volume: 1000, isWeekly: false },
    ]
    await putHistory('cmp-1', candles)
    expect(await getHistory('cmp-1')).toEqual(candles)
    expect(await getHistory('inexistente')).toEqual([])
  })

  it('apagar a partida limpa save e histórico', async () => {
    await saveState(fixture())
    await putHistory('cmp-1', [])
    await clearSave()
    expect(await loadState()).toBeNull()
    await closeDb()
  })
})
