/**
 * Orquestração de UI. **Zero regra de jogo aqui** (CLAUDE.md §7): a store carrega,
 * expõe e persiste o estado; quem o transforma é a engine.
 */
import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { DayLog, GameAction, GameState } from '@/engine/types'
import { blocksRemaining, createInitialState } from '@/engine/newGame'
import { netWorth } from '@/engine/selectors'
import { applyAction } from '@/engine/actions'
import { runDays } from '@/engine/autoplay'
import { MS_PER_GAME_DAY, OFFLINE_CAP_DAYS } from '@/data/config'
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
  let ticker: ReturnType<typeof setInterval> | null = null

  /** Log do dia corrente, para o feed da tela Início. */
  const dayLog = ref<GameState['log']>([])
  /** Resumo de "Enquanto você esteve fora" / avanço de tempo. */
  const awayLog = ref<DayLog[]>([])
  const awayTitle = ref('Enquanto você esteve fora')

  const hasGame = computed(() => state.value !== null)
  const playerNetWorth = computed(() => (state.value ? netWorth(state.value) : 0))
  const blocksLeft = computed(() => (state.value ? blocksRemaining(state.value) : 0))

  function ensureAutosave(): void {
    autosave ??= createAutosave(() => state.value)
  }

  /** Substitui o estado inteiro e agenda o autosave. Único caminho de escrita. */
  function commit(next: GameState): void {
    state.value = next
    ensureAutosave()
    autosave?.schedule()
  }

  /**
   * Único ponto de entrada de ação da UI. `avancarTempo` é roteada para
   * `runDays`, porque por contrato `applyAction` não avança o tempo.
   */
  function dispatch(action: GameAction): void {
    const current = state.value
    if (!current) return

    if (action.kind === 'avancarTempo') {
      const result = runDays(current, action.days)
      awayTitle.value = action.days >= 30 ? 'Um mês depois' : 'Uma semana depois'
      awayLog.value = result.log
      commit(stampTick(result.state))
      return
    }

    const result = applyAction(current, action)
    dayLog.value = [...result.log, ...dayLog.value].slice(0, 40)
    commit(result.state)
  }

  /**
   * Marca o instante real do último tick. É a UI que escreve `lastTickAt` — a
   * engine nunca lê o relógio (GAME_DESIGN C7).
   */
  function stampTick(next: GameState): GameState {
    return { ...next, lastTickAt: Date.now() }
  }

  /**
   * Catch-up ao abrir o app: converte o tempo real decorrido em dias de jogo,
   * com teto de OFFLINE_CAP_DAYS. Relógio do aparelho movido para trás dá
   * `days` negativo — tratado como zero, nunca como viagem no tempo.
   */
  function catchUp(): void {
    const current = state.value
    if (!current || current.meta.ending) return

    const elapsed = Date.now() - current.lastTickAt
    const rawDays = Math.floor(elapsed / MS_PER_GAME_DAY)
    const days = Math.min(Math.max(0, rawDays), OFFLINE_CAP_DAYS)
    if (days <= 0) {
      // Ainda assim registra o instante, senão um relógio adiantado acumula
      // dias para sempre.
      if (rawDays < 0) commit(stampTick(current))
      return
    }

    const result = runDays(current, days)
    awayTitle.value = 'Enquanto você esteve fora'
    awayLog.value = result.log
    commit(stampTick(result.state))
  }

  async function load(): Promise<void> {
    status.value = 'carregando'
    error.value = null
    try {
      state.value = await loadState()
      status.value = 'pronto'
      if (state.value) {
        ensureAutosave()
        catchUp()
      }
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

  /**
   * `setInterval` só existe aqui, na UI, e apenas para chamar o mesmo caminho de
   * catch-up. Nunca é fonte de verdade (spec §3.4).
   */
  function startTicker(): void {
    if (ticker !== null) return
    ticker = setInterval(catchUp, 15_000)
  }

  function stopTicker(): void {
    if (ticker === null) return
    clearInterval(ticker)
    ticker = null
  }

  function clearAwayLog(): void {
    awayLog.value = []
  }

  return {
    state,
    status,
    error,
    hasGame,
    playerNetWorth,
    blocksLeft,
    dayLog,
    awayLog,
    awayTitle,
    commit,
    dispatch,
    load,
    catchUp,
    startTicker,
    stopTicker,
    clearAwayLog,
    startNewGame,
    deleteGame,
    exportSave,
    importSave,
  }
})
