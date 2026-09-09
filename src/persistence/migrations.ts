/**
 * Pipeline de migrations do save (spec §3.5).
 *
 * Cada entrada leva o save da versão `N` para `N + 1`. A cadeia é aplicada em
 * ordem, então uma migration nunca precisa conhecer nada além da versão anterior.
 * Ao subir `SAVE_VERSION` em `src/data/config.ts`, adicione a migration aqui e o
 * teste correspondente em `tests/persistence.spec.ts`.
 */
import { SAVE_VERSION } from '@/data/config'
import { seedWorld } from '@/engine/newGame'
import type { GameState } from '@/engine/types'

type RawSave = Record<string, unknown>

export type Migration = (save: RawSave) => RawSave

export const MIGRATIONS: Record<number, Migration> = {
  /**
   * 0 → 1: saves de desenvolvimento anteriores ao congelamento do formato não
   * tinham `meta` (New Game+ e ranking) nem `player.routine` (o avanço rápido de
   * tempo da resolução C1). Sem os dois, o app abre e quebra na primeira leitura.
   */
  0: (save) => {
    const player = (save.player ?? {}) as RawSave
    if (!Array.isArray(player.routine)) {
      player.routine = ['trabalhar', 'trabalhar', 'lazer']
    }
    if (typeof player.blocksUsedToday !== 'number') player.blocksUsedToday = 0
    save.player = player

    if (!save.meta || typeof save.meta !== 'object') {
      save.meta = {
        saveVersion: 1,
        startArchetype: 'comum',
        unlockedArchetypes: ['comum'],
        ranking: [],
        ending: null,
        companiesFoundedCount: 0,
        officesHeld: [],
      }
    }
    save.saveVersion = 1
    return save
  },

  /**
   * 1 → 2: a Fase 1 trouxe contas de casa e refeições com teto diário. Sem
   * banco até a Fase 2, a conta vencida precisa de um lugar para ficar
   * (`overdueBills`), e `mealsToday` limita o quanto se come por dia.
   */
  1: (save) => {
    const player = (save.player ?? {}) as RawSave
    if (typeof player.overdueBills !== 'number') player.overdueBills = 0
    if (typeof player.mealsToday !== 'number') player.mealsToday = 0
    save.player = player
    save.saveVersion = 2
    return save
  },

  /**
   * 2 → 3: a Fase 2 pôs a inflação para andar. Sem `priceLevel`, todo preço em
   * R$ do ano 0 ficaria congelado enquanto o salário sobe.
   */
  2: (save) => {
    const macro = (save.macro ?? {}) as RawSave
    if (typeof macro.priceLevel !== 'number') macro.priceLevel = 1
    save.macro = macro
    save.saveVersion = 3
    return save
  },

  /**
   * 3 → 4: a Fase 3 abriu a bolsa. Saves anteriores não têm empresa nenhuma, e
   * o mundo é povoado pelo mesmo `seedWorld` da partida nova — a alternativa
   * seria uma tabela paralela que sairia do ar na primeira mudança de seed.
   */
  3: (save) => {
    seedWorld(save as unknown as GameState)
    save.saveVersion = 4
    return save
  },
}

export class SaveTooNewError extends Error {
  constructor(version: number) {
    super(`Save da versão ${version} é mais novo que o app (${SAVE_VERSION}).`)
    this.name = 'SaveTooNewError'
  }
}

export class MissingMigrationError extends Error {
  constructor(version: number) {
    super(`Sem migration da versão ${version} para ${version + 1}.`)
    this.name = 'MissingMigrationError'
  }
}

/** Aplica a cadeia de migrations até `SAVE_VERSION`. */
export function migrate(raw: unknown): GameState {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('Save inválido: não é um objeto.')
  }
  const save = raw as RawSave
  let version = typeof save.saveVersion === 'number' ? save.saveVersion : 0

  if (version > SAVE_VERSION) throw new SaveTooNewError(version)

  let current = save
  while (version < SAVE_VERSION) {
    const migration = MIGRATIONS[version]
    if (!migration) throw new MissingMigrationError(version)
    current = migration(current)
    version += 1
    current.saveVersion = version
  }
  return current as unknown as GameState
}
