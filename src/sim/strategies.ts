/**
 * Estratégias do runner headless (spec §7). Vivem fora de `src/engine/` porque
 * são política de jogador, não regra de mundo — mas usam exatamente as mesmas
 * ações que a UI dispara.
 */
import type { ActionBlockKind, GameAction, GameState } from '@/engine/types'
import { JOBS } from '@/data/jobs'
import { COURSES } from '@/data/courses'
import { BANKS } from '@/data/banks'
import { INDUSTRIES } from '@/data/industries'
import { jobEligibility } from '@/engine/player'
import { nominal } from '@/engine/macro'
import { fairValue } from '@/engine/market'
import { monthlyIncome } from '@/engine/banking'

/** Reserva de sobrevivência antes de gastar com matrícula: ~2 meses de custo. */
const SURVIVAL_BUFFER = 3000

/** Capital com que a estratégia empreendedora abre a empresa. */
const FOUNDING_CAPITAL = 60_000

/** Dez anos: a parcela precisa caber no salário de quem ainda não fundou. */
const FOUNDING_LOAN_TERM_DAYS = 3650

export const STRATEGY_IDS = [
  'passive',
  'investor',
  'entrepreneur',
  'tycoon',
  'pricewar',
  'raider',
] as const
export type StrategyId = (typeof STRATEGY_IDS)[number]

export interface Strategy {
  id: StrategyId
  routine: ActionBlockKind[]
  /** Cursos que a estratégia persegue, em ordem. */
  coursePlan: string[]
  /** Intervalo entre tentativas de vaga, para não torrar o RNG todo dia. */
  applyEveryDays: number
  /** Aplica o excedente acima da reserva no banco de melhor rendimento. */
  savesInBank: boolean
  /** Compra ações do papel mais descontado em relação ao valor justo. */
  investsInStocks: boolean
  /** Funda empresa quando junta capital, e reinveste o lucro dela. */
  buildsCompany: string | null
  /**
   * Completa o capital de fundação com crédito quando o salário não chega lá.
   * Sem isto, quem começa como atendente **nunca** funda: R$ 60 mil reais é
   * mais do que um cargo de entrada acumula antes da inflação comer a poupança.
   */
  leverageToFound: boolean
  /**
   * Preço praticado como fração do preço médio do setor. `null` deixa o preço
   * onde a fundação o pôs. É o que separa o `pricewar` do `entrepreneur`:
   * mesma empresa, margem sacrificada por participação.
   */
  undercut: number | null
}

