/**
 * Pipeline de migrations do save (spec §3.5).
 *
 * Cada entrada leva o save da versão `N` para `N + 1`. A cadeia é aplicada em
 * ordem, então uma migration nunca precisa conhecer nada além da versão anterior.
 * Ao subir `SAVE_VERSION` em `src/data/config.ts`, adicione a migration aqui e o
 * teste correspondente em `tests/persistence.spec.ts`.
 */
import { SAVE_VERSION } from '@/data/config'
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
