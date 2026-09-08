/**
 * Serialização do save. O formato é **JSON puro** — é isso que mantém o cloud
 * save futuro viável sem reescrever nada (spec §2).
 */
import type { GameState } from '@/engine/types'

export class ImpureStateError extends Error {
  constructor(path: string, reason: string) {
    super(`Estado não serializável em "${path}": ${reason}`)
    this.name = 'ImpureStateError'
  }
}

/**
 * Percorre o estado recusando o que não sobrevive a um round-trip JSON.
 * `undefined`, `NaN` e `Infinity` são os erros que de fato acontecem: o primeiro
 * desaparece silenciosamente, os outros voltam como `null`.
 */
export function assertPureJson(value: unknown, path = '$'): void {
  if (value === null) return
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return
    case 'number':
      if (!Number.isFinite(value)) throw new ImpureStateError(path, `número inválido (${value})`)
      return
    case 'undefined':
      throw new ImpureStateError(path, 'undefined não sobrevive a JSON.stringify')
    case 'function':
      throw new ImpureStateError(path, 'função')
    case 'bigint':
    case 'symbol':
      throw new ImpureStateError(path, typeof value)
    default:
      break
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPureJson(item, `${path}[${index}]`))
    return
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    throw new ImpureStateError(path, `objeto de classe (${(value as object).constructor?.name})`)
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    assertPureJson(child, `${path}.${key}`)
  }
}

export function toJson(state: GameState): string {
  assertPureJson(state)
  return JSON.stringify(state)
}

export function fromJson(json: string): unknown {
  return JSON.parse(json)
}

/** Cópia profunda por round-trip — usada no export/import e nos testes. */
export function cloneState(state: GameState): GameState {
  return JSON.parse(toJson(state)) as GameState
}
