/**
 * `applyAction(state, action) => { state, log }` — contrato do spec §3.2.
 * Puro e determinístico: nada aqui lê relógio, DOM ou `Math.random`.
 *
 * Ação inválida **não lança**: devolve o estado intacto e um log explicando o
 * motivo. Quem chama (UI, autoplay, runner) trata os três casos do mesmo jeito.
 */
import { produce } from 'immer'
import type { ActionResult, GameAction, GameState, LogEntry, Skills } from './types'
import { ACTION_BLOCKS_PER_DAY, ACTION_COSTS, MEALS_PER_DAY, VITALS } from '../data/config'
import { findMeal } from '../data/living'
import { findJob } from '../data/jobs'
import { findCourse } from '../data/courses'
import { chance } from './rng'
import { clamp, hireChance, jobEligibility, performanceGain, workEnergyCost } from './player'
import { nominal } from './macro'
import {
  amortizingPayment,
  availableCash,
  creditLimitFor,
  debit,
  findAccount,
  loanRateFor,
  monthlyIncome,
  savingsRateFor,
} from './banking'
import { findBank } from '../data/banks'
import { BANKING } from '../data/config'
import { fillBuy, fillSell } from './market'

const clampVital = (value: number): number => clamp(value, 0, VITALS.max)

/** Validade padrão de uma ordem limite em livro, em dias. */
const MARKET_ORDER_VALIDITY_DAYS = 30

/**
 * Id determinístico: dia + blocos já gastos + tipo da ação. Precisa ser
 * reproduzível porque o log entra no estado, e o teste de determinismo compara
 * o estado inteiro.
 */
function entryFor(state: GameState, action: GameAction) {
  const id = `act-${state.date.dayIndex}-${state.player.blocksUsedToday}-${action.kind}`
  return (
    severity: LogEntry['severity'],
    text: string,
    amount: number | null = null,
  ): LogEntry => ({
    id,
    dayIndex: state.date.dayIndex,
    severity,
    source: 'action',
    text,
    amount,
  })
}

function blocksLeft(state: GameState): number {
  return ACTION_BLOCKS_PER_DAY - state.player.blocksUsedToday
}

function addSkills(target: Skills, grants: Partial<Skills>): void {
  for (const [key, value] of Object.entries(grants) as Array<[keyof Skills, number]>) {
    target[key] = clamp(target[key] + value, 0, 100)
  }
}

