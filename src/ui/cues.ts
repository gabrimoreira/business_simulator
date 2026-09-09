/**
 * O vocabulário sonoro do jogo — dados puros, sem Web Audio e sem DOM.
 *
 * Está separado do tocador (`sound.ts`) por um motivo prático: a escolha do som
 * é a regra que erra, e regra que erra precisa de teste. Aqui não há
 * `AudioContext`, então o mapeamento roda no vitest em Node sem mock nenhum.
 *
 * **Som nenhum é arquivo.** Tudo é sintetizado com osciladores: não há asset
 * para precachear, nada para baixar, e o PWA continua funcionando offline
 * exatamente igual. Também é o que mantém o bundle onde está.
 */
import type { LogEntry, LogSeverity } from '@/engine/types'

/** Uma nota: frequência em Hz e o instante de início, em segundos, dentro da cue. */
export interface Note {
  hz: number
  at: number
  /** Duração em segundos. */
  seconds: number
}

export interface Cue {
  id: CueId
  notes: Note[]
  /** Timbre. `triangle` é o padrão porque é suave sem soar oco como a senoide. */
  wave: OscillatorType
  /** Pico do envelope, de 0 a 1, antes do volume mestre. */
  peak: number
  /** Vibração casada com o som, em ms — o mesmo evento nos dois canais. */
  haptic: number | number[]
}

export type CueId = 'toque' | 'ganho' | 'perda' | 'alerta' | 'tempo' | 'fim'

/**
 * As cues, em ordem de peso.
 *
 * Duração curta é requisito, não preferência: o jogo é de toque rápido em
 * celular, e som que dura mais que o gesto vira ruído na terceira ação. Cue de
 * ação some em até 400ms. O arpejo de `fim` é a exceção com razão — toca uma
 * vez, sobre a tela de fecho, sem gesto nenhum para atrapalhar.
 */
export const CUES: Record<CueId, Cue> = {
  // Ação comum aceita. Um blip só, quase subliminar.
  toque: {
    id: 'toque',
    notes: [{ hz: 660, at: 0, seconds: 0.045 }],
    wave: 'triangle',
    peak: 0.16,
    haptic: 12,
  },
  // Deu certo e mudou dinheiro: terça maior ascendente.
  ganho: {
    id: 'ganho',
    notes: [
      { hz: 523.25, at: 0, seconds: 0.07 },
      { hz: 783.99, at: 0.06, seconds: 0.11 },
    ],
    wave: 'triangle',
    peak: 0.2,
    haptic: 18,
  },
  // Recusa ou perda: o mesmo intervalo, descendo. Não é punitivo, é claro.
  perda: {
    id: 'perda',
    notes: [
      { hz: 392, at: 0, seconds: 0.08 },
      { hz: 261.63, at: 0.07, seconds: 0.14 },
    ],
    wave: 'triangle',
    peak: 0.2,
    haptic: [14, 40, 14],
  },
  // Crítico: três pulsos graves. É o único som que interrompe de propósito.
  alerta: {
    id: 'alerta',
    notes: [
      { hz: 233.08, at: 0, seconds: 0.09 },
      { hz: 233.08, at: 0.12, seconds: 0.09 },
      { hz: 185, at: 0.24, seconds: 0.15 },
    ],
    wave: 'square',
    peak: 0.12,
    haptic: [24, 60, 24, 60, 40],
  },
  // Avanço de tempo: quarta ascendente, mais longa e mais baixa — passagem, não evento.
  tempo: {
    id: 'tempo',
    notes: [
      { hz: 349.23, at: 0, seconds: 0.12 },
      { hz: 466.16, at: 0.1, seconds: 0.18 },
    ],
    wave: 'sine',
    peak: 0.14,
    haptic: 24,
  },
  // Fim de partida: arpejo de quatro notas. Toca uma vez, na tela de fecho.
  fim: {
    id: 'fim',
    notes: [
      { hz: 261.63, at: 0, seconds: 0.18 },
      { hz: 329.63, at: 0.16, seconds: 0.18 },
      { hz: 392, at: 0.32, seconds: 0.18 },
      { hz: 523.25, at: 0.48, seconds: 0.34 },
    ],
    wave: 'triangle',
    peak: 0.22,
    haptic: [30, 80, 30, 80, 60],
  },
}

const BY_SEVERITY: Record<LogSeverity, CueId> = {
  info: 'toque',
  bom: 'ganho',
  ruim: 'perda',
  critico: 'alerta',
}

/** Ordem de gravidade: a cue de um lote é a da entrada mais grave dele. */
const WEIGHT: Record<LogSeverity, number> = { info: 0, bom: 1, ruim: 2, critico: 3 }

/**
 * A cue de uma ação, a partir do que a engine respondeu.
 *
 * Vem do log e não do `kind` da ação de propósito: **ação recusada devolve
 * estado intacto e um `LogEntry` explicando** (CLAUDE.md §2), então só o log
 * sabe se o toque virou compra ou recusa. Antes disso a UI vibrava igual nos
 * dois casos, o que ensinava a confiar num retorno que não existia.
 *
 * Lote vazio é `toque`: a ação passou e não teve o que relatar.
 */
export function cueFor(entries: readonly LogEntry[]): Cue {
  let worst: LogSeverity = 'info'
  for (const entry of entries) {
    if (WEIGHT[entry.severity] > WEIGHT[worst]) worst = entry.severity
  }
  return CUES[BY_SEVERITY[worst]]
}
