/**
 * Runner headless de balanceamento (spec §7).
 *
 *   npm run sim -- --days 3650 --seed 42 --strategy passive
 *
 * Roda a engine sem UI e imprime CSV no stdout. Usa `runDays`, o **mesmo**
 * caminho da UI e do catch-up offline: se divergisse, o balanceamento estaria
 * medindo um jogo que ninguém joga.
 */
import { createInitialState } from '@/engine/newGame'
import { netWorth } from '@/engine/selectors'
import { applyAction } from '@/engine/actions'
import { runDays } from '@/engine/autoplay'
import type { GameState } from '@/engine/types'
import { findJob } from '@/data/jobs'
import { decideActions, getStrategy, STRATEGY_IDS, type StrategyId } from './strategies'

interface Options {
  days: number
  seed: number
  strategy: StrategyId
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
      if (!STRATEGY_IDS.includes(value as StrategyId)) {
        throw new Error(`Estratégia desconhecida: ${value}. Use uma de ${STRATEGY_IDS.join(', ')}.`)
      }
      options.strategy = value as StrategyId
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
  'job',
  'salary',
  'energy',
  'health',
  'mood',
  'hunger',
  'courses',
  'overdue',
  'selic',
  'inflation',
] as const

function row(state: GameState): string {
  const { date, player, macro } = state
  const job = player.currentJobId ? findJob(player.currentJobId) : null
  return [
    date.dayIndex,
    `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`,
    player.age,
    netWorth(state).toFixed(2),
    player.money.toFixed(2),
    job ? job.id : '-',
    player.career.salary.toFixed(2),
    player.energy.toFixed(1),
    player.health.toFixed(1),
    player.mood.toFixed(1),
    player.hunger.toFixed(1),
    player.education.length,
    player.overdueBills.toFixed(2),
    macro.selic.toFixed(4),
    macro.inflation.toFixed(4),
  ].join(',')
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  const strategy = getStrategy(options.strategy)

  let state = createInitialState({
    seed: options.seed,
    playerName: `sim-${options.strategy}`,
    now: 0,
  })
  state = applyAction(state, { kind: 'definirRotina', routine: strategy.routine }).state

  process.stdout.write(`${COLUMNS.join(',')}\n`)
  process.stdout.write(`${row(state)}\n`)

  let healthSum = 0
  let moodSum = 0
  let daysLived = 0

  for (let day = 1; day <= options.days; day += 1) {
    for (const action of decideActions(state, strategy)) {
      state = applyAction(state, action).state
    }
    state = runDays(state, 1).state
    daysLived += 1
    healthSum += state.player.health
    moodSum += state.player.mood

    if (day % options.every === 0 || day === options.days) {
      process.stdout.write(`${row(state)}\n`)
    }
    if (state.meta.ending) break
  }

  const summary = [
    `${options.strategy}: ${daysLived} dias, seed ${options.seed}`,
    `patrimônio final ${netWorth(state).toFixed(2)}`,
    `saúde média ${(healthSum / daysLived).toFixed(1)}`,
    `humor médio ${(moodSum / daysLived).toFixed(1)}`,
    `cursos ${state.player.education.length}`,
    `cargo ${state.player.currentJobId ?? '-'}`,
    `desfecho ${state.meta.ending ?? 'em andamento'}`,
  ].join(' · ')
  process.stderr.write(`\n${summary}\n`)
}

main()
