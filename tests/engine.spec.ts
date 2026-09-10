import { describe, expect, it } from 'vitest'
import { applyAction } from '@/engine/actions'
import { runDays } from '@/engine/autoplay'
import { worldTick } from '@/engine/tick'
import { advanceDate, daysInMonth, isLeapYear, markersFor } from '@/engine/clock'
import { jobEligibility } from '@/engine/player'
import { monthlyBudget, nextMoneyEvent } from '@/engine/selectors'
import { assertPureJson } from '@/persistence/serialize'
import { decideActions, getStrategy } from '@/sim/strategies'
import { ACTION_BLOCKS_PER_DAY, CAREER } from '@/data/config'
import type { GameAction, GameState } from '@/engine/types'
import { advance, employed, fresh, funded, hire, liveDay } from './helpers'

/** Roda a estratégia do runner, o mesmo caminho que a UI usa. */
function simulate(days: number, strategyId: 'passive' | 'investor' = 'passive', seed = 42): GameState {
  const strategy = getStrategy(strategyId)
  let state = applyAction(fresh(seed), { kind: 'definirRotina', routine: strategy.routine }).state
  for (let day = 0; day < days; day += 1) {
    for (const action of decideActions(state, strategy)) {
      state = applyAction(state, action).state
    }
    state = runDays(state, 1).state
    if (state.meta.ending) break
  }
  return state
}

describe('clock', () => {
  it('conhece anos bissextos', () => {
    expect(isLeapYear(2024)).toBe(true)
    expect(isLeapYear(2025)).toBe(false)
    expect(isLeapYear(1900)).toBe(false)
    expect(isLeapYear(2000)).toBe(true)
    expect(daysInMonth(2, 2024)).toBe(29)
    expect(daysInMonth(2, 2025)).toBe(28)
  })

  it('vira mês e ano corretamente', () => {
    expect(advanceDate({ dayIndex: 0, day: 31, month: 1, year: 2025 })).toEqual({
      dayIndex: 1,
      day: 1,
      month: 2,
      year: 2025,
    })
    expect(advanceDate({ dayIndex: 0, day: 31, month: 12, year: 2025 })).toEqual({
      dayIndex: 1,
      day: 1,
      month: 1,
      year: 2026,
    })
  })

  it('marca fim de trimestre só no último dia de mar/jun/set/dez', () => {
    expect(markersFor({ dayIndex: 1, day: 31, month: 3, year: 2025 }).isQuarterEnd).toBe(true)
    expect(markersFor({ dayIndex: 1, day: 30, month: 3, year: 2025 }).isQuarterEnd).toBe(false)
    expect(markersFor({ dayIndex: 1, day: 30, month: 4, year: 2025 }).isQuarterEnd).toBe(false)
  })

  it('envelhece na data de início, não a cada 365 dias', () => {
    const state = simulate(365)
    // 2025 não é bissexto: 1º de janeiro de 2026 é o dia 365.
    expect(state.date).toMatchObject({ day: 1, month: 1, year: 2026 })
    expect(state.player.age).toBe(19)
  })
})

describe('determinismo', () => {
  it('mesma seed e mesmas ações produzem o mesmo estado', () => {
    const actions: GameAction[] = [
      { kind: 'candidatar', jobId: 'atendente' },
      { kind: 'comer', mealId: 'normal' },
      { kind: 'lazer' },
      { kind: 'academia' },
    ]
    const run = (): GameState => {
      let state = fresh()
      for (const action of actions) state = applyAction(state, action).state
      return worldTick(state, 10).state
    }
    expect(run()).toEqual(run())
  })

  it('365 dias de rotina reproduzem o mesmo estado', () => {
    expect(simulate(365)).toEqual(simulate(365))
  })

  it('seeds diferentes divergem', () => {
    expect(simulate(120, 'passive', 1)).not.toEqual(simulate(120, 'passive', 2))
  })
})

