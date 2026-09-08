/**
 * mulberry32 determinístico. TypeScript puro — `Math.random` é proibido aqui
 * (CLAUDE.md §1).
 *
 * `seed` e `counter` vivem dentro do GameState. As funções abaixo **incrementam
 * `counter` no objeto recebido**, que na engine é sempre um draft do Immer — é o
 * que mantém o consumo de aleatoriedade rastreável e reproduzível. O valor
 * sorteado é função pura de `(seed, counter)`: nada de estado de módulo.
 */
import type { RngState } from './types'

const MULBERRY_K = 0x6d2b79f5

/** Valor uniforme em [0,1) para um par (seed, counter), sem efeito colateral. */
export function floatAt(seed: number, counter: number): number {
  const a = (seed + Math.imul(counter + 1, MULBERRY_K)) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function createRng(seed: number): RngState {
  return { seed: seed | 0, counter: 0 }
}

/** Uniforme em [0,1). Consome 1 draw. */
export function nextFloat(rng: RngState): number {
  const value = floatAt(rng.seed, rng.counter)
  rng.counter += 1
  return value
}

/** Inteiro em [min, max). Consome 1 draw. */
export function nextInt(rng: RngState, min: number, max: number): number {
  return min + Math.floor(nextFloat(rng) * (max - min))
}

/** true com probabilidade `p`. Consome 1 draw. */
export function chance(rng: RngState, p: number): boolean {
  return nextFloat(rng) < p
}

/** Uniforme em [min, max). Consome 1 draw. */
export function range(rng: RngState, min: number, max: number): number {
  return min + nextFloat(rng) * (max - min)
}

/**
 * Normal padrão por Box-Muller. Consome **exatamente 2 draws** — contrato
 * congelado: mudar isso desalinha o counter e invalida todo save existente.
 */
export function nextNormal(rng: RngState): number {
  const u1 = Math.max(nextFloat(rng), 1e-12)
  const u2 = nextFloat(rng)
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/** Elemento aleatório de um array não vazio. Consome 1 draw. */
export function pick<T>(rng: RngState, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick: array vazio')
  const item = items[nextInt(rng, 0, items.length)]
  // noUncheckedIndexedAccess: o índice é sempre válido pelo cálculo acima.
  return item as T
}

/**
 * Escolha ponderada. Consome 1 draw. Exige ordem estável na entrada — a ordem
 * define o resultado.
 */
export function pickWeighted<T>(rng: RngState, items: readonly T[], weight: (item: T) => number): T {
  if (items.length === 0) throw new Error('pickWeighted: array vazio')
  let total = 0
  for (const item of items) total += Math.max(0, weight(item))
  if (total <= 0) return pick(rng, items)
  let roll = nextFloat(rng) * total
  for (const item of items) {
    roll -= Math.max(0, weight(item))
    if (roll <= 0) return item
  }
  return items[items.length - 1] as T
}

/**
 * Hash determinístico de string para inteiro. Usado no offset de reavaliação dos
 * agentes (`hash(companyId) % 90`, §5.12 Regra 3) — não consome o RNG.
 */
export function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
