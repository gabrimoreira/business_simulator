/**
 * Orquestração de UI. **Zero regra de jogo aqui** (CLAUDE.md §7): a store carrega,
 * expõe e persiste o estado; quem o transforma é a engine.
 */
import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { GameState } from '@/engine/types'
import { blocksRemaining, createInitialState } from '@/engine/newGame'
import { netWorth } from '@/engine/selectors'
import { clearSave, loadState, saveState } from '@/persistence/db'
import { createAutosave, type Autosave } from '@/persistence/autosave'
import { cloneState, toJson } from '@/persistence/serialize'
import { migrate } from '@/persistence/migrations'

export type LoadStatus = 'inicial' | 'carregando' | 'pronto' | 'erro'

export const useGameStore = defineStore('game', () => {
  /** shallowRef: o estado é imutável, trocado por inteiro — reatividade profunda
   *  em um objeto deste tamanho custaria caro e não serviria para nada. */
  const state = shallowRef<GameState | null>(null)
  const status = ref<LoadStatus>('inicial')
  const error = ref<string | null>(null)

  let autosave: Autosave | null = null

  const hasGame = computed(() => state.value !== null)
  const playerNetWorth = computed(() => (state.value ? netWorth(state.value) : 0))
  const blocksLeft = computed(() => (state.value ? blocksRemaining(state.value) : 0))

  function ensureAutosave(): void {
    autosave ??= createAutosave(() => state.value)
  }

  /** Substitui o estado inteiro e agenda o autosave. Único caminho de escrita. */
  function commit(next: GameState): void {
    next.lastTickAt = Date.now()
    state.value = next
    ensureAutosave()
    autosave?.schedule()
  }

  async function load(): Promise<void> {
    status.value = 'carregando'
    error.value = null
    try {
      state.value = await loadState()
      status.value = 'pronto'
      if (state.value) ensureAutosave()
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      status.value = 'erro'
    }
  }

  async function startNewGame(playerName: string, seed = Date.now() % 2_147_483_647): Promise<void> {
    const next = createInitialState({ seed, playerName, now: Date.now() })
    state.value = next
    ensureAutosave()
    await saveState(next)
    status.value = 'pronto'
  }

  async function deleteGame(): Promise<void> {
    await autosave?.flush()
    await clearSave()
    state.value = null
  }

  /** Export para arquivo — útil para debug e para migrar de aparelho (spec §3.5). */
  function exportSave(): string {
    if (!state.value) throw new Error('Nenhuma partida para exportar.')
    return toJson(state.value)
  }

  async function importSave(json: string): Promise<void> {
    const migrated = migrate(JSON.parse(json))
    // Round-trip para garantir que o que entrou é JSON puro de verdade.
    const next = cloneState(migrated)
    state.value = next
    ensureAutosave()
    await saveState(next)
  }

  return {
    state,
    status,
    error,
    hasGame,
    playerNetWorth,
    blocksLeft,
    commit,
    load,
    startNewGame,
    deleteGame,
    exportSave,
    importSave,
  }
})