describe('sanidade numérica em 3650 dias', () => {
  const state = simulate(3650)

  it('não produz NaN nem Infinity em lugar nenhum do estado', () => {
    // assertPureJson percorre o estado inteiro e recusa número não finito.
    expect(() => assertPureJson(state)).not.toThrow()
  })

  it('mantém vitais em [0, 100]', () => {
    for (const value of [
      state.player.energy,
      state.player.health,
      state.player.mood,
      state.player.hunger,
      state.player.skills.intelligence,
      state.player.skills.charisma,
      state.player.skills.technical,
      state.player.skills.fitness,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(100)
    }
  })

  it('não deixa negativo o que nunca pode ser negativo (GAME_DESIGN C11)', () => {
    expect(state.player.money).toBeGreaterThanOrEqual(0)
    expect(state.player.overdueBills).toBeGreaterThanOrEqual(0)
    expect(state.player.creditScore).toBeGreaterThanOrEqual(0)
    expect(state.player.career.salary).toBeGreaterThanOrEqual(0)
  })

  it('sobrevive dez anos trabalhando', () => {
    expect(state.meta.ending).toBeNull()
    expect(state.date.dayIndex).toBe(3650)
  })
})

describe('blocos de ação', () => {
  it('são 3 por dia e a quarta ação é recusada', () => {
    let state = hire(fresh())
    state = worldTick(state, 1).state // zera os blocos gastos na contratação
    for (let i = 0; i < ACTION_BLOCKS_PER_DAY; i += 1) {
      state = applyAction(state, { kind: 'lazer' }).state
    }
    expect(state.player.blocksUsedToday).toBe(ACTION_BLOCKS_PER_DAY)

    const refused = applyAction(state, { kind: 'lazer' })
    expect(refused.state.player.blocksUsedToday).toBe(ACTION_BLOCKS_PER_DAY)
    expect(refused.log[0]?.text).toContain('Sem blocos')
  })

  it('reiniciam na virada do dia', () => {
    let state = applyAction(fresh(), { kind: 'lazer' }).state
    expect(state.player.blocksUsedToday).toBe(1)
    state = worldTick(state, 1).state
    expect(state.player.blocksUsedToday).toBe(0)
  })

  it('comer não consome bloco (resolução C3)', () => {
    const state = applyAction(fresh(), { kind: 'comer', mealId: 'marmita' }).state
    expect(state.player.blocksUsedToday).toBe(0)
    expect(state.player.mealsToday).toBe(1)
  })
})

describe('salário e contas', () => {
  it('é creditado exatamente uma vez por mês', () => {
    let state = funded(hire(fresh()))
    let credits = 0
    for (let day = 0; day < 730; day += 1) {
      const result = liveDay(state)
      state = result.state
      credits += result.entries.filter((e) => e.text === 'Salário creditado.').length
    }
    // 730 dias a partir de 1º de janeiro contêm exatamente 24 dias 5.
    expect(credits).toBe(24)
    expect(state.meta.ending).toBeNull()
  })

  it('reajusta o salário pela inflação na virada do ano', () => {
    let state = funded(hire(fresh()))
    const before = state.player.career.salary
    for (let day = 0; day < 400; day += 1) state = liveDay(state).state

    // A inflação anda todo dia a partir da Fase 2, então o reajuste é comparado
    // com a faixa plausível, não com um número fixo.
    const raise = state.player.career.salary / before - 1
    expect(raise).toBeGreaterThan(0.01)
    expect(raise).toBeLessThan(0.1)
  })

  it('conta não paga vira pendência e é quitada quando entra dinheiro', () => {
    // Dinheiro só para comer, nunca para as contas do dia 10.
    let state = hire(fresh())
    for (let day = 0; day < 45; day += 1) {
      state = { ...state, player: { ...state.player, money: 25 } }
      state = liveDay(state).state
    }
    expect(state.player.overdueBills).toBeGreaterThan(0)

    // Agora com salário entrando de verdade, a pendência é quitada.
    state = funded(state)
    for (let day = 0; day < 40; day += 1) state = liveDay(state).state
    expect(state.player.overdueBills).toBe(0)
  })
})

describe('educação e carreira', () => {
  it('curso concluído concede skill e entra em education uma única vez', () => {
    let state = funded(fresh())
    state = applyAction(state, { kind: 'matricular', courseId: 'oratoria' }).state

    const charismaBefore = state.player.skills.charisma
    for (let day = 0; day < 120; day += 1) {
      state = liveDay(state, { kind: 'estudar' }).state
    }

    expect(state.player.education).toEqual(['oratoria'])
    expect(state.player.skills.charisma).toBeGreaterThan(charismaBefore)
    expect(state.player.activeCourse).toBeNull()

    // Estudar de novo sem matrícula não repete o bônus.
    const again = applyAction(state, { kind: 'estudar' })
    expect(again.state.player.education).toEqual(['oratoria'])
    expect(again.log[0]?.text).toContain('não está matriculado')
  })

  it('não deixa se matricular sem o pré-requisito nem sem dinheiro', () => {
    const rich = funded(fresh())
    expect(applyAction(rich, { kind: 'matricular', courseId: 'mba' }).log[0]?.text).toContain(
      'graduacao',
    )
    expect(applyAction(fresh(), { kind: 'matricular', courseId: 'graduacao' }).log[0]?.text).toContain(
      'Dinheiro insuficiente',
    )
  })

  it('promoção exige skill, diploma e tempo de casa', () => {
    const state = fresh()
    const analista = jobEligibility(state, 'analista-jr')
    expect(analista.ok).toBe(false)
    expect(analista.missing.join(' ')).toContain('graduacao')

    const encarregado = jobEligibility(state, 'encarregado')
    expect(encarregado.ok).toBe(false)
    expect(encarregado.missing.join(' ')).toContain('Carisma')

    // A vaga de entrada não exige nada.
    expect(jobEligibility(state, 'atendente').ok).toBe(true)
  })

  it('recusa a candidatura quando os requisitos não são atendidos', () => {
    const result = applyAction(fresh(), { kind: 'candidatar', jobId: 'diretor' })
    expect(result.state.player.currentJobId).toBeNull()
    expect(result.log[0]?.text).toContain('Requisitos não atendidos')
  })
})

describe('fim de jogo', () => {
  it('saúde zero encerra a partida e o tick para de avançar', () => {
    let state = fresh()
    state = { ...state, player: { ...state.player, health: 1, hunger: 0 } }
    state = worldTick(state, 10).state
    expect(state.meta.ending).toBe('morte')

    const frozen = worldTick(state, 50)
    expect(frozen.state.date.dayIndex).toBe(state.date.dayIndex)
  })
})

describe('extrato do mês', () => {
  /**
   * O teste que impede o painel de mentir.
   *
   * Um extrato que não fecha com o caixa é pior que não ter extrato: o jogador
   * passa a desconfiar do número em vez de se orientar por ele.
   */
  it('as contas previstas batem com o que o tick debita', () => {
    // Passa a carência de 30 dias do primeiro mês: nela o motor **não** cobra
    // contas (Fase 1, para o jogador não nascer num buraco). Medir dentro dela
    // dava zero de despesa e foi o que este teste pegou de primeira.
    const inicial = advance(employed(fresh(), 5000, 200_000), CAREER.firstBillsGraceDays).state
    const previsto = monthlyBudget(inicial)

    const { entries } = advance(inicial, 31)

    const salario = entries
      .filter((e) => e.text.includes('Salário'))
      .reduce((sum, e) => sum + (e.amount ?? 0), 0)
    const contas = entries
      .filter((e) => e.text.includes('Contas do mês'))
      .reduce((sum, e) => sum + Math.abs(e.amount ?? 0), 0)

    expect(salario).toBeCloseTo(previsto.totalIncome, 0)

    // Moradia + transporte + saúde são a linha "Contas do mês" do motor.
    const previstoContas = previsto.expenses
      .filter((line) => line.label === 'Moradia' || line.label === 'Transporte e saúde')
      .reduce((sum, line) => sum + line.amount, 0)

    // Tolerância relativa de 0,5%, e não igualdade: o extrato é uma **foto do
    // nível de preços de hoje**, e a cobrança acontece dias depois, com a
    // inflação já tendo andado. Medido: 0,14% de deriva em dez dias. Exigir
    // igualdade aqui seria exigir que o jogo não tivesse inflação.
    expect(Math.abs(contas - previstoContas) / previstoContas).toBeLessThan(0.005)
  })

  it('só entra no extrato o que é recorrente', () => {
    // Comprar ação é evento, não orçamento: se entrasse aqui, o saldo do mês
    // oscilaria sem significar nada.
    const rico = funded(fresh(), 10_000_000)
    const antes = monthlyBudget(rico)
    const comprou = applyAction(rico, {
      kind: 'comprarAcao',
      companyId: rico.companyOrder[0]!,
      shares: 100,
      limitPrice: null,
    }).state
    expect(monthlyBudget(comprou).totalExpenses).toBeCloseTo(antes.totalExpenses, 5)
  })

  it('o próximo evento de dinheiro é sempre o mais próximo, e nunca negativo', () => {
    for (let day = 1; day <= 28; day += 1) {
      const state = { ...fresh(), date: { ...fresh().date, day } }
      const evento = nextMoneyEvent(state)
      expect(evento.days).toBeGreaterThanOrEqual(0)
      expect(['salário', 'contas']).toContain(evento.label)
    }
  })
})
