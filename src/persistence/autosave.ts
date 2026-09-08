/**
 * Autosave com debounce de 500 ms, e flush garantido quando o app vai para o
 * background (spec §3.5). No celular, `visibilitychange` é a última chance real
 * de gravar: `beforeunload` não dispara de forma confiável.
 */
import { AUTOSAVE_DEBOUNCE_MS } from '@/data/config'
import type { GameState } from '@/engine/types'
import { saveState } from './db'

export interface Autosave {
  schedule: () => void
  flush: () => Promise<void>
  dispose: () => void
}

export function createAutosave(getState: () => GameState | null): Autosave {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false

  async function write(): Promise<void> {
    const state = getState()
    if (!state) return
    pending = false
    await saveState(state)
  }

  function schedule(): void {
    pending = true
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void write()
    }, AUTOSAVE_DEBOUNCE_MS)
  }

  async function flush(): Promise<void> {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (pending) await write()
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') void flush()
  }

  document.addEventListener('visibilitychange', onVisibilityChange)

  return {
    schedule,
    flush,
    dispose() {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (timer !== null) clearTimeout(timer)
    },
  }
}
