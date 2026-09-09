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
import { annualizedProfit, capitalNeededFor } from '@/engine/companies'
import { jobEligibility } from '@/engine/player'
import { nominal } from '@/engine/macro'
import { fairValue } from '@/engine/market'
import { portfolioValue } from '@/engine/selectors'
import { monthlyIncome } from '@/engine/banking'

/** Reserva de sobrevivência antes de gastar com matrícula: ~2 meses de custo. */
const SURVIVAL_BUFFER = 3000

/** Capital com que a estratégia empreendedora abre a empresa. */
const FOUNDING_CAPITAL = 60_000

/**
 * Fator de folga sobre a folha do primeiro funcionário.
 *
 * Capital que produz exatamente o próprio salário quebra no primeiro tropeço:
 * a empresa precisa faturar o suficiente para pagar a folha **e** sobrar. Dois
 * é a folga mínima que sobreviveu à medição.
 */
const FOUNDING_PAYROLL_COVER = 2

/**
 * Capital de fundação, em R$ do ano 0, dimensionado pelo setor.
 *
 * O mínimo de R$ 60 mil serve para varejo e quebra em tecnologia, e a diferença
 * não é de grau: um funcionário de tecnologia custa R$ 280 mil de salário por
 * ano (R$ 800 mil × 35%) e produzir isso exige R$ 800 mil de capital, contra
 * R$ 42 mil de salário no varejo. A `tycoon` fundou com R$ 88 mil, foi a
 * −R$ 191 mil de caixa em dez meses e entrou em recuperação judicial — não por
 * má gestão, mas porque nasceu insolvente.
 *
 * `capitalNeededFor` é o mesmo helper que a engine usa para converter
 * capacidade em capital; a regra aqui é cobrir o dobro da folha inicial.
 */
function foundingCapitalFor(industryId: string): number {
  const industry = INDUSTRIES.find((item) => item.id === industryId)
  if (!industry) return FOUNDING_CAPITAL
  const payroll = industry.outputPerEmployee * industry.payrollRatio
  const needed = capitalNeededFor(payroll * FOUNDING_PAYROLL_COVER, industry)
  return Math.max(FOUNDING_CAPITAL, needed)
}

/** Teto de dívida da empresa, em fração da receita anual. Metade do que o motor permite. */
const COMPANY_LEVERAGE_CAP = 0.25

/**
 * Colchão de caixa da empresa, em anos de folha. Um mês.
 *
 * Três meses foi a primeira tentativa e freou demais: o `entrepreneur` caiu de
 * R$ 2,6 bi para R$ 379 M reais. O que de fato impediu a quebra não foi o
 * colchão e sim a trava de crédito no prejuízo, logo abaixo — o colchão só
 * precisa cobrir o descasamento entre a folha e o giro.
 */
