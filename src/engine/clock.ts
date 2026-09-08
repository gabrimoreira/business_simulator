/**
 * Passo 1 do tick: calendário. TypeScript puro — a data é `GameDate`, nunca
 * `Date` (CLAUDE.md §1).
 *
 * O clock não conhece nenhum outro sistema: ele avança a data e devolve os
 * marcos do dia, e cada sistema decide o que fazer com eles.
 */
import type { GameDate, GameState } from './types'
import { CAREER, START_DAY, START_MONTH } from '../data/config'

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInMonth(month: number, year: number): number {
  if (month === 2 && isLeapYear(year)) return 29
  return DAYS_IN_MONTH[month - 1] ?? 30
}

/** Próximo dia do calendário. Puro: devolve uma data nova. */
export function advanceDate(date: GameDate): GameDate {
  const lastDay = daysInMonth(date.month, date.year)
  if (date.day < lastDay) {
    return { ...date, dayIndex: date.dayIndex + 1, day: date.day + 1 }
  }
  if (date.month < 12) {
    return { dayIndex: date.dayIndex + 1, day: 1, month: date.month + 1, year: date.year }
  }
  return { dayIndex: date.dayIndex + 1, day: 1, month: 1, year: date.year + 1 }
}

/** Marcos do dia, consumidos pelos passos seguintes do tick. */
export interface DayMarkers {
  isMonthStart: boolean
  isMonthEnd: boolean
  isQuarterEnd: boolean
  isYearStart: boolean
  isBirthday: boolean
  isPayday: boolean
  isBillsDay: boolean
}

export function markersFor(date: GameDate): DayMarkers {
  const lastDay = daysInMonth(date.month, date.year)
  return {
    isMonthStart: date.day === 1,
    isMonthEnd: date.day === lastDay,
    isQuarterEnd: date.day === lastDay && date.month % 3 === 0,
    isYearStart: date.day === 1 && date.month === 1,
    // Aniversário pela data de início, nunca por dayIndex/365 — bissexto derraparia.
    isBirthday: date.day === START_DAY && date.month === START_MONTH && date.dayIndex > 0,
    isPayday: date.day === CAREER.paydayDay,
    isBillsDay: date.day === CAREER.billsDay,
  }
}

/**
 * Avança a data no draft e devolve os marcos do novo dia.
 * O reset dos blocos de ação mora aqui porque é propriedade do **dia**, não do
 * jogador — o passo `player` só reage ao que já foi gasto.
 */
export function stepClock(draft: GameState): DayMarkers {
  draft.date = advanceDate(draft.date)
  draft.player.blocksUsedToday = 0
  draft.player.mealsToday = 0

  const markers = markersFor(draft.date)
  if (markers.isBirthday) draft.player.age += 1
  return markers
}
