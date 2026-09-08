/**
 * Runner headless de balanceamento (spec §7).
 *
 *   npm run sim -- --days 3650 --seed 42 --strategy passive
 *
 * Roda a engine sem UI e imprime CSV no stdout. Nesta fase ainda não há sistemas
 * para exercitar — o laço avança o calendário e reporta as colunas que já
 * existem. Cada fase seguinte acrescenta colunas e nunca muda o contrato de CLI.
 */
import { createInitialState } from '@/engine/newGame'
import { netWorth } from '@/engine/selectors'
import type { GameState } from '@/engine/types'

const STRATEGIES = ['passive', 'investor', 'entrepreneur', 'tycoon', 'pricewar', 'raider'] as const
type Strategy = (typeof STRATEGIES)[number]

interface Options {
  days: number
  seed: number
  strategy: Strategy
  every: number
}

function parseArgs(argv: string[]): Options {
  const options: Options = { days: 3650, seed: 42, strategy: 'passive', every: 30 }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = argv[i + 1]
    if (arg === '--days' && value) options.days = Number.parseInt(value, 10)
    else if (arg === '--seed' && value) options.seed = Number.parseInt(value, 10)
    else if (arg === '--every' && value) options.every = Number.parseInt(value, 10)
    else if (arg === '--strategy' && value) {
      if (!STRATEGIES.includes(value as Strategy)) {
        throw new Error(`Estratégia desconhecida: ${value}. Use uma de ${STRATEGIES.join(', ')}.`)
      }
      options.strategy = value as Strategy
    }
  }
  if (!Number.isFinite(options.days) || options.days <= 0) throw new Error('--days inválido')
  if (!Number.isFinite(options.seed)) throw new Error('--seed inválido')
  return options
}

const COLUMNS = [
  'dayIndex',
  'date',
  'age',
  'netWorth',
  'money',
  'selic',
  'inflation',
  'marketIndex',
  'unemployment',
] as const

function row(state: GameState): string {
  const { date, player, macro } = state
  return [
    date.dayIndex,
    `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`,
    player.age,
    netWorth(state).toFixed(2),
    player.money.toFixed(2),
    macro.selic.toFixed(4),
    macro.inflation.toFixed(4),
    macro.marketIndex.toFixed(2),
    macro.unemployment.toFixed(4),
  ].join(',')
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  let state = createInitialState({
    seed: options.seed,
    playerName: `sim-${options.strategy}`,
    now: 0,
  })

  process.stdout.write(`${COLUMNS.join(',')}\n`)
  process.stdout.write(`${row(state)}\n`)

  for (let day = 1; day <= options.days; day += 1) {
    // Fase 1 substitui isto por worldTick(state, 1) e pela estratégia escolhida.
    state = { ...state, date: { ...state.date, dayIndex: day } }
    if (day % options.every === 0 || day === options.days) {
      process.stdout.write(`${row(state)}\n`)
    }
  }

  process.stderr.write(
    `\n${options.strategy}: ${options.days} dias, seed ${options.seed}. ` +
      `Sistemas ainda não implementados — colunas macro são as iniciais.\n`,
  )
}

main()