const COMPANY_CASH_RESERVE = 1 / 12

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
  // Mesma rotina do `entrepreneur`. A antiga era `trabalhar + estudar +
  // socializar`, três blocos pesados sem descanso, que é o orçamento que a C3
  // diz não fechar: medida na `pricewar`, deu saúde média 4,8 e humor 0,2 em
  // dez anos, com o curso nunca terminando.
  //
  // O bloco tem de ser `estudar`, e não `socializar`: `decideActions` converte
  // um em outro quando não há curso pago, mas não o contrário. Com `socializar`
  // fixo aqui, a tycoon passou 47 anos sem um diploma — e fundar exige o plano
  // de cursos completo, então ela também nunca fundou.
  tycoon: {
    id: 'tycoon',
    routine: ['trabalhar', 'estudar', 'lazer'],
    coursePlan: ['oratoria', 'graduacao', 'mba'],
    applyEveryDays: 30,
    savesInBank: true,
    investsInStocks: true,
    // Varejo, e não tecnologia, por uma razão medida: capital por cabeça é de
    // R$ 117 mil no varejo contra R$ 800 mil em tecnologia — sete vezes. O
    // múltiplo maior da tecnologia (22 contra 12) não compensa a intensidade de
    // capital quando se começa do zero, e a empresa da `tycoon` em tecnologia
    // valia R$ 219 M aos 65 contra R$ 6,06 bi da de varejo. Um alocador de
    // capital não é fiel a um setor: vai onde o capital compõe.
    buildsCompany: 'varejo',
    // Sem crédito ela não funda, pelo mesmo motivo que o `pricewar` não fundava:
    // R$ 50 mil reais de capital mínimo é mais do que um assalariado acumula
    // antes de a inflação comer a poupança.
    leverageToFound: true,
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
 * Há dinheiro, somando caixa, aplicações livres e carteira, para o próximo
 * curso do plano?
 *
 * Olha o balanço inteiro porque é assim que a matrícula é paga (ver o resgate
 * abaixo): considerar só o caixa faria a rotina desistir de estudar no dia 6 de
 * cada mês, quando o salário acabou de ser aplicado.
 */
function affordsNextCourse(state: GameState, strategy: Strategy): boolean {
  const next = strategy.coursePlan.find((id) => !state.player.education.includes(id))
  const course = next ? COURSES.find((item) => item.id === next) : undefined
  if (!course) return false
  const savings = state.banking.accounts.reduce(
    (total, account) =>
      account.savingsLockedUntilDayIndex === null ||
      state.date.dayIndex >= account.savingsLockedUntilDayIndex
        ? total + account.savings
        : total,
    0,
  )
  const need = nominal(state.macro, course.cost + SURVIVAL_BUFFER)
  return state.player.money + savings + portfolioValue(state) >= need
}

/**
 * Ações fora dos blocos que a estratégia toma no dia: candidatar-se à melhor
 * vaga elegível e manter uma matrícula em curso.
 */
export function decideActions(state: GameState, strategy: Strategy): GameAction[] {
  const actions: GameAction[] = []
  const { player } = state

  // Bloco de estudo sem matrícula é bloco jogado fora: `estudar` sem curso ativo
  // é recusado, não gasta bloco e não rende nada. O `investor` queimou assim um
  // terço de cada dia por quarenta anos, porque a graduação não cabia no salário
  // de atendente e o plano de cursos travava ali. Enquanto não há o que estudar,
  // o bloco vai para `socializar` — que é de onde sai o carisma, e carisma é o
  // requisito de `encarregado`, `gerente` e `diretor`. Diploma quando dá para
  // pagar, relacionamento quando não dá.
  const desired = strategy.routine.map((block) =>
    block === 'estudar' && !player.activeCourse && !affordsNextCourse(state, strategy)
      ? ('socializar' as const)
      : block,
  )
  if (desired.some((block, index) => block !== player.routine[index])) {
    actions.push({ kind: 'definirRotina', routine: desired })
  }

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
        } else {
          // Nenhuma conta sozinha cobre a matrícula: junta o que há em todas e,
          // se ainda faltar, **vende ação**. Sem esta última perna o `investor`
          // ficava 25 anos de atendente com R$ 45 mil entre banco e carteira,
          // porque o excedente ia todo para a bolsa e a bolsa nunca voltava.
          // A carreira é o que multiplica o aporte por dez; deixá-la travada
          // para não desfazer posição é o pior negócio do jogo.
          let missing = needed
          for (const account of state.banking.accounts) {
            if (missing <= 0) break
            const free =
              account.savingsLockedUntilDayIndex === null ||
              state.date.dayIndex >= account.savingsLockedUntilDayIndex
                ? account.savings
                : 0
            if (free <= 0) continue
            const take = Math.min(free, missing)
            actions.push({ kind: 'resgatar', bankId: account.bankId, amount: take })
            missing -= take
          }
          // `positionOrder` e não `Object.keys`: ordem estável é o que mantém o
          // consumo de RNG determinístico (CLAUDE.md §2).
          for (const companyId of state.market.positionOrder) {
            if (missing <= 0) break
            const position = state.market.positions[companyId]
            const price = state.companies[companyId]?.stock?.price
            if (!position || !price || price <= 0) continue
            const shares = Math.min(position.shares, Math.ceil(missing / price))
            if (shares <= 0) continue
            actions.push({ kind: 'venderAcao', companyId, shares, limitPrice: null })
            missing -= shares * price
          }
        }
      }
    }
  }

  // Compra o papel mais descontado em relação ao valor justo, uma vez por mês.
  // É a versão mecânica do que o jogador faz olhando a lista da aba Mercado.
  const educated = strategy.coursePlan.every((id) => player.education.includes(id))

  /**
   * Diploma antes de empresa **até o ponto em que o diploma fica mais caro que
   * a empresa**.
   *
   * A regra original era esperar o plano de cursos inteiro, e por um bom motivo:
   * reservar capital de fundação desde o primeiro dia trava a matrícula, e sem
   * diploma o salário nunca sai do piso. Mas ela não distingue um curso técnico
   * de R$ 2.400 de um MBA de R$ 90 mil. A `tycoon` esperava o MBA — mais caro
   * que a empresa inteira — e fundava anos depois do `entrepreneur`; medida em
   * três seeds, terminava com 1,6× a 2,1× menos patrimônio, só por esse atraso.
   * Composição não perdoa espera.
   */
  const nextCourseId = strategy.coursePlan.find((id) => !player.education.includes(id))
  const nextCourse = nextCourseId ? COURSES.find((item) => item.id === nextCourseId) : undefined
  const readyToFound =
    educated ||
    (nextCourse !== undefined &&
      strategy.buildsCompany !== null &&
      nextCourse.cost > foundingCapitalFor(strategy.buildsCompany))

  const savingToFound =
    strategy.buildsCompany !== null &&
    readyToFound &&
    !state.companyOrder.some((id) => state.companies[id]?.managedBy === 'player')

  if (strategy.investsInStocks && state.date.dayIndex % 30 === 10) {
    // A reserva de fundação vale aqui também. O depósito bancário do dia 5 já a
    // respeitava, mas a compra de ação do dia 10 varria tudo acima do buffer de
    // sobrevivência — inclusive ela. O `entrepreneur` não investe em bolsa e
    // nunca bateu nisso; a `tycoon` fechou 47 anos com R$ 199 M em carteira e
    // **nenhuma empresa fundada**, que é o oposto do que a estratégia é.
    const buffer = savingToFound
      ? nominal(state.macro, SURVIVAL_BUFFER + foundingCapitalFor(strategy.buildsCompany ?? ''))
      : nominal(state.macro, SURVIVAL_BUFFER)
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
  if (strategy.savesInBank && state.date.dayIndex % 30 === 5) {
    // Quem está juntando para fundar guarda a reserva de fundação em caixa: o
    // depósito do dia 5 devolvia ao banco exatamente o resgate do dia 15, e a
    // empresa nunca saía. Só o que passa disso é aplicado.
    const buffer = savingToFound
      ? nominal(state.macro, SURVIVAL_BUFFER + foundingCapitalFor(strategy.buildsCompany ?? ''))
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
  if (strategy.buildsCompany && readyToFound && state.date.dayIndex % 30 === 15) {
    const mine = state.companyOrder
      .map((id) => state.companies[id])
      .find((company) => company?.managedBy === 'player')

    if (!mine) {
      const capital = nominal(state.macro, foundingCapitalFor(strategy.buildsCompany))
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
        // **Contratar antes de investir, e só investir no que falta.**
        //
        // `capacidade = min(mão de obra, capital × giro)`, então dinheiro posto
        // no lado que não é o gargalo não produz nada. A ordem antiga gastava
        // 70% do caixa em capital e só então tentava contratar: no varejo uma
        // contratação custa um mês de salário (R$ 3.500) e sobrava R$ 3.116.
        // A empresa passou quarenta anos com **um** funcionário, capacidade
        // travada em 287 mil e capital ocioso de 476 mil — 102 expansões
        // aceitas contra 97 contratações recusadas por falta de caixa.
        const productivity = mine.workforce.productivity / 100
        const perHead = industry.outputPerEmployee * productivity
        const labor = mine.workforce.headcount * perHead
        const capitalCapacity = mine.capitalStock * industry.capitalTurnover
        const salary = industry.outputPerEmployee * industry.payrollRatio * state.macro.priceLevel
        const hireCost = salary / 12

        // **A reserva é medida em folha, não em fração do caixa.** Guardar 20%
        // do caixa não quer dizer nada quando a folha é de R$ 540 milhões por
        // ano: a empresa cresceu 26 anos até R$ 2,3 bi de receita e 1.928
        // funcionários e então quebrou com −R$ 570 M de caixa, porque o
        // crescimento nunca esbarrava em nada. Três meses de folha é o colchão
        // que a recuperação judicial exige (três trimestres sem caixa).
        const payroll = mine.workforce.headcount * mine.workforce.avgSalary
        let budget = Math.max(0, mine.cash - payroll * COMPANY_CASH_RESERVE)

        // Crescer é comprar **pacotes**, não um lado só. Uma cabeça a mais só
        // produz se vier com o capital que a sustenta: no varejo, R$ 350 mil de
        // produção por pessoa a um giro de 3,0 exigem R$ 117 mil de capital
        // junto com o mês de salário adiantado. Comprar cabeça sem máquina, ou
        // máquina sem cabeça, é dinheiro que não vira capacidade — foi assim
        // que a empresa passou trinta anos com um funcionário e depois com
        // três.
        const capitalPerHead = perHead / industry.capitalTurnover
        const packageCost = hireCost + capitalPerHead

        // Capital que falta para a folha que já existe: gente ociosa por falta
        // de máquina é o pior dos dois desperdícios, então vem primeiro.
        const deficit = Math.max(0, (labor - capitalCapacity) / industry.capitalTurnover)

        // **Crescimento é financiado, não poupado.** Uma empresa de uma pessoa
        // no varejo gera ~R$ 7 mil de caixa livre por ano e um pacote de
        // crescimento custa ~R$ 100 mil: com lucro retido são catorze anos por
        // funcionário, e foi por isso que a empresa ficou plana por quarenta.
        // O crédito empresarial olha a receita (metade dela, menos a dívida),
        // que é justamente o que cresce junto com a capacidade — é a alavanca
        // que o §2.1 chama de freio do `entrepreneur`, e o runner nunca usava.
        // O motor deixa tomar até metade da receita. A estratégia para na
        // metade disso: tomar o teto todo mês, para sempre, não é financiar
        // crescimento — é montar uma torre de dívida. Medido: com o teto do
        // motor a empresa chegou a valer R$ 13,6 bi e o dono a ter R$ 18 M,
        // porque a dívida tinha comido o patrimônio inteiro.
        // Não se toma crédito para crescer empresa que dá prejuízo — é assim que
        // se troca uma empresa pequena e sã por uma grande e insolvente.
        const creditRoom =
          annualizedProfit(mine) > 0
            ? Math.max(0, mine.revenue * COMPANY_LEVERAGE_CAP - mine.debt)
            : 0
        const missing = Math.max(0, deficit + packageCost - budget)
        const borrow = Math.min(creditRoom, Math.max(0, missing))
        if (borrow > nominal(state.macro, 2000)) {
          const lender = [...BANKS]
            .filter((item) => player.creditScore >= item.minScore)
            .sort((a, b) => a.spread - b.spread)[0]
          if (lender) {
            actions.push({
              kind: 'emprestimoEmpresarial',
              companyId: mine.id,
              bankId: lender.id,
              amount: borrow,
              termDays: FOUNDING_LOAN_TERM_DAYS,
            })
            budget += borrow
          }
        }

        const packages =
          packageCost > 0 ? Math.floor(Math.max(0, budget - deficit) / packageCost) : 0
        const capex = deficit + packages * capitalPerHead

        // Uma única chamada de expansão: cada ação de gestão custa um bloco, e
        // o dia tem três (resolução C2).
        if (capex > nominal(state.macro, 2000)) {
          actions.push({ kind: 'expandirCapacidade', companyId: mine.id, investment: capex })
        }
        if (packages > 0) {
          actions.push({ kind: 'contratar', companyId: mine.id, count: packages, salary })
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

      }
    }
  }

  return actions
}
