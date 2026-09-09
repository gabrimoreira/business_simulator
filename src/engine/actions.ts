/**
 * `applyAction(state, action) => { state, log }` — contrato do spec §3.2.
 * Puro e determinístico: nada aqui lê relógio, DOM ou `Math.random`.
 *
 * Ação inválida **não lança**: devolve o estado intacto e um log explicando o
 * motivo. Quem chama (UI, autoplay, runner) trata os três casos do mesmo jeito.
 */
import { produce } from 'immer'
import type { ActionResult, GameAction, GameState, LogEntry, Skills } from './types'
import { ACTION_BLOCKS_PER_DAY, ACTION_COSTS, MEALS_PER_DAY, SKILL_CURVE, VITALS } from '../data/config'
import { findMeal } from '../data/living'
import { findJob } from '../data/jobs'
import { findCourse } from '../data/courses'
import { chance } from './rng'
import {
  clamp,
  finishRun,
  hireChance,
  jobEligibility,
  performanceGain,
  workEnergyCost,
} from './player'
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
import { findOutlet } from '../data/newsOutlets'
import { findAsset } from '../data/assets'
import { ASSETS_CONFIG } from '../data/config'
import { findIndustry } from '../data/industries'
import { CONTROL, DEFENSE, NEWS, OPERATIONS, POLITICS } from '../data/config'
import { findPolicyDef } from '../data/policies'
import { netLobby } from './politics'
import { annualizedProfit, capitalNeededFor, valuationOf } from './companies'
import { sectorMultiple } from './market'
import {
  applyControl,
  buyFromFloat,
  buyback,
  poisonPill,
  referencePrice,
  sellToFloat,
  stakeOf,
  totalShares,
  whiteKnight,
} from './ownership'
import { BANKING } from '../data/config'
import { fillBuy, fillSell } from './market'
import { MARKET } from '../data/config'

const clampVital = (value: number): number => clamp(value, 0, VITALS.max)

/**
 * Ganho de skill treinada por bloco, com rendimento decrescente.
 *
 * `base × (1 − skill/100)^expoente`: quem está em 10 avança quase o ganho
 * cheio, quem está em 85 avança 2% dele. Ver `SKILL_CURVE` em `data/config`
 * para o porquê do formato.
 */
