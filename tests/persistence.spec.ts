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
  /**
   * Põe uma oferta e um projeto no save antes de rebaixá-lo.
   *
   * Sem isto o teste era **vazio**: o estado inicial nasce com zero `tenders` e
   * zero `policies`, então os laços de asserção não percorriam nada e a
   * migration passava sem ser exercida.
   */
  function withTenderAndPolicy(save: Record<string, unknown>): Record<string, unknown> {
    save.tenders = [
      {
        id: 'opa-teste',
        companyId: 'pulso',
        bidderId: 'tycoon-teste',
        premium: 0.4,
        pricePerShare: 10,
        sharesSought: 1000,
        hostile: true,
        openedDayIndex: 1,
        expiresDayIndex: 30,
        status: 'aberta',
        acceptedShares: 0,
        playerAnswered: false,
      },
    ]
    const politics = save.politics as Record<string, unknown>
    politics.policies = {
      'reforma-tributaria': {
        id: 'reforma-tributaria',
        name: 'Reforma tributária',
        effects: {},
        sponsorId: 'moraes',
        status: 'tramitando',
        supportPct: 0.4,
        proposedDayIndex: 1,
        voteDayIndex: 60,
        beneficiaryIndustryIds: [],
        playerVote: null,
      },
    }
    politics.policyOrder = ['reforma-tributaria']
    return save
  }

  /** Desfaz na mão o que a migration N-1 → N deve refazer. */
  function migrated0(save: Record<string, unknown>): Record<string, unknown> {
    // Volta à versão 10: oferta sem resposta do jogador e projeto sem voto dele.
    const tenders = save.tenders as Array<Record<string, unknown>>
    for (const tender of tenders) delete tender.playerAnswered
    const politics = save.politics as Record<string, unknown>
    const policies = politics.policies as Record<string, Record<string, unknown>>
    for (const policy of Object.values(policies)) delete policy.playerVote
    return save
  }

  it('save da versão N-1 carrega na versão N', () => {
    const legacy = JSON.parse(toJson(fixture())) as Record<string, unknown>
    legacy.saveVersion = SAVE_VERSION - 1
    // A migration mais nova (10 → 11) deu voz ao jogador na defesa e na
    // votação: `Tender.playerAnswered` distingue "recusei" de "ainda não vi", e
    // `Policy.playerVote` guarda o voto de quem tem cargo. Save antigo nunca
    // respondeu nem votou, então os dois entram no valor neutro.
    migrated0(withTenderAndPolicy(legacy))

    const migrated = migrate(legacy)

    expect(migrated.saveVersion).toBe(SAVE_VERSION)
    // Garante que há o que verificar: o teste anterior percorria listas vazias.
    expect(migrated.tenders.length).toBeGreaterThan(0)
    expect(Object.keys(migrated.politics.policies).length).toBeGreaterThan(0)
    for (const tender of migrated.tenders) expect(tender.playerAnswered).toBe(false)
    for (const policy of Object.values(migrated.politics.policies)) {
      expect(policy.playerVote).toBeNull()
    }
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