const STRATEGIES: Record<StrategyId, Strategy> = {
  // "Só trabalha": sem estudar, a carreira trava no cargo 2 — é o que sustenta o
  // alvo de patrimônio do GAME_DESIGN §2.1.
  passive: {
    id: 'passive',
    // Um turno de trabalho por dia: o salário é mensal, então dobrar a jornada
    // não paga nada além de desempenho. O terceiro bloco vai para socializar,
    // que é o único caminho de carisma de quem não estuda — e sem carisma 30 a
    // carreira trava no cargo de entrada, não no cargo 2 previsto no §2.2.
    routine: ['trabalhar', 'socializar', 'lazer'],
    coursePlan: [],
    applyEveryDays: 30,
    // "Só trabalha" também guarda o que sobra: deixar dinheiro parado embaixo do
    // colchão não é uma estratégia, é um bug de comportamento.
    savesInBank: true,
    investsInStocks: false,
    buildsCompany: null,
    leverageToFound: false,
    undercut: null,
  },
  investor: {
    id: 'investor',
    routine: ['trabalhar', 'lazer', 'estudar'],
    coursePlan: ['tecnico', 'graduacao', 'pos', 'mba'],
    applyEveryDays: 30,
    savesInBank: true,
    investsInStocks: true,
    buildsCompany: null,
    leverageToFound: false,
    undercut: null,
  },
  // As três abaixo ainda se comportam como `investor`; ganham corpo nas fases
  // 3, 5 e 6.
  entrepreneur: {
    id: 'entrepreneur',
    // Lazer no meio pelo mesmo motivo do `passive`: dois blocos pesados por dia
    // já esgotam a energia, e deixar o descanso por último derruba o humor.
    routine: ['trabalhar', 'lazer', 'estudar'],
    coursePlan: ['tecnico', 'graduacao'],
    applyEveryDays: 30,
    savesInBank: true,
    investsInStocks: false,
    buildsCompany: 'varejo',
    leverageToFound: false,
    undercut: null,
  },
  tycoon: {
    id: 'tycoon',
    routine: ['trabalhar', 'estudar', 'socializar'],
    coursePlan: ['oratoria', 'graduacao', 'mba'],
    applyEveryDays: 30,
    savesInBank: true,
    investsInStocks: true,
    buildsCompany: 'tecnologia',
    leverageToFound: false,
    undercut: null,
  },
  // Funda no mesmo setor do `entrepreneur` e vende 15% abaixo da média. Existe
  // para que o checklist de fim de fase tenha uma corrida que **compete** — com
  // `buildsCompany: null` ela era `passive` com a rotina embaralhada e as duas
  // fechavam dez anos no mesmo centavo, medindo a mesma vida duas vezes.
  pricewar: {
    id: 'pricewar',
    // Rotina do `passive`, e por dois motivos medidos. Carisma no lugar de
    // diploma porque atendente não levanta capital de fundação nem com crédito.
    // E lazer no terceiro bloco porque trabalhar+socializar+estudar é o
    // orçamento que a C3 diz não fechar: a medição deu saúde média 4,8 e humor
    // 0,2 em dez anos, com o curso nunca terminando.
    routine: ['trabalhar', 'socializar', 'lazer'],
    coursePlan: [],
    applyEveryDays: 30,
    savesInBank: true,
    investsInStocks: false,
    buildsCompany: 'varejo',
    leverageToFound: true,
    undercut: 0.85,
  },
  raider: {
    id: 'raider',
    routine: ['trabalhar', 'estudar', 'lazer'],
    coursePlan: ['financas', 'graduacao'],
    applyEveryDays: 30,
    savesInBank: true,
    investsInStocks: true,
    buildsCompany: null,
    leverageToFound: false,
    undercut: null,
  },
}

export function getStrategy(id: StrategyId): Strategy {
  return STRATEGIES[id]
}

/**
 * Ações fora dos blocos que a estratégia toma no dia: candidatar-se à melhor
 * vaga elegível e manter uma matrícula em curso.
 */
