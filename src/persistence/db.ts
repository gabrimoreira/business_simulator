/**
 * IndexedDB via `idb`. **Único** módulo do projeto que toca armazenamento —
 * `localStorage` é proibido para estado de jogo (CLAUDE.md §6).
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Candle, EntityId, GameState } from '@/engine/types'
import { migrate } from './migrations'
import { toJson } from './serialize'

const DB_NAME = 'capital'
const DB_VERSION = 1
const SAVE_KEY = 'current'

interface CapitalDB extends DBSchema {
  /** Estado do jogo, uma única entrada. */
  save: { key: string; value: string }
  /** Séries de preço por ativo, fora do save para não inflar o estado. */
  history: { key: EntityId; value: { companyId: EntityId; candles: Candle[] } }
}

let dbPromise: Promise<IDBPDatabase<CapitalDB>> | null = null

function getDb(): Promise<IDBPDatabase<CapitalDB>> {
  dbPromise ??= openDB<CapitalDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('save')) db.createObjectStore('save')
      if (!db.objectStoreNames.contains('history')) {
        db.createObjectStore('history', { keyPath: 'companyId' })
      }
    },
  })
  return dbPromise
}

export async function saveState(state: GameState): Promise<void> {
  const db = await getDb()
  await db.put('save', toJson(state), SAVE_KEY)
}

/** Carrega e migra o save. `null` quando não existe partida salva. */
export async function loadState(): Promise<GameState | null> {
  const db = await getDb()
  const json = await db.get('save', SAVE_KEY)
  if (!json) return null
  return migrate(JSON.parse(json))
}

export async function clearSave(): Promise<void> {
  const db = await getDb()
  await db.delete('save', SAVE_KEY)
  await db.clear('history')
}

export async function putHistory(companyId: EntityId, candles: Candle[]): Promise<void> {
  const db = await getDb()
  await db.put('history', { companyId, candles })
}

export async function getHistory(companyId: EntityId): Promise<Candle[]> {
  const db = await getDb()
  const row = await db.get('history', companyId)
  return row?.candles ?? []
}

/** Fecha a conexão. Usado nos testes para isolar cada caso. */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return
  const db = await dbPromise
  db.close()
  dbPromise = null
}
