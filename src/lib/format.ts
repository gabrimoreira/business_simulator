/**
 * Formatação para exibição. Sempre BRL, sempre pt-BR (spec §6).
 * Camada de UI: a engine não formata nada.
 */
import type { GameDate } from '@/engine/types'

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
})

const brlWhole = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

export function formatMoney(value: number): string {
  return Math.abs(value) >= 1000 ? brlWhole.format(value) : brl.format(value)
}

/**
 * Valores grandes em escala curta: `R$ 1,2 mi`, `R$ 3,4 bi`. É o formato exigido
 * pelo spec §6 — tela de celular não tem espaço para 12 dígitos.
 */
export function formatMoneyCompact(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1e12) return `${sign}R$ ${decimal.format(abs / 1e12)} tri`
  if (abs >= 1e9) return `${sign}R$ ${decimal.format(abs / 1e9)} bi`
  if (abs >= 1e6) return `${sign}R$ ${decimal.format(abs / 1e6)} mi`
  if (abs >= 1e4) return `${sign}R$ ${decimal.format(abs / 1e3)} mil`
  return formatMoney(value)
}

export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits).replace('.', ',')}%`
}

const MONTHS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
]

export function formatGameDate(date: GameDate): string {
  const month = MONTHS[date.month - 1] ?? '?'
  return `${String(date.day).padStart(2, '0')} ${month} ${date.year}`
}