function trainedGain(base: number, current: number): number {
  const headroom = Math.max(0, 1 - current / 100)
  return base * headroom ** SKILL_CURVE.exponent
}

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
          player.skills.charisma = clamp(
            player.skills.charisma + trainedGain(social.charismaGain, player.skills.charisma),
            0,
            100,
          )
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

      case 'fundarEmpresa': {
        const industry = findIndustry(action.industryId)
        if (!industry) {
          log.push(entry('ruim', 'Setor desconhecido.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        const minimum = nominal(draft.macro, OPERATIONS.minFoundingCapital)
        if (action.capital < minimum) {
          log.push(entry('ruim', `Capital mínimo é ${Math.round(minimum)}.`))
          return
        }
        if (availableCash(state) < action.capital) {
          log.push(entry('ruim', 'Dinheiro insuficiente.'))
          return
        }

        debit(draft, action.capital)
        player.blocksUsedToday += 1

        const id = `own-${draft.date.dayIndex}-${draft.meta.companiesFoundedCount}`
        const headcount = OPERATIONS.foundingHeadcount
        const salary = industry.outputPerEmployee * industry.payrollRatio * draft.macro.priceLevel

        draft.companies[id] = {
          id,
          name: action.name,
          industryId: industry.id,
          isPublic: false,
          founded: draft.date,
          cash: action.capital,
          debt: 0,
          revenue: 0,
          costs: 0,
          lastQuarterProfit: 0,
          profitHistory: [],
          workforce: { headcount, avgSalary: salary, productivity: 100, morale: 70 },
          productQuality: OPERATIONS.foundingQuality,
          brandAwareness: OPERATIONS.foundingBrand,
          rndLevel: 1,
          rndProgress: 0,
          price: 1,
          marketingSpend: 0,
          ownership: [{ holderId: 'player', shares: 1_000_000 }],
          stock: null,
          reputation: 50,
          directives: {
            price: 1,
            marketingRatio: 0.05,
            rndRatio: 0.03,
            headcountTarget: headcount,
            payoutRatio: 0,
            cashReserveTarget: 0.2,
            minMargin: 0.05,
          },
          capacity: 0,
          baseMargin: industry.baseMargin,
          // O capital fundador é o que limita a produção no primeiro dia.
          capitalStock: action.capital,
          marketShare: 0,
          status: 'ativa',
          quartersNegativeCash: 0,
          quartersInRj: 0,
          managedBy: 'player',
          quartersReported: 0,
        }
        draft.companyOrder.push(id)
        draft.industries[industry.id]?.companyOrder.push(id)
        draft.meta.companiesFoundedCount += 1

        log.push(entry('bom', `${action.name} fundada.`, -action.capital))
        return
      }

      case 'ajustarPreco':
      case 'ajustarMarketing':
      case 'investirPeD': {
        const company = draft.companies[action.companyId]
        if (!company || company.managedBy !== 'player') {
          log.push(entry('ruim', 'Você não dirige essa empresa.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        // Diretriz é persistente (resolução C2): o bloco é cobrado ao mudar, não
        // todo dia para manter a empresa funcionando.
        player.blocksUsedToday += 1

        if (action.kind === 'ajustarPreco') {
          const price = clamp(action.price, 0.3, 3)
          company.price = price
          company.directives.price = price
          log.push(entry('info', `Preço de ${company.name} ajustado.`))
        } else if (action.kind === 'ajustarMarketing') {
          company.directives.marketingRatio = clamp(action.ratio, 0, 0.35)
          log.push(entry('info', `Marketing de ${company.name} ajustado.`))
        } else {
          company.directives.rndRatio = clamp(action.ratio, 0, 0.35)
          log.push(entry('info', `P&D de ${company.name} ajustado.`))
        }
        return
      }

      case 'contratar': {
        const company = draft.companies[action.companyId]
        if (!company || company.managedBy !== 'player') {
          log.push(entry('ruim', 'Você não dirige essa empresa.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        if (action.count <= 0 || action.salary <= 0) {
          log.push(entry('ruim', 'Contratação inválida.'))
          return
        }
        // Custo de contratação: um mês de salário adiantado por cabeça.
        const cost = (action.salary / 12) * action.count
        if (company.cash < cost) {
          log.push(entry('ruim', 'A empresa não tem caixa para contratar.'))
          return
        }
        player.blocksUsedToday += 1
        company.cash -= cost

        const total = company.workforce.headcount + action.count
        company.workforce.avgSalary =
          (company.workforce.avgSalary * company.workforce.headcount + action.salary * action.count) /
          total
        company.workforce.headcount = total
        company.directives.headcountTarget = total
        log.push(entry('info', `${action.count} contratados em ${company.name}.`, -cost))
        return
      }

      case 'demitir':
      case 'demissaoEmMassa': {
        const company = draft.companies[action.companyId]
        if (!company || company.managedBy !== 'player') {
          log.push(entry('ruim', 'Você não dirige essa empresa.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        const count = action.kind === 'demissaoEmMassa' ? action.count : 1
        if (count <= 0 || company.workforce.headcount <= count) {
          log.push(entry('ruim', 'Não há gente suficiente para demitir.'))
          return
        }
        player.blocksUsedToday += 1

        // Rescisão custa caixa e moral. Demissão em massa ainda derruba a
        // reputação — e, a partir da Fase 4, vira notícia.
        const severance = (company.workforce.avgSalary / 12) * count * 2
        company.cash -= severance
        company.workforce.headcount -= count
        company.directives.headcountTarget = company.workforce.headcount

        const massRatio = count / (company.workforce.headcount + count)
        company.workforce.morale = clamp(
          company.workforce.morale - OPERATIONS.layoffMoraleHit * Math.max(0.2, massRatio * 3),
          0,
          100,
        )
        if (action.kind === 'demissaoEmMassa') {
          company.reputation = clamp(company.reputation - OPERATIONS.layoffReputationHit, 0, 100)
        }
        log.push(entry('ruim', `${count} demitidos em ${company.name}.`, -severance))
        return
      }

      case 'expandirCapacidade': {
        const company = draft.companies[action.companyId]
        if (!company || company.managedBy !== 'player') {
          log.push(entry('ruim', 'Você não dirige essa empresa.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        if (action.investment <= 0 || company.cash < action.investment) {
          log.push(entry('ruim', 'A empresa não tem caixa para isso.'))
          return
        }
        player.blocksUsedToday += 1
        company.cash -= action.investment

        company.capitalStock += action.investment
        log.push(entry('info', `Capacidade de ${company.name} ampliada.`, -action.investment))
        return
      }

      case 'emprestimoEmpresarial': {
        const company = draft.companies[action.companyId]
        const bank = findBank(action.bankId)
        if (!company || company.managedBy !== 'player' || !bank) {
          log.push(entry('ruim', 'Operação indisponível.'))
          return
        }
        // Crédito empresarial olha a receita da empresa, não o salário do dono.
        const limit = Math.max(0, company.revenue * 0.5 - company.debt)
        if (action.amount <= 0 || action.amount > limit) {
          log.push(entry('ruim', 'Acima do limite de crédito da empresa.'))
          return
        }
        company.cash += action.amount
        company.debt += action.amount
        log.push(entry('info', `Capital de giro para ${company.name}.`, action.amount))
        return
      }

      case 'venderEmpresa': {
        const company = draft.companies[action.companyId]
        const industry = company ? findIndustry(company.industryId) : null
        if (!company || !industry || company.managedBy !== 'player') {
          log.push(entry('ruim', 'Você não dirige essa empresa.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        player.blocksUsedToday += 1

        const multiple = sectorMultiple(industry.multipleBase, draft.macro.selic)
        const price = valuationOf(company, multiple)
        player.money += price
        company.status = 'fechada'
        company.managedBy = 'ai'
        company.ownership = [{ holderId: 'float', shares: 0 }]

        draft.companyOrder = draft.companyOrder.filter((id) => id !== company.id)
        const industryState = draft.industries[company.industryId]
        if (industryState) {
          industryState.companyOrder = industryState.companyOrder.filter((id) => id !== company.id)
        }
        log.push(entry('bom', `${company.name} vendida.`, price))
        return
      }

      case 'lancarOpa': {
        const company = draft.companies[action.companyId]
        if (!company?.stock || !company.isPublic) {
          log.push(entry('ruim', 'Só empresa listada aceita oferta pública.'))
          return
        }
        if (draft.tenders.some((item) => item.companyId === action.companyId && item.status === 'aberta')) {
          log.push(entry('ruim', 'Já existe uma oferta aberta para essa empresa.'))
          return
        }
        const premium = clamp(action.premium, CONTROL.minPremium, CONTROL.maxPremium)
        const reference = referencePrice(company)
        const pricePerShare = reference * (1 + premium)
        const cost = pricePerShare * action.sharesSought

        // Sem caixa não há oferta: o mercado exige o dinheiro à vista.
        if (availableCash(state) < cost) {
          log.push(entry('ruim', 'Você não tem caixa para bancar a oferta.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        player.blocksUsedToday += 1

        const hostile = stakeOf(company, 'player') < CONTROL.controlStake
        draft.tenders.push({
          id: `opa-${company.id}-${draft.date.dayIndex}`,
          companyId: company.id,
          bidderId: 'player',
          premium,
          pricePerShare,
          sharesSought: action.sharesSought,
          hostile,
          openedDayIndex: draft.date.dayIndex,
          expiresDayIndex: draft.date.dayIndex + CONTROL.tenderDays,
          status: 'aberta',
          acceptedShares: 0,
          playerAnswered: false,
        })

        draft.news.headlines.push({
          id: `hl-opa-${company.id}-${draft.date.dayIndex}`,
          outletId: 'portal',
          dayIndex: draft.date.dayIndex,
          text: `Oferta ${hostile ? 'hostil' : 'amigável'} por ${company.name} com prêmio de ${(premium * 100).toFixed(0)}%`,
          subject: { kind: 'company', id: company.id },
          sentiment: 0.4,
          isRumor: false,
          accuracy: 1,
          isTrue: true,
          planted: false,
          eventId: null,
        })

        log.push(entry('info', `OPA lançada sobre ${company.name}.`))
        return
      }

      case 'fecharCapital': {
        const company = draft.companies[action.companyId]
        if (!company?.stock) {
          log.push(entry('ruim', 'Empresa não listada.'))
          return
        }
        const stake = stakeOf(company, 'player')
        if (stake < CONTROL.squeezeOutStake) {
          log.push(
            entry('ruim', `Fechar capital exige ${(CONTROL.squeezeOutStake * 100).toFixed(0)}% do capital.`),
          )
          return
        }

        // Compra compulsória dos minoritários com prêmio sobre a média de 60
        // dias: o minoritário **recebe dinheiro**, não perde a posição (C9).
        const price = referencePrice(company) * 1.2
        const outstanding = totalShares(company) * (1 - stake)
        const cost = price * outstanding
        if (availableCash(state) < cost) {
          log.push(entry('ruim', 'Caixa insuficiente para comprar os minoritários.'))
          return
        }
        debit(draft, cost)

        const position = draft.market.positions[company.id]
        if (position) {
          position.shares = 0
          position.avgPrice = 0
        }
        company.ownership = [{ holderId: 'player', shares: totalShares(company) }]
        company.isPublic = false
        company.stock = null
        company.managedBy = 'player'
        log.push(entry('bom', `${company.name} fechou o capital.`, -cost))
        return
      }

      case 'abrirCapital': {
        const company = draft.companies[action.companyId]
        const bank = findBank(action.bankId)
        if (!company || company.managedBy !== 'player' || company.isPublic || !bank) {
          log.push(entry('ruim', 'Operação indisponível.'))
          return
        }
        if (company.quartersReported < CONTROL.ipoMinQuarters) {
          log.push(
            entry('ruim', `A empresa precisa de ${CONTROL.ipoMinQuarters} trimestres divulgados.`),
          )
          return
        }
        const revenueFloor = nominal(draft.macro, CONTROL.ipoMinAnnualRevenue)
        const profitFloor = nominal(draft.macro, CONTROL.ipoMinAnnualProfit)
        if (company.revenue < revenueFloor || annualizedProfit(company) < profitFloor) {
          log.push(entry('ruim', 'Receita ou lucro abaixo do exigido para abrir capital.'))
          return
        }
        const floatPct = clamp(action.floatPct, CONTROL.ipoMinFloat, CONTROL.ipoMaxFloat)
        if (action.pricePerShare <= 0) {
          log.push(entry('ruim', 'Preço de abertura inválido.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        player.blocksUsedToday += 1

        const shares = totalShares(company) || 1_000_000
        const floatShares = Math.round(shares * floatPct)
        const raised = floatShares * action.pricePerShare
        const fee = raised * CONTROL.ipoBankFeeRatio

        company.isPublic = true
        company.stock = {
          companyId: company.id,
          price: action.pricePerShare,
          sharesOutstanding: shares,
          beta: 1.1,
          volatility: findIndustry(company.industryId)?.volatility ?? 0.02,
          dividendYieldTarget: 0.02,
          history: [],
          weeklyCount: 0,
          volumeToday: 0,
          eventShockToday: 0,
        }
        company.ownership = [
          { holderId: 'player', shares: shares - floatShares },
          { holderId: 'float', shares: floatShares },
        ]
        company.cash += raised - fee
        draft.ipos.push({
          companyId: company.id,
          underwriterBankId: bank.id,
          floatPct,
          pricePerShare: action.pricePerShare,
          feePaid: fee,
          dayIndex: draft.date.dayIndex,
        })

        draft.news.headlines.push({
          id: `hl-ipo-${company.id}-${draft.date.dayIndex}`,
          outletId: 'referencia',
          dayIndex: draft.date.dayIndex,
          text: `${company.name} abre capital coordenada por ${bank.name}`,
          subject: { kind: 'company', id: company.id },
          sentiment: 0.5,
          isRumor: false,
          accuracy: 1,
          isTrue: true,
          planted: false,
          eventId: null,
        })

        log.push(entry('bom', `${company.name} abriu capital.`, raised - fee))
        return
      }

      case 'fundir': {
        const acquirer = draft.companies[action.acquirerId]
        const target = draft.companies[action.targetId]
        if (!acquirer || !target || acquirer.managedBy !== 'player') {
          log.push(entry('ruim', 'Operação indisponível.'))
          return
        }
        if (stakeOf(target, 'player') <= CONTROL.controlStake) {
          log.push(entry('ruim', 'Você precisa controlar a empresa alvo para fundir.'))
          return
        }
        if (acquirer.industryId !== target.industryId) {
          log.push(entry('ruim', 'Só empresas do mesmo setor se fundem por enquanto.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        player.blocksUsedToday += 1

        const synergy = 1 + CONTROL.mergerSynergy
        acquirer.capitalStock += target.capitalStock
        acquirer.cash += target.cash - action.cash
        acquirer.debt += target.debt
        acquirer.workforce.headcount += target.workforce.headcount
        acquirer.capacity = (acquirer.capacity + target.capacity) * synergy
        acquirer.directives.headcountTarget =
          acquirer.workforce.headcount + target.workforce.headcount
        // Choque de cultura: a fusão custa moral dos dois lados.
        acquirer.workforce.morale = clamp(
          acquirer.workforce.morale - CONTROL.mergerCultureShock,
          0,
          100,
        )

        target.status = 'adquirida'
        target.managedBy = 'ai'
        draft.companyOrder = draft.companyOrder.filter((id) => id !== target.id)
        const industryState = draft.industries[target.industryId]
        if (industryState) {
          industryState.companyOrder = industryState.companyOrder.filter((id) => id !== target.id)
        }
        delete draft.ai.agents[target.id]
        draft.ai.agentOrder = draft.ai.agentOrder.filter((id) => id !== target.id)

        log.push(entry('bom', `${target.name} incorporada por ${acquirer.name}.`))
        return
      }

      case 'nomearCeo': {
        const company = draft.companies[action.companyId]
        if (!company) {
          log.push(entry('ruim', 'Empresa desconhecida.'))
          return
        }
        if (stakeOf(company, 'player') <= CONTROL.controlStake) {
          log.push(entry('ruim', 'Você precisa controlar a empresa para nomear o CEO.'))
          return
        }
        const profile = draft.ai.profiles[action.profileId]
        if (!profile) {
          log.push(entry('ruim', 'Arquétipo desconhecido.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        player.blocksUsedToday += 1

        // Delegar é escolher uma personalidade e viver com o que ela faz
        // (resolução C2): a empresa sai da sua lista de blocos diários.
        company.managedBy = 'ai'
        const existing = draft.ai.agents[company.id]
        draft.ai.agents[company.id] = {
          companyId: company.id,
          profileId: action.profileId,
          stress: 0,
          breakUntilDayIndex: null,
          warFatigue: 0,
          grudge: existing?.grudge ?? {},
          lastReviewDayIndex: -1,
          reviewOffset: draft.date.dayIndex % 90,
          cooldowns: {},
          badQuarters: 0,
          imitationTargetId: null,
          appointedByPlayer: true,
        }
        if (!draft.ai.agentOrder.includes(company.id)) draft.ai.agentOrder.push(company.id)

        // As obrigações do arquétipo entram na diretriz já: o novo CEO chega
        // mandando.
        for (const rule of profile.hardRules) {
          if (rule.kind === 'floor' && rule.field === 'rndRatio') company.directives.rndRatio = rule.value
          if (rule.kind === 'floor' && rule.field === 'marketingRatio') {
            company.directives.marketingRatio = rule.value
          }
          if (rule.kind === 'ceiling' && rule.field === 'rndRatio') company.directives.rndRatio = rule.value
          if (rule.kind === 'ceiling' && rule.field === 'marketingRatio') {
            company.directives.marketingRatio = rule.value
          }
        }
        company.directives.cashReserveTarget = profile.cashReserveTarget
        company.directives.minMargin = profile.minMargin

        log.push(entry('info', `${profile.name} assume o comando de ${company.name}.`))
        return
      }

      case 'doar': {
        const politician = draft.politics.politicians[action.politicianId]
        if (!politician) {
          log.push(entry('ruim', 'Político desconhecido.'))
          return
        }
        if (action.amount <= 0) {
          log.push(entry('ruim', 'Valor inválido.'))
          return
        }

        // Doação de empresa é mais rastreável que doação pessoal — e prova é o
        // que condena numa investigação.
        const company = action.fromCompanyId ? draft.companies[action.fromCompanyId] : null
        if (action.fromCompanyId && (!company || company.managedBy !== 'player')) {
          log.push(entry('ruim', 'Você não dirige essa empresa.'))
          return
        }
        if (company) {
          if (company.cash < action.amount) {
            log.push(entry('ruim', 'A empresa não tem caixa para isso.'))
            return
          }
          company.cash -= action.amount
        } else {
          if (availableCash(state) < action.amount) {
            log.push(entry('ruim', 'Dinheiro insuficiente.'))
            return
          }
          debit(draft, action.amount)
        }

        const gain = Math.min(
          POLITICS.loyaltyMaxPerDonation,
          (action.amount / POLITICS.donationUnit) ** POLITICS.loyaltyExponent,
        )
        politician.loyaltyToPlayer = Math.min(100, politician.loyaltyToPlayer + gain)
        politician.donationsFromPlayer += action.amount

        draft.politics.donations.push({
          id: `don-${action.politicianId}-${draft.date.dayIndex}`,
          donorId: 'player',
          politicianId: action.politicianId,
          amount: action.amount,
          dayIndex: draft.date.dayIndex,
          traceable: company !== null,
        })
        draft.player.notoriety = clamp(
          draft.player.notoriety + (company ? POLITICS.notorietyPerDonation : 1),
          0,
          100,
        )

        log.push(entry('info', `Doação para ${politician.name}.`, -action.amount))
        return
      }

      case 'fazerLobby': {
        const policy = draft.politics.policies[action.policyId]
        if (!policy || policy.status !== 'tramitando') {
          log.push(entry('ruim', 'Não há votação em curso para essa política.'))
          return
        }
        if (action.amount <= 0 || availableCash(state) < action.amount) {
          log.push(entry('ruim', 'Dinheiro insuficiente.'))
          return
        }
        debit(draft, action.amount)

        draft.politics.lobbyEfforts.push({
          id: `lob-${action.policyId}-${draft.date.dayIndex}-${draft.politics.lobbyEfforts.length}`,
          policyId: action.policyId,
          actorId: 'player',
          amount: action.amount,
          direction: action.direction,
          dayIndex: draft.date.dayIndex,
        })
        draft.player.notoriety = clamp(draft.player.notoriety + 2, 0, 100)

        const net = netLobby(draft, action.policyId)
        log.push(
          entry(
            'info',
            `Lobby ${action.direction > 0 ? 'a favor' : 'contra'} de ${policy.name}: saldo de ${(net * 100).toFixed(1)} pontos.`,
            -action.amount,
          ),
        )
        return
      }

      case 'proporPolitica': {
        const definition = findPolicyDef(action.policyId)
        if (!definition || draft.politics.policies[action.policyId]) {
          log.push(entry('ruim', 'Política indisponível.'))
          return
        }
        // Propor exige cargo: quem não está na casa não apresenta projeto.
        if (!player.office) {
          log.push(entry('ruim', 'Só quem ocupa cargo eletivo propõe política.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        player.blocksUsedToday += 1

        const sponsor = draft.politics.politicianOrder[0] ?? 'moraes'
        draft.politics.policies[action.policyId] = {
          id: definition.id,
          name: definition.name,
          effects: definition.effects,
          sponsorId: sponsor,
          status: 'tramitando',
          supportPct: definition.baseSupport,
          proposedDayIndex: draft.date.dayIndex,
          voteDayIndex: draft.date.dayIndex + definition.debateDays,
          beneficiaryIndustryIds: definition.beneficiaryIndustryIds,
          playerVote: null,
        }
        draft.politics.policyOrder.push(definition.id)
        log.push(entry('info', `Você apresentou ${definition.name}.`))
        return
      }

      case 'contratarAdvogado': {
        const investigation = draft.politics.investigations.find(
          (item) => item.id === action.investigationId && item.status === 'aberta',
        )
        if (!investigation) {
          log.push(entry('ruim', 'Não há investigação aberta com esse número.'))
          return
        }
        if (action.spend <= 0 || availableCash(state) < action.spend) {
          log.push(entry('ruim', 'Dinheiro insuficiente.'))
          return
        }
        debit(draft, action.spend)
        investigation.lawyerSpend += action.spend
        // Advogado caro apaga prova — é o que o §5.7 chama de mitigação.
        const erased = (action.spend / 1_000_000) * POLITICS.evidencePerMillionLawyer
        investigation.evidence = Math.max(0, investigation.evidence - erased)
        log.push(
          entry('info', `Defesa contratada: ${erased.toFixed(1)} de prova neutralizada.`, -action.spend),
        )
        return
      }

      case 'candidatarCargo': {
        const requirement = POLITICS.officeRequirements[action.office]
        if (!requirement) {
          log.push(entry('ruim', 'Cargo desconhecido.'))
          return
        }
        const cost = nominal(draft.macro, requirement.campaign)
        if (action.campaignSpend < cost) {
          log.push(entry('ruim', `A campanha custa ao menos ${Math.round(cost)}.`))
          return
        }
        if (availableCash(state) < action.campaignSpend) {
          log.push(entry('ruim', 'Dinheiro insuficiente para a campanha.'))
          return
        }
        if (player.skills.charisma < requirement.charisma) {
          log.push(
            entry('ruim', `Carisma ${Math.floor(player.skills.charisma)}/${requirement.charisma}.`),
          )
          return
        }
        if (player.publicReputation < requirement.reputation) {
          log.push(entry('ruim', 'Sua reputação pública não sustenta a candidatura.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        player.blocksUsedToday += 1
        debit(draft, action.campaignSpend)

        // Quanto mais se gasta acima do mínimo, maior a chance — mas notoriedade
        // e reputação pesam junto.
        const overspend = action.campaignSpend / cost
        const odds = clamp(
          0.15 + Math.log10(overspend) * 0.35 + player.publicReputation / 250 - player.notoriety / 300,
          0.03,
          0.9,
        )
        if (!chance(draft.rng, odds)) {
          log.push(entry('ruim', `Você perdeu a eleição para ${action.office}.`, -action.campaignSpend))
          return
        }

        player.office = action.office
        if (!draft.meta.officesHeld.includes(action.office)) {
          draft.meta.officesHeld.push(action.office)
        }
        player.publicReputation = clamp(player.publicReputation + 10, -100, 100)
        draft.news.headlines.push({
          id: `hl-eleito-${draft.date.dayIndex}`,
          outletId: 'portal',
          dayIndex: draft.date.dayIndex,
          text: `${player.name} é eleito ${action.office}`,
          subject: { kind: 'player', id: 'player' },
          sentiment: 0.4,
          isRumor: false,
          accuracy: 1,
          isTrue: true,
          planted: false,
          eventId: null,
        })
        log.push(entry('bom', `Você foi eleito ${action.office}.`, -action.campaignSpend))
        return
      }

      case 'comprarAtivo': {
        const definition = findAsset(action.assetId)
        if (!definition) {
          log.push(entry('ruim', 'Bem desconhecido.'))
          return
        }
        const price = nominal(draft.macro, definition.price)
        if (availableCash(state) < price) {
          log.push(entry('ruim', 'Dinheiro insuficiente.'))
          return
        }
        debit(draft, price)

        const id = `own-${definition.id}-${draft.date.dayIndex}`
        draft.personalAssets.assets.push({
          id,
          assetId: definition.id,
          kind: definition.kind,
          name: definition.name,
          purchasePrice: price,
          currentValue: price,
          purchasedDayIndex: draft.date.dayIndex,
          monthlyIncome: nominal(draft.macro, definition.monthlyIncome),
          annualValueChange: definition.annualValueChange,
          moodBonus: definition.moodBonus,
          reputationBonus: definition.reputationBonus,
          notorietyCost: definition.notorietyCost,
          pledgedToLoanId: null,
          isResidence: false,
        })

        player.mood = clampVital(player.mood + definition.moodBonus)
        player.publicReputation = clamp(
          player.publicReputation + definition.reputationBonus,
          -100,
          100,
        )
        log.push(entry('bom', `${definition.name} comprado.`, -price))
        return
      }

      case 'venderAtivo': {
        const index = draft.personalAssets.assets.findIndex((asset) => asset.id === action.id)
        const asset = draft.personalAssets.assets[index]
        if (!asset) {
          log.push(entry('ruim', 'Você não tem esse bem.'))
          return
        }
        if (asset.pledgedToLoanId) {
          log.push(entry('ruim', 'Esse bem está dado em garantia.'))
          return
        }
        // Venda fora do mercado sai com deságio: bem não é dinheiro.
        const price = asset.currentValue * (1 - ASSETS_CONFIG.saleSpread)
        player.money += price
        draft.personalAssets.assets.splice(index, 1)
        if (draft.personalAssets.residenceId === asset.id) {
          draft.personalAssets.residenceId = null
        }
        log.push(entry('info', `${asset.name} vendido.`, price))
        return
      }

      case 'mudarResidencia': {
        if (action.id === null) {
          draft.personalAssets.residenceId = null
          for (const asset of draft.personalAssets.assets) asset.isResidence = false
          log.push(entry('info', 'Você voltou a alugar.'))
          return
        }
        const asset = draft.personalAssets.assets.find((item) => item.id === action.id)
        if (!asset || asset.kind !== 'imovel') {
          log.push(entry('ruim', 'Só dá para morar em imóvel seu.'))
          return
        }
        for (const item of draft.personalAssets.assets) item.isResidence = item.id === asset.id
        draft.personalAssets.residenceId = asset.id
        // Morando no que é seu, o aluguel some do orçamento.
        draft.personalAssets.monthlyRent = 0
        log.push(entry('bom', `Você mudou para ${asset.name}.`))
        return
      }

      case 'encerrarPartida': {
        finishRun(draft, action.ending, log)
        return
      }

      case 'assinarVeiculo': {
        const outlet = findOutlet(action.outletId)
        if (!outlet) {
          log.push(entry('ruim', 'Veículo desconhecido.'))
          return
        }
        if (draft.market.subscriptions.some((item) => item.outletId === outlet.id)) {
          log.push(entry('ruim', 'Você já assina esse veículo.'))
          return
        }
        const cost = nominal(draft.macro, outlet.monthlyCost)
        if (availableCash(state) < cost) {
          log.push(entry('ruim', 'Dinheiro insuficiente para a assinatura.'))
          return
        }
        debit(draft, cost)
        draft.market.subscriptions.push({
          outletId: outlet.id,
          startedDayIndex: draft.date.dayIndex,
          monthlyCost: outlet.monthlyCost,
        })
        log.push(entry('info', `Assinatura de ${outlet.name}.`, -cost))
        return
      }

      case 'cancelarAssinatura': {
        const index = draft.market.subscriptions.findIndex(
          (item) => item.outletId === action.outletId,
        )
        if (index < 0) {
          log.push(entry('ruim', 'Você não assina esse veículo.'))
          return
        }
        draft.market.subscriptions.splice(index, 1)
        log.push(entry('info', 'Assinatura cancelada.'))
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

      /**
       * Defesa do controle — as três que a IA já usava contra o jogador.
       *
       * `agents.ts` chama `buyback`, `poisonPill` e `whiteKnight` desde a Fase
       * 6b para defender empresas de NPC. O jogador não tinha como reagir, o
       * que quebrava a paridade de ações do §4 a favor da IA. Os `case` abaixo
       * chamam **as mesmas funções, com as mesmas constantes** — nenhum poder
       * novo, só o vocabulário completo dos dois lados.
       */
      case 'responderOpa': {
        const tender = draft.tenders.find((item) => item.id === action.tenderId)
        if (!tender || tender.status !== 'aberta') {
          log.push(entry('ruim', 'Oferta indisponível.'))
          return
        }
        const company = draft.companies[tender.companyId]
        if (!company) {
          log.push(entry('ruim', 'Empresa desconhecida.'))
          return
        }
        const held = stakeOf(company, 'player') * totalShares(company)
        if (held <= 0) {
          log.push(entry('ruim', 'Você não tem ações nessa empresa.'))
          return
        }
        if (!action.accept) {
          // Recusar é decisão, não inação: marca para o atacante não contar
          // com essas ações e some da lista de pendências do jogador.
          tender.playerAnswered = true
          log.push(entry('info', `Você recusou a oferta por ${company.name}.`))
          return
        }

        // Vende ao preço da oferta, limitado ao que ela ainda busca.
        const sold = Math.min(held, Math.max(0, tender.sharesSought - tender.acceptedShares))
        if (sold <= 0) {
          log.push(entry('ruim', 'A oferta já está totalmente preenchida.'))
          return
        }
        // Sai do jogador para o float e do float para o comprador: são as duas
        // funções exportadas de `ownership`, sem tocar no `transfer` privado.
        sellToFloat(company, 'player', sold, tender.pricePerShare)
        buyFromFloat(company, tender.bidderId, sold, tender.pricePerShare)
        tender.acceptedShares += sold
        tender.playerAnswered = true
        player.money += sold * tender.pricePerShare
        applyControl(draft, company, log)
        log.push(
          entry('bom', `Você aceitou a oferta por ${company.name}.`, sold * tender.pricePerShare),
        )
        return
      }

      case 'pilulaDeVeneno': {
        const company = draft.companies[action.companyId]
        if (!company || company.managedBy !== 'player') {
          log.push(entry('ruim', 'Você não dirige essa empresa.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        // Dilui quem está comprando. Sem atacante identificado não há pílula:
        // emitir ação contra ninguém é só diluir a si mesmo.
        const raider = draft.tenders.find(
          (item) => item.companyId === company.id && item.status === 'aberta',
        )?.bidderId
        if (!raider) {
          log.push(entry('ruim', 'Não há oferta aberta contra essa empresa.'))
          return
        }
        const issued = poisonPill(company, raider, DEFENSE.poisonPillIssue)
        if (issued <= 0) {
          log.push(entry('ruim', 'A emissão não foi possível.'))
          return
        }
        player.blocksUsedToday += 1
        applyControl(draft, company, log)
        log.push(entry('bom', `${company.name} emitiu ações para diluir o comprador.`))
        return
      }

      case 'cavaleiroBranco': {
        const company = draft.companies[action.companyId]
        if (!company || company.managedBy !== 'player') {
          log.push(entry('ruim', 'Você não dirige essa empresa.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        const shares = whiteKnight(company, action.allyId, DEFENSE.whiteKnightFloat)
        if (shares <= 0) {
          log.push(entry('ruim', 'Não há float livre para um aliado comprar.'))
          return
        }
        player.blocksUsedToday += 1
        applyControl(draft, company, log)
        log.push(entry('bom', `Um aliado assumiu parte do float de ${company.name}.`))
        return
      }

      case 'votarPolitica': {
        const policy = draft.politics.policies[action.policyId]
        if (!policy || policy.status !== 'tramitando') {
          log.push(entry('ruim', 'Não há votação aberta para esse projeto.'))
          return
        }
        if (!player.office) {
          log.push(entry('ruim', 'Só quem ocupa cargo eletivo vota.'))
          return
        }
        if (policy.playerVote !== null) {
          log.push(entry('ruim', 'Você já votou nesse projeto.'))
          return
        }
        // O peso do voto é o do cargo: vereador não move o que presidente move.
        const weight = POLITICS.voteWeightByOffice[player.office] ?? 0
        policy.playerVote = action.inFavor
        policy.supportPct = clamp(policy.supportPct + (action.inFavor ? weight : -weight), 0, 1)
        log.push(
          entry('info', `Você votou ${action.inFavor ? 'a favor' : 'contra'}: ${policy.name}.`),
        )
        return
      }

      case 'pagarDividendos': {
        const company = draft.companies[action.companyId]
        if (!company || company.managedBy !== 'player') {
          log.push(entry('ruim', 'Você não dirige essa empresa.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        // Diretriz persistente, como preço e marketing (C2): o caixa sai no
        // fechamento do trimestre, em `companies.ts`, não aqui.
        const ratio = clamp(action.ratio, 0, OPERATIONS.maxPayoutRatio)
        player.blocksUsedToday += 1
        company.directives.payoutRatio = ratio
        log.push(
          entry('info', `${company.name} distribuirá ${Math.round(ratio * 100)}% do lucro.`),
        )
        return
      }

      case 'recomprarAcoes': {
        const company = draft.companies[action.companyId]
        if (!company || company.managedBy !== 'player') {
          log.push(entry('ruim', 'Você não dirige essa empresa.'))
          return
        }
        if (!company.isPublic) {
          log.push(entry('ruim', 'Só empresa de capital aberto recompra ações.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        if (action.amount <= 0 || company.cash < action.amount) {
          log.push(entry('ruim', 'A empresa não tem caixa para isso.'))
          return
        }
        // Mesma função que a IA usa para se defender (`agents.ts`): recompra
        // tira float do mercado e concentra o controle de quem já está dentro.
        const shares = buyback(draft, company, action.amount)
        if (shares <= 0) {
          log.push(entry('ruim', 'Não há float suficiente para recomprar.'))
          return
        }
        player.blocksUsedToday += 1
        applyControl(draft, company, log)
        log.push(entry('bom', `${company.name} recomprou ${shares} ações.`, -action.amount))
        return
      }

      case 'reduzirCapacidade': {
        const company = draft.companies[action.companyId]
        if (!company || company.managedBy !== 'player') {
          log.push(entry('ruim', 'Você não dirige essa empresa.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        if (action.amount <= 0 || action.amount > company.capitalStock) {
          log.push(entry('ruim', 'A empresa não tem esse capital instalado.'))
          return
        }
        // Desmobilizar devolve **menos** do que custou: máquina usada não vale o
        // preço de máquina nova, e sem essa perda encolher e crescer viraria uma
        // torneira grátis de caixa.
        const recovered = action.amount * OPERATIONS.capacitySalvageRatio
        player.blocksUsedToday += 1
        company.capitalStock -= action.amount
        company.cash += recovered
        log.push(entry('info', `Capacidade de ${company.name} reduzida.`, recovered))
        return
      }

      case 'anunciarProduto': {
        const company = draft.companies[action.companyId]
        const industry = company ? findIndustry(company.industryId) : null
        if (!company || !industry || company.managedBy !== 'player') {
          log.push(entry('ruim', 'Você não dirige essa empresa.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        if (action.spend <= 0 || company.cash < action.spend) {
          log.push(entry('ruim', 'A empresa não tem caixa para isso.'))
          return
        }
        // Campanha pontual, contra o marketing que é diretriz contínua. Usa a
        // mesma escala de setor e a mesma saturação do passo diário, para uma
        // marca já conhecida ganhar pouco — anunciar não é comprar reputação.
        const sectorScale = Math.max(1, industry.marketSize / 365)
        const saturation = 1 - company.brandAwareness / 100
        const gain =
          (action.spend / sectorScale) * OPERATIONS.brandGainPerRatio * saturation *
          OPERATIONS.campaignBrandMultiplier
        player.blocksUsedToday += 1
        company.cash -= action.spend
        company.brandAwareness = clamp(company.brandAwareness + gain, 0, 100)
        log.push(entry('info', `Campanha de ${company.name} no ar.`, -action.spend))
        return
      }

      case 'comprarVeiculo': {
        const definition = findOutlet(action.outletId)
        const outlet = draft.news.outlets[action.outletId]
        if (!definition || !outlet) {
          log.push(entry('ruim', 'Veículo desconhecido.'))
          return
        }
        if (outlet.ownerId === 'player') {
          log.push(entry('ruim', 'O veículo já é seu.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        // Preço: se o veículo é listado, vale o que a empresa vale; se não é,
        // vale o alcance. Comprar imprensa não é barato de propósito — é a
        // alavanca mais forte do jogo sobre a percepção pública.
        const listed = outlet.companyId ? draft.companies[outlet.companyId] : null
        const industry = listed ? findIndustry(listed.industryId) : null
        // **O alcance é piso, sempre.** `valuationOf` grampeia em zero quando a
        // dívida engole o múltiplo, e havia veículo listado com dívida de
        // R$ 756 mi saindo por R$ 0,00: o jogador levava um megafone de alcance
        // 95 de graça. Quem compra jornal está comprando influência, e
        // influência não fica de graça porque o balanço está ruim.
        const floor = nominal(draft.macro, outlet.reach * NEWS.outletPricePerReach)
        const price =
          listed && industry
            ? Math.max(
                floor,
                valuationOf(listed, sectorMultiple(industry.multipleBase, draft.macro.selic)),
              )
            : floor
        if (availableCash(state) < price) {
          log.push(entry('ruim', `Comprar ${outlet.name} custa ${Math.round(price)}.`))
          return
        }
        player.blocksUsedToday += 1
        debit(draft, price)
        outlet.ownerId = 'player'
        // Dono de jornal é figura pública: aparece, e quem aparece é olhado.
        player.notoriety = clamp(player.notoriety + NEWS.outletNotoriety, 0, 100)
        log.push(entry('bom', `Você comprou ${outlet.name}.`, -price))
        return
      }

      case 'definirPauta': {
        const outlet = draft.news.outlets[action.outletId]
        if (!outlet) {
          log.push(entry('ruim', 'Veículo desconhecido.'))
          return
        }
        if (outlet.ownerId !== 'player') {
          log.push(entry('ruim', 'Você não é dono desse veículo.'))
          return
        }
        const pending = draft.news.editorialOrders.find(
          (order) => order.outletId === outlet.id && draft.date.dayIndex < order.cooldownUntilDayIndex,
        )
        if (pending) {
          log.push(entry('ruim', 'A redação ainda está cumprindo a pauta anterior.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        player.blocksUsedToday += 1
        draft.news.editorialOrders.push({
          id: `pauta-${outlet.id}-${draft.date.dayIndex}`,
          outletId: outlet.id,
          subject: action.subject,
          targetSentiment: clamp(action.targetSentiment, -1, 1),
          dayIndex: draft.date.dayIndex,
          cooldownUntilDayIndex: draft.date.dayIndex + NEWS.agendaCooldownDays,
        })
        // Mandar no que o jornal diz custa credibilidade: a redação percebe.
        outlet.credibility = clamp(outlet.credibility - NEWS.agendaCredibilityCost, 0, 100)
        log.push(entry('info', `Pauta definida em ${outlet.name}.`))
        return
      }

      case 'entrarEmSetor': {
        const company = draft.companies[action.companyId]
        const industry = findIndustry(action.industryId)
        if (!company || company.managedBy !== 'player' || !industry) {
          log.push(entry('ruim', 'Operação indisponível.'))
          return
        }
        if (company.industryId === action.industryId) {
          log.push(entry('ruim', 'A empresa já opera nesse setor.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        // Entrar num setor exige o capital que sustenta um funcionário lá — é o
        // mesmo piso que vale para fundar. Energia e mineração pedem R$ 3 mi por
        // cabeça: são setores para quem já tem empresa grande, e é isso que dá
        // sentido a existir aquisição.
        const minimum = capitalNeededFor(industry.outputPerEmployee, industry)
        if (action.investment < minimum) {
          log.push(entry('ruim', `Entrar em ${industry.name} exige ${Math.round(minimum)}.`))
          return
        }
        if (company.cash < action.investment) {
          log.push(entry('ruim', 'A empresa não tem caixa para isso.'))
          return
        }
        player.blocksUsedToday += 1
        company.cash -= action.investment
        company.capitalStock += action.investment
        // Migra de setor levando a operação junto. A marca **não** vai inteira:
        // ser conhecida em varejo não faz ninguém confiar em você em energia.
        company.industryId = action.industryId
        company.brandAwareness = clamp(
          company.brandAwareness * OPERATIONS.sectorEntryBrandCarry,
          0,
          100,
        )
        log.push(entry('info', `${company.name} entrou em ${industry.name}.`, -action.investment))
        return
      }

      case 'venderDivisao': {
        const company = draft.companies[action.companyId]
        const industry = company ? findIndustry(company.industryId) : null
        if (!company || !industry || company.managedBy !== 'player') {
          log.push(entry('ruim', 'Você não dirige essa empresa.'))
          return
        }
        if (blocksLeft(state) < 1) {
          log.push(entry('ruim', 'Sem blocos de ação hoje.'))
          return
        }
        const fraction = clamp(action.fraction, 0, OPERATIONS.maxDivisionSale)
        if (fraction <= 0) {
          log.push(entry('ruim', 'Fração inválida.'))
          return
        }
        // Vender divisão é vender pedaço da operação pelo múltiplo do setor, não
        // pelo capital instalado: quem compra está comprando lucro futuro.
        const value =
          valuationOf(company, sectorMultiple(industry.multipleBase, draft.macro.selic)) * fraction
        player.blocksUsedToday += 1
        company.capitalStock *= 1 - fraction
        company.workforce.headcount = Math.max(
          1,
          Math.round(company.workforce.headcount * (1 - fraction)),
        )
        company.directives.headcountTarget = company.workforce.headcount
        company.capacity *= 1 - fraction
        company.cash += value
        log.push(
          entry('bom', `Você vendeu ${Math.round(fraction * 100)}% de ${company.name}.`, value),
        )
        return
      }

      case 'habilitarMargem': {
        if (action.collateral <= 0) {
          log.push(entry('ruim', 'Garantia inválida.'))
          return
        }
        if (availableCash(state) < action.collateral) {
          log.push(entry('ruim', 'Você não tem esse dinheiro para dar em garantia.'))
          return
        }
        debit(draft, action.collateral)
        draft.market.margin.enabled = true
        draft.market.margin.collateral += action.collateral
        log.push(entry('info', 'Conta margem habilitada.', -action.collateral))
        return
      }

      case 'venderDescoberto': {
        const company = draft.companies[action.companyId]
        const stock = company?.stock
        if (!company || !stock) {
          log.push(entry('ruim', 'Ativo indisponível.'))
          return
        }
        if (!draft.market.margin.enabled) {
          log.push(entry('ruim', 'Habilite a conta margem antes de vender a descoberto.'))
          return
        }
        if (action.shares <= 0) {
          log.push(entry('ruim', 'Quantidade inválida.'))
          return
        }
        // O que se pode dever é múltiplo da garantia, não do bolso: vender a
        // descoberto tem perda **ilimitada**, e é a garantia que responde.
        const value = action.shares * stock.price
        const limit = draft.market.margin.collateral * MARKET.marginLeverage
        if (draft.market.margin.borrowed + value > limit) {
          log.push(entry('ruim', 'Acima do limite da sua garantia.'))
          return
        }

        const position = draft.market.positions[action.companyId] ?? {
          companyId: action.companyId,
          shares: 0,
          avgPrice: 0,
          shortShares: 0,
        }
        if (!draft.market.positions[action.companyId]) {
          draft.market.positions[action.companyId] = position
          draft.market.positionOrder.push(action.companyId)
        }
        position.shortShares += action.shares
        draft.market.margin.borrowed += value
        player.money += value
        log.push(entry('info', `Vendido a descoberto: ${company.name}.`, value))
        return
      }

      case 'recomprarDescoberto': {
        const company = draft.companies[action.companyId]
        const stock = company?.stock
        const position = draft.market.positions[action.companyId]
        if (!company || !stock || !position || position.shortShares <= 0) {
          log.push(entry('ruim', 'Você não tem posição vendida nesse ativo.'))
          return
        }
        const shares = Math.min(action.shares, position.shortShares)
        if (shares <= 0) {
          log.push(entry('ruim', 'Quantidade inválida.'))
          return
        }
        const cost = shares * stock.price
        if (availableCash(state) < cost) {
          log.push(entry('ruim', 'Sem caixa para recomprar.'))
          return
        }
        debit(draft, cost)
        position.shortShares -= shares
        // A dívida cai proporcionalmente ao que foi coberto.
        draft.market.margin.borrowed = Math.max(0, draft.market.margin.borrowed - cost)
        log.push(entry('info', `Posição vendida coberta em ${company.name}.`, -cost))
        return
      }

      default:
        // Ações das fases seguintes; `avancarTempo` é roteada para runDays.
        log.push(entry('ruim', `Ação ainda não implementada: ${action.kind}.`))
    }
  })

  return { state: next, log }
}