export function applyAction(state: GameState, action: GameAction): ActionResult {
  const log: LogEntry[] = []

  const entry = entryFor(state, action)

  const next = produce(state, (draft) => {
    const { player } = draft

    if (player.incarceratedDays > 0 && action.kind !== 'definirRotina') {
      log.push(entry('ruim', 'Você está preso e não pode agir.'))
      return
    }

    switch (action.kind) {
      case 'trabalhar':
      case 'horaExtra': {
        const config = action.kind === 'trabalhar' ? ACTION_COSTS.trabalhar : ACTION_COSTS.horaExtra
        if (!player.currentJobId) {
          log.push(entry('ruim', 'Você não tem emprego.'))
          return
        }
        const cost = workEnergyCost(state, config.energy)
        if (blocksLeft(state) < config.blocks) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        if (player.energy < cost) {
          log.push(entry('ruim', 'Energia insuficiente.'))
          return
        }
        player.blocksUsedToday += config.blocks
        player.energy = clampVital(player.energy - cost)
        player.career.performance = clamp(player.career.performance + performanceGain(state), 0, 100)

        if (action.kind === 'horaExtra') {
          const extra = (player.career.salary / 30) * (ACTION_COSTS.horaExtra.payMultiplier - 1)
          player.money += extra
          player.mood = clampVital(player.mood + ACTION_COSTS.horaExtra.moodDelta)
          log.push(entry('info', 'Hora extra.', extra))
        } else {
          player.mood = clampVital(player.mood + ACTION_COSTS.trabalhar.moodDelta)
          log.push(entry('info', 'Dia de trabalho.'))
        }
        return
      }

      case 'estudar': {
        const config = ACTION_COSTS.estudar
        if (!player.activeCourse) {
          log.push(entry('ruim', 'Você não está matriculado em nenhum curso.'))
          return
        }
        if (blocksLeft(state) < config.blocks) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        if (player.energy < config.energy) {
          log.push(entry('ruim', 'Energia insuficiente.'))
          return
        }
        player.blocksUsedToday += config.blocks
        player.energy = clampVital(player.energy - config.energy)
        player.skills.intelligence = clamp(
          player.skills.intelligence + config.intelligenceGain,
          0,
          100,
        )
        player.activeCourse.daysDone += 1

        const course = findCourse(player.activeCourse.courseId)
        if (course && player.activeCourse.daysDone >= course.studyDays) {
          // Concluído: concede as skills e entra em `education` uma única vez.
          addSkills(player.skills, course.grants)
          if (!player.education.includes(course.id)) player.education.push(course.id)
          player.activeCourse = null
          log.push(entry('bom', `Curso concluído: ${course.name}.`))
        } else {
          log.push(entry('info', 'Dia de estudo.'))
        }
        return
      }

      case 'academia':
      case 'lazer':
      case 'socializar': {
        const config = ACTION_COSTS[action.kind]
        if (blocksLeft(state) < config.blocks) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        if (player.energy < config.energy) {
          log.push(entry('ruim', 'Energia insuficiente.'))
          return
        }
        player.blocksUsedToday += config.blocks
        player.energy = clampVital(player.energy - config.energy)

        // Cada ramo lê a sua própria constante: indexar `ACTION_COSTS` pela união
        // devolve a união dos três formatos, e o TS não a estreita pelo `if`.
        if (action.kind === 'academia') {
          const academia = ACTION_COSTS.academia
          player.skills.fitness = clamp(player.skills.fitness + academia.fitnessGain, 0, 100)
          player.health = clampVital(player.health + academia.healthGain)
          log.push(entry('info', 'Treino feito.'))
        } else if (action.kind === 'lazer') {
          player.mood = clampVital(player.mood + ACTION_COSTS.lazer.moodGain)
          log.push(entry('info', 'Descanso.'))
        } else {
          const social = ACTION_COSTS.socializar
          player.skills.charisma = clamp(player.skills.charisma + social.charismaGain, 0, 100)
          player.contacts += social.contacts
          log.push(entry('info', 'Você fez contatos.'))
        }
        return
      }

      case 'comer': {
        const meal = findMeal(action.mealId)
        if (!meal) {
          log.push(entry('ruim', 'Refeição desconhecida.'))
          return
        }
        if (player.mealsToday >= MEALS_PER_DAY) {
          log.push(entry('ruim', 'Você já comeu o bastante hoje.'))
          return
        }
        const mealCost = nominal(draft.macro, meal.cost)
        if (player.money < mealCost) {
          log.push(entry('ruim', 'Dinheiro insuficiente.'))
          return
        }
        player.money -= mealCost
        player.mealsToday += 1
        player.hunger = clampVital(player.hunger + meal.hunger)
        player.health = clampVital(player.health + meal.health)
        player.mood = clampVital(player.mood + meal.mood)
        player.energy = clampVital(player.energy + meal.energy)
        log.push(entry('info', meal.name, -mealCost))
        return
      }

      case 'matricular': {
        const course = findCourse(action.courseId)
        if (!course) {
          log.push(entry('ruim', 'Curso desconhecido.'))
          return
        }
        if (player.education.includes(course.id)) {
          log.push(entry('ruim', 'Você já concluiu esse curso.'))
          return
        }
        if (player.activeCourse) {
          log.push(entry('ruim', 'Você já está matriculado em outro curso.'))
          return
        }
        const missingRequisite = course.requires.find((id) => !player.education.includes(id))
        if (missingRequisite) {
          log.push(entry('ruim', `Exige ${missingRequisite} concluído.`))
          return
        }
        const courseCost = nominal(draft.macro, course.cost)
        if (availableCash(state) < courseCost) {
          log.push(entry('ruim', 'Dinheiro insuficiente para a matrícula.'))
          return
        }
        debit(draft, courseCost)
        player.activeCourse = { courseId: course.id, daysDone: 0 }
        log.push(entry('info', `Matriculado em ${course.name}.`, -courseCost))
        return
      }

      case 'candidatar': {
        const job = findJob(action.jobId)
        if (!job) {
          log.push(entry('ruim', 'Vaga inexistente.'))
          return
        }
        if (player.currentJobId === job.id) {
          log.push(entry('ruim', 'Você já ocupa esse cargo.'))
          return
        }
        const eligibility = jobEligibility(state, job.id)
        if (!eligibility.ok) {
          log.push(entry('ruim', `Requisitos não atendidos: ${eligibility.missing.join('; ')}`))
          return
        }
        // Consome RNG mesmo quando falha: o determinismo depende do consumo, não
        // do resultado.
        const hired = chance(draft.rng, hireChance(state, job.id))
        if (!hired) {
          log.push(entry('ruim', `Você não foi selecionado para ${job.title}.`))
          return
        }
        player.currentJobId = job.id
        player.career.jobId = job.id
        player.career.salary = nominal(draft.macro, job.salary)
        player.career.daysInJob = 0
        player.career.daysSinceLastRaise = 0
        player.career.performance = 50
        log.push(entry('bom', `Contratado: ${job.title}.`))
        return
      }

      case 'pedirDemissao': {
        if (!player.currentJobId) {
          log.push(entry('ruim', 'Você não tem emprego.'))
          return
        }
        player.currentJobId = null
        player.career.jobId = null
        player.career.salary = 0
        player.career.daysInJob = 0
        player.career.performance = 50
        log.push(entry('info', 'Você pediu demissão.'))
        return
      }

      case 'definirRotina': {
        if (action.routine.length === 0) {
          log.push(entry('ruim', 'A rotina não pode ser vazia.'))
          return
        }
        player.routine = action.routine.slice(0, ACTION_BLOCKS_PER_DAY)
        log.push(entry('info', 'Rotina atualizada.'))
        return
      }

      case 'comprarAcao':
      case 'venderAcao': {
        const company = draft.companies[action.companyId]
        if (!company?.stock) {
          log.push(entry('ruim', 'Ativo desconhecido.'))
          return
        }
        if (action.shares <= 0 || !Number.isFinite(action.shares)) {
          log.push(entry('ruim', 'Quantidade inválida.'))
          return
        }

        // Ordem limite não executa agora: entra em livro e espera o preço
        // cruzar (spec §5.3). Operar na bolsa não consome bloco de ação.
        if (action.limitPrice !== null) {
          if (action.limitPrice <= 0) {
            log.push(entry('ruim', 'Preço limite inválido.'))
            return
          }
          draft.market.orders.push({
            id: `ord-${draft.date.dayIndex}-${draft.market.orders.length}-${action.companyId}`,
            companyId: action.companyId,
            kind: 'limite',
            side: action.kind === 'comprarAcao' ? 'compra' : 'venda',
            shares: action.shares,
            limitPrice: action.limitPrice,
            placedDayIndex: draft.date.dayIndex,
            expiresDayIndex: draft.date.dayIndex + MARKET_ORDER_VALIDITY_DAYS,
          })
          log.push(entry('info', `Ordem limite registrada em ${company.name}.`))
          return
        }

        const result =
          action.kind === 'comprarAcao'
            ? fillBuy(draft, action.companyId, action.shares)
            : fillSell(draft, action.companyId, action.shares)

        if (!result.ok) {
          log.push(entry('ruim', result.reason ?? 'Ordem recusada.'))
          return
        }

        if (action.kind === 'comprarAcao') {
          log.push(
            entry('info', `Compra de ${action.shares} ${company.name}.`, -result.cost),
          )
        } else {
          log.push(
            entry(
              result.cost >= 0 ? 'bom' : 'ruim',
              `Venda de ${action.shares} ${company.name}.`,
              result.cost,
            ),
          )
        }
        return
      }

      case 'cancelarOrdem': {
        const index = draft.market.orders.findIndex((order) => order.id === action.orderId)
        if (index < 0) {
          log.push(entry('ruim', 'Ordem não encontrada.'))
          return
        }
        draft.market.orders.splice(index, 1)
        log.push(entry('info', 'Ordem cancelada.'))
        return
      }

      case 'pagarImposto': {
        const index = draft.market.taxDebts.findIndex((item) => item.id === action.debtId)
        const item = draft.market.taxDebts[index]
        if (!item) {
          log.push(entry('ruim', 'Pendência não encontrada.'))
          return
        }
        const total = item.amount + item.penalty
        if (availableCash(state) < total) {
          log.push(entry('ruim', 'Dinheiro insuficiente para quitar o imposto.'))
          return
        }
        debit(draft, total)
        draft.market.taxDebts.splice(index, 1)
        log.push(entry('bom', 'Imposto quitado.', -total))
        return
      }

      case 'depositar':
      case 'aplicar': {
        const bank = findBank(action.bankId)
        if (!bank) {
          log.push(entry('ruim', 'Banco desconhecido.'))
          return
        }
        if (player.creditScore < bank.minScore) {
          log.push(entry('ruim', `${bank.name} exige score ${bank.minScore}.`))
          return
        }
        if (action.amount <= 0 || player.money < action.amount) {
          log.push(entry('ruim', 'Valor indisponível em caixa.'))
          return
        }

        // Depositar em banco onde não há conta abre a conta: não existe ação
        // separada de abertura, e o gesto do jogador é o mesmo.
        let account = draft.banking.accounts.find((item) => item.bankId === bank.id)
        if (!account) {
          account = {
            bankId: bank.id,
            checking: 0,
            savings: 0,
            savingsRate: savingsRateFor(state, bank),
            savingsLockedUntilDayIndex: null,
          }
          draft.banking.accounts.push(account)
        }

        player.money -= action.amount
        if (action.kind === 'depositar') {
          account.checking += action.amount
          log.push(entry('info', `Depósito em ${bank.name}.`, -action.amount))
        } else {
          const wasEmpty = account.savings <= 0
          account.savings += action.amount
          account.savingsRate = savingsRateFor(state, bank)
          // A carência conta a partir do primeiro aporte e **não** é renovada
          // por aportes seguintes: renovar prendia o dinheiro para sempre em
          // quem aplica todo mês, e nada na tela avisaria.
          if (bank.lockDays > 0 && wasEmpty) {
            account.savingsLockedUntilDayIndex = draft.date.dayIndex + bank.lockDays
          }
          log.push(entry('info', `Aplicado em ${bank.name}.`, -action.amount))
        }
        return
      }

      case 'sacar':
      case 'resgatar': {
        const account = findAccount(state, action.bankId)
        const bank = findBank(action.bankId)
        if (!account || !bank) {
          log.push(entry('ruim', 'Você não tem conta nesse banco.'))
          return
        }
        const draftAccount = draft.banking.accounts.find((item) => item.bankId === action.bankId)
        if (!draftAccount) return

        if (action.kind === 'sacar') {
          if (action.amount <= 0 || draftAccount.checking < action.amount) {
            log.push(entry('ruim', 'Saldo insuficiente em conta.'))
            return
          }
          draftAccount.checking -= action.amount
          player.money += action.amount
          log.push(entry('info', `Saque em ${bank.name}.`, action.amount))
          return
        }

        if (
          account.savingsLockedUntilDayIndex !== null &&
          draft.date.dayIndex < account.savingsLockedUntilDayIndex
        ) {
          const days = account.savingsLockedUntilDayIndex - draft.date.dayIndex
          log.push(entry('ruim', `Aplicação em carência por mais ${days} dias.`))
          return
        }
        if (action.amount <= 0 || draftAccount.savings < action.amount) {
          log.push(entry('ruim', 'Saldo insuficiente na aplicação.'))
          return
        }
        draftAccount.savings -= action.amount
        player.money += action.amount
        if (draftAccount.savings <= 0) draftAccount.savingsLockedUntilDayIndex = null
        log.push(entry('info', `Resgate em ${bank.name}.`, action.amount))
        return
      }

      case 'tomarEmprestimo': {
        const bank = findBank(action.bankId)
        if (!bank) {
          log.push(entry('ruim', 'Banco desconhecido.'))
          return
        }
        if (player.creditScore < bank.minScore) {
          log.push(entry('ruim', `${bank.name} exige score ${bank.minScore}.`))
          return
        }
        if (monthlyIncome(state) <= 0) {
          log.push(entry('ruim', 'Sem renda comprovada, nenhum banco empresta.'))
          return
        }
        const limit = creditLimitFor(state, bank)
        if (action.amount <= 0 || action.amount > limit) {
          log.push(entry('ruim', `Limite disponível em ${bank.name} é menor que o pedido.`))
          return
        }
        if (action.termDays <= 0) {
          log.push(entry('ruim', 'Prazo inválido.'))
          return
        }

        const rate = loanRateFor(state, bank)
        draft.banking.loans.push({
          id: `loan-${bank.id}-${draft.date.dayIndex}-${draft.banking.loans.length}`,
          bankId: bank.id,
          kind: action.loanKind,
          borrower: 'player',
          principal: action.amount,
          rate,
          termDays: action.termDays,
          remaining: action.amount,
          dailyPayment: amortizingPayment(action.amount, rate, action.termDays),
          nextDueDayIndex: draft.date.dayIndex + 1,
          daysOverdue: 0,
          collateral: null,
        })
        player.money += action.amount
        log.push(
          entry(
            'info',
            `Empréstimo em ${bank.name} a ${(rate * 100).toFixed(1)}% ao ano.`,
            action.amount,
          ),
        )
        return
      }

      case 'pagarEmprestimo': {
        const loan = draft.banking.loans.find((item) => item.id === action.loanId)
        if (!loan) {
          log.push(entry('ruim', 'Empréstimo não encontrado.'))
          return
        }
        const amount = Math.min(action.amount, loan.remaining)
        if (amount <= 0 || availableCash(state) < amount) {
          log.push(entry('ruim', 'Dinheiro insuficiente.'))
          return
        }
        debit(draft, amount)
        loan.remaining -= amount
        log.push(entry('bom', 'Amortização de empréstimo.', -amount))
        return
      }

      case 'contratarCartao': {
        const bank = findBank(action.bankId)
        if (!bank) {
          log.push(entry('ruim', 'Banco desconhecido.'))
          return
        }
        if (draft.banking.cards.some((card) => card.bankId === bank.id)) {
          log.push(entry('ruim', 'Você já tem cartão nesse banco.'))
          return
        }
        if (player.creditScore < bank.minScore) {
          log.push(entry('ruim', `${bank.name} exige score ${bank.minScore}.`))
          return
        }
        const limit = monthlyIncome(state) * bank.cardLimitMultiple
        if (limit <= 0) {
          log.push(entry('ruim', 'Sem renda comprovada, nenhum banco dá cartão.'))
          return
        }
        draft.banking.cards.push({
          bankId: bank.id,
          limit,
          balance: 0,
          revolvingMonthlyRate: bank.cardMonthlyRate,
          statementDay: BANKING.cardStatementDay,
        })
        log.push(entry('info', `Cartão ${bank.name} aprovado.`))
        return
      }

      default:
        // Ações das fases seguintes; `avancarTempo` é roteada para runDays.
        log.push(entry('ruim', `Ação ainda não implementada: ${action.kind}.`))
    }
  })

  return { state: next, log }
}
