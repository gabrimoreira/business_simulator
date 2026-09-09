/**
 * Tocador de som e vibração. Camada de UI — a engine nunca sabe que existe.
 *
 * Três coisas que este arquivo precisa acertar em celular:
 *
 * 1. **`AudioContext` só nasce no primeiro gesto.** iOS e Android recusam áudio
 *    iniciado fora de um toque, e um contexto criado no `import` nasce
 *    `suspended` para sempre. Por isso a criação é preguiçosa e `unlock()` é
 *    chamado uma vez, no primeiro `pointerdown` do documento.
 * 2. **Nunca lançar.** Navegador sem Web Audio, aba sem permissão, contexto
 *    fechado: som é enfeite, e enfeite que quebra a ação do jogador é bug.
 *    Toda chamada é embrulhada.
 * 3. **A preferência é do aparelho, não da partida.** Mudo mora no
 *    `localStorage` — o CLAUDE.md §6 proíbe estado de jogo ali e abre exceção
 *    exatamente para preferência cosmética como esta. No save não pode ficar:
 *    exportar um save não deve levar junto o "silencia isso aqui" de um
 *    aparelho.
 */
import { CUES, cueFor, type Cue, type CueId } from './cues'
import type { LogEntry } from '@/engine/types'

const MUTE_KEY = 'capital:mudo'

/** Volume mestre. Abaixo do pico das cues, que já são discretas. */
const MASTER_GAIN = 0.5

let context: AudioContext | null = null
let master: GainNode | null = null
let muted = readMuted()

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    // Modo privado em alguns navegadores lança só de ler. Som ligado é o padrão.
    return false
  }
}

export function isMuted(): boolean {
  return muted
}

export function setMuted(value: boolean): void {
  muted = value
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0')
  } catch {
    // Preferência não persistiu; a sessão corrente continua respeitando.
  }
}

export function toggleMuted(): boolean {
  setMuted(!muted)
  if (!muted) play('toque')
  return muted
}

/**
 * Prepara o áudio dentro de um gesto do usuário.
 *
 * Idempotente e barato: chamar a cada toque não custa nada depois da primeira
 * vez, e é isso que permite ligá-lo a um listener global em vez de espalhar a
 * responsabilidade por cada botão.
 */
export function unlock(): void {
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    context ??= new Ctor()
    if (!master) {
      master = context.createGain()
      master.gain.value = MASTER_GAIN
      master.connect(context.destination)
    }
    if (context.state === 'suspended') void context.resume()
  } catch {
    context = null
    master = null
  }
}

/** Toca uma cue pelo nome, com a vibração casada. */
export function play(id: CueId): void {
  emit(CUES[id])
}

/**
 * Toca o retorno de uma ação a partir do log que a engine devolveu.
 *
 * É o caminho normal: quem chama não escolhe o som, descreve o que aconteceu.
 */
export function playForLog(entries: readonly LogEntry[]): void {
  emit(cueFor(entries))
}

function emit(cue: Cue): void {
  vibrate(cue.haptic)
  if (muted) return
  try {
    unlock()
    if (!context || !master || context.state !== 'running') return
    const start = context.currentTime
    for (const note of cue.notes) {
      const oscillator = context.createOscillator()
      const envelope = context.createGain()
      oscillator.type = cue.wave
      oscillator.frequency.value = note.hz

      // Ataque de 8ms e queda exponencial. Ligar o ganho direto no valor final
      // estala: a descontinuidade vira um clique audível em fone.
      const at = start + note.at
      const end = at + note.seconds
      envelope.gain.setValueAtTime(0.0001, at)
      envelope.gain.exponentialRampToValueAtTime(cue.peak, at + 0.008)
      envelope.gain.exponentialRampToValueAtTime(0.0001, end)

      oscillator.connect(envelope)
      envelope.connect(master)
      oscillator.start(at)
      oscillator.stop(end + 0.02)
    }
  } catch {
    // Áudio indisponível. A vibração já saiu; a ação segue.
  }
}

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // Sem motor de vibração, ou bloqueado por política de permissão.
  }
}

/**
 * Liga o destravamento ao primeiro gesto da página.
 *
 * `once: true` porque depois do primeiro toque o contexto já está `running` — e
 * um listener global permanente em `pointerdown` apareceria em todo perfil de
 * performance sem fazer nada.
 */
export function installUnlockOnFirstGesture(): void {
  try {
    const handler = (): void => unlock()
    window.addEventListener('pointerdown', handler, { once: true, passive: true })
    window.addEventListener('keydown', handler, { once: true })
  } catch {
    // SSR ou ambiente sem window: nada a instalar.
  }
}