export function decideActions(state: GameState, strategy: Strategy): GameAction[] {
  const actions: GameAction[] = []
  const { player } = state

  // Desempregado procura todo dia; empregado tenta promoção na cadência. Sem
  // isso o jogador passa o primeiro mês sem renda e morre de fome.
  const searching =
    !player.currentJobId || state.date.dayIndex % strategy.applyEveryDays === 0
  if (searching) {
    const currentLevel = player.currentJobId
      ? (JOBS.find((job) => job.id === player.currentJobId)?.level ?? -1)
      : -1
    const best = JOBS.filter((job) => job.level > currentLevel)
      .filter((job) => jobEligibility(state, job.id).ok)
      .sort((a, b) => b.salary - a.salary)[0]
    if (best) actions.push({ kind: 'candidatar', jobId: best.id })
  }

  if (!player.activeCourse) {
    const next = strategy.coursePlan.find((id) => !player.education.includes(id))
    const course = next ? COURSES.find((item) => item.id === next) : undefined
    // Matricular gastando o último centavo mata de fome antes do primeiro
    // diploma: guarda uns meses de custo de vida antes de pagar a matrícula.
    const cost = course ? nominal(state.macro, course.cost) : 0
    const buffer = nominal(state.macro, SURVIVAL_BUFFER)
    if (course) {
      if (player.money >= cost + buffer) {
        actions.push({ kind: 'matricular', courseId: course.id })
      } else {
        // O dinheiro está aplicado: resgata o que falta antes de se matricular.
        // Sem isto a estratégia guardava tudo no banco e nunca estudava — foi o
        // que fez o `investor` terminar 47 anos sem um único diploma.
        const needed = cost + buffer - player.money
        const liquid = state.banking.accounts.find(
          (account) =>
            account.savings >= needed &&
            (account.savingsLockedUntilDayIndex === null ||
              state.date.dayIndex >= account.savingsLockedUntilDayIndex),
        )
        if (liquid) {
          actions.push({ kind: 'resgatar', bankId: liquid.bankId, amount: needed })
        }
      }
    }
  }

  // Compra o papel mais descontado em relação ao valor justo, uma vez por mês.
  // É a versão mecânica do que o jogador faz olhando a lista da aba Mercado.
  if (strategy.investsInStocks && state.date.dayIndex % 30 === 10) {
    const buffer = nominal(state.macro, SURVIVAL_BUFFER)
    const surplus = player.money - buffer
    if (surplus > 0) {
      const ranked = state.companyOrder
        .flatMap((id) => {
          const company = state.companies[id]
          const stock = company?.stock
          if (!company || !stock || company.status !== 'ativa') return []
          const fair = fairValue(state, company)
          if (fair <= 0) return []
          return [{ id, price: stock.price, ratio: stock.price / fair, stock }]
        })
        .sort((a, b) => a.ratio - b.ratio)
        .slice(0, 3)

      // Divide entre os três mais descontados e respeita um teto de 20% do
      // volume diário: despejar o excedente inteiro num papel só paga
      // deslizamento de dois dígitos e concentra risco à toa.
      const perName = surplus / Math.max(1, ranked.length)
      for (const candidate of ranked) {
        const byMoney = Math.floor(perName / candidate.price)
        const byVolume = Math.floor(candidate.stock.sharesOutstanding * 0.0008)
        const shares = Math.min(byMoney, byVolume)
        if (shares > 0) {
          actions.push({ kind: 'comprarAcao', companyId: candidate.id, shares, limitPrice: null })
        }
      }
    }
  }

  // Aplica o excedente que sobrar. Escolhe o melhor rendimento entre os bancos
  // em que o score dá acesso — é a decisão que o jogador toma na aba Mundo.
  // Quem está juntando para fundar não deposita: o depósito do dia 5 devolvia
  // ao banco exatamente o resgate feito no dia 15, e a empresa nunca saía.
  // Diploma antes de empresa: reservar capital de fundação desde o primeiro dia
  // trava a matrícula, e sem o diploma o salário nunca sai do piso — o
  // empreendedor ficava 47 anos de atendente juntando um capital que a inflação
  // corroía.
  const educated = strategy.coursePlan.every((id) => player.education.includes(id))
  const savingToFound =
    strategy.buildsCompany !== null &&
    educated &&
    !state.companyOrder.some((id) => state.companies[id]?.managedBy === 'player')

  if (strategy.savesInBank && state.date.dayIndex % 30 === 5) {
    // Quem está juntando para fundar guarda a reserva de fundação em caixa: o
    // depósito do dia 5 devolvia ao banco exatamente o resgate do dia 15, e a
    // empresa nunca saía. Só o que passa disso é aplicado.
    const buffer = savingToFound
      ? nominal(state.macro, SURVIVAL_BUFFER + FOUNDING_CAPITAL)
      : nominal(state.macro, SURVIVAL_BUFFER)
    const surplus = player.money - buffer
    if (surplus > 0) {
      const bank = [...BANKS]
        .filter((item) => player.creditScore >= item.minScore)
        // Carência prende o dinheiro: só vale a pena com folga de caixa.
        .filter((item) => item.lockDays === 0 || surplus > buffer)
        .sort((a, b) => b.savingsFactor - a.savingsFactor)[0]
      if (bank) actions.push({ kind: 'aplicar', bankId: bank.id, amount: surplus })
    }
  }

  // Empreender: junta capital, funda, e depois reinveste o caixa da empresa em
  // máquina e gente na proporção que o giro do setor exige. Contratar além do
  // que o capital sustenta só engorda a folha.
  if (strategy.buildsCompany && educated && state.date.dayIndex % 30 === 15) {
    const mine = state.companyOrder
      .map((id) => state.companies[id])
      .find((company) => company?.managedBy === 'player')

    if (!mine) {
      const capital = nominal(state.macro, FOUNDING_CAPITAL)
      const needed = capital + nominal(state.macro, SURVIVAL_BUFFER)
      if (player.money >= needed) {
        actions.push({
          kind: 'fundarEmpresa',
          name: 'Empreendimento',
          industryId: strategy.buildsCompany,
          capital,
        })
      } else {
        // O capital está aplicado. Resgatar antes de fundar é o mesmo cuidado
        // que a matrícula exige: guardar tudo no banco e nunca sacar significa
        // nunca empreender.
        const gap = needed - player.money
        const liquid = state.banking.accounts.find(
          (account) =>
            account.savings >= gap &&
            (account.savingsLockedUntilDayIndex === null ||
              state.date.dayIndex >= account.savingsLockedUntilDayIndex),
        )
        if (liquid) {
          actions.push({ kind: 'resgatar', bankId: liquid.bankId, amount: gap })
        } else if (strategy.leverageToFound && state.banking.loans.every((loan) => loan.borrower !== 'player')) {
          // Resgata tudo o que houver e completa com crédito. Prazo longo de
          // propósito: a parcela precisa caber num salário de cargo de entrada,
          // que é justamente quem depende do empréstimo para começar.
          const savings = state.banking.accounts.reduce(
            (total, account) =>
              account.savingsLockedUntilDayIndex === null ||
              state.date.dayIndex >= account.savingsLockedUntilDayIndex
                ? total + account.savings
                : total,
            0,
          )
          const missing = gap - savings
          const bank = [...BANKS]
            .filter((item) => player.creditScore >= item.minScore)
            .sort((a, b) => b.incomeMultiple - a.incomeMultiple)[0]
          if (bank && missing > 0 && missing <= monthlyIncome(state) * bank.incomeMultiple) {
            for (const account of state.banking.accounts) {
              if (account.savings > 0) {
                actions.push({
                  kind: 'resgatar',
                  bankId: account.bankId,
                  amount: account.savings,
                })
              }
            }
            actions.push({
              kind: 'tomarEmprestimo',
              bankId: bank.id,
              loanKind: 'pessoal',
              amount: missing,
              termDays: FOUNDING_LOAN_TERM_DAYS,
            })
          }
        }
      }
    } else if (mine.status === 'ativa' && mine.cash > 0) {
      const industry = INDUSTRIES.find((item) => item.id === mine.industryId)
      if (industry) {
        const investment = mine.cash * 0.7
        if (investment > nominal(state.macro, 2000)) {
          actions.push({ kind: 'expandirCapacidade', companyId: mine.id, investment })
        }
        // Guerra de preço: reprecifica contra a média do setor todo mês. Ler
        // `averagePrice` é o mesmo que o jogador faz olhando a aba do setor —
        // não é informação privilegiada.
        if (strategy.undercut !== null) {
          const sector = state.industries[mine.industryId]
          if (sector) {
            const target = sector.averagePrice * strategy.undercut
            if (target > 0 && Math.abs(target - mine.price) / mine.price > 0.02) {
              actions.push({ kind: 'ajustarPreco', companyId: mine.id, price: target })
            }
          }
        }

        const supported = (mine.capitalStock * industry.capitalTurnover) / industry.outputPerEmployee
        const hires = Math.floor(supported - mine.workforce.headcount)
        if (hires > 0) {
          actions.push({
            kind: 'contratar',
            companyId: mine.id,
            count: hires,
            salary: industry.outputPerEmployee * industry.payrollRatio * state.macro.priceLevel,
          })
        }
      }
    }
  }

  return actions
}
