/**
 * Construção do estado inicial. TypeScript puro.
 *
 * Nesta fase o mundo nasce vazio: nenhuma empresa, nenhum político, nenhum
 * veículo. Cada fase seguinte popula a sua parte a partir de `src/data/`.
 */
import type {
  Company,
  GameDate,
  GameState,
  IndustryState,
  MacroState,
  Player,
  PublicView,
  StartArchetype,
} from './types'
import { createRng, range } from './rng'
import { INDUSTRIES } from '../data/industries'
import { COMPANY_SEEDS } from '../data/companies.seed'
import { NEWS_OUTLETS } from '../data/newsOutlets'
import { COMPANY_OPS } from '../data/config'
import { fairValue } from './market'
import {
  ACTION_BLOCKS_PER_DAY,
  DEFAULT_MONTHLY_RENT,
  INITIAL_MACRO,
  INITIAL_PLAYER,
  SAVE_VERSION,
  START_AGE,
  START_DAY,
  START_MONTH,
  START_YEAR,
  CENTRAL_BANK_MEETING_DAYS,
} from '../data/config'

function initialDate(): GameDate {
  return { dayIndex: 0, day: START_DAY, month: START_MONTH, year: START_YEAR }
}

function initialPlayer(name: string): Player {
  return {
    name,
    age: START_AGE,
    money: INITIAL_PLAYER.money,
    energy: INITIAL_PLAYER.energy,
    health: INITIAL_PLAYER.health,
    mood: INITIAL_PLAYER.mood,
    hunger: INITIAL_PLAYER.hunger,
    skills: { ...INITIAL_PLAYER.skills },
    education: [],
    activeCourse: null,
    currentJobId: null,
    career: { jobId: null, daysInJob: 0, performance: 50, salary: 0, daysSinceLastRaise: 0 },
    creditScore: INITIAL_PLAYER.creditScore,
    publicReputation: INITIAL_PLAYER.publicReputation,
    notoriety: INITIAL_PLAYER.notoriety,
    blocksUsedToday: 0,
    mealsToday: 0,
    routine: ['trabalhar', 'lazer', 'trabalhar'],
    contacts: 0,
    overdueBills: 0,
    office: null,
    incarceratedDays: 0,
  }
}

function initialMacro(): MacroState {
  return {
    cyclePhase: 'expansao',
    cycleDayCounter: 0,
    cycleTargetDays: 0,
    selic: INITIAL_MACRO.selic,
    inflation: INITIAL_MACRO.inflation,
    inflationTarget: INITIAL_MACRO.inflationTarget,
    confidence: INITIAL_MACRO.confidence,
    marketIndex: INITIAL_MACRO.marketIndex,
    marketIndexHistory: [],
    unemployment: INITIAL_MACRO.unemployment,
    outputGap: 0,
    nextMeetingDayIndex: CENTRAL_BANK_MEETING_DAYS,
    priceLevel: 1,
  }
}

function initialPublicView(date: GameDate, macro: MacroState): PublicView {
  return {
    date,
    macro: {
      asOfDayIndex: date.dayIndex,
      selic: macro.selic,
      inflation: macro.inflation,
      confidence: macro.confidence,
      marketIndex: macro.marketIndex,
      unemployment: macro.unemployment,
      cyclePhase: null,
    },
    stocks: {},
    companies: {},
    companyOrder: [],
    headlines: [],
    disclosures: [],
    industryAveragePrice: {},
  }
}

export interface NewGameOptions {
  seed: number
  playerName: string
  startArchetype?: StartArchetype
  /** Epoch ms fornecido pela UI — a engine não lê o relógio (GAME_DESIGN C7). */
  now?: number
}

/**
 * Monta as 28 empresas listadas e os 7 setores. O preço de abertura **vem dos
 * fundamentos** — lucro anualizado × múltiplo do setor ÷ ações — com uma
 * dispersão de ±10% para que o mercado já nasça com papel caro e papel barato.
 * Nenhuma ação começa descolada do que a empresa ganha.
 *
 * Exportado porque a migration que traz saves anteriores à Fase 3 precisa
 * povoar o mundo pelo mesmo caminho.
 */
export function seedWorld(state: GameState): void {
  const industries: Record<string, IndustryState> = {}
  const industryOrder: string[] = []

  for (const industry of INDUSTRIES) {
    industries[industry.id] = {
      industryId: industry.id,
      marketSize: industry.marketSize,
      averagePrice: 1,
      taxRate: industry.taxRate,
      subsidyRatio: 0,
      importTariff: 0,
      companyOrder: [],
    }
    industryOrder.push(industry.id)
  }

  const companies: Record<string, Company> = {}
  const companyOrder: string[] = []

  for (const seed of COMPANY_SEEDS) {
    const industry = INDUSTRIES.find((item) => item.id === seed.industryId)
    if (!industry) continue

    const debt = seed.revenue * seed.debtRatio
    const operating = seed.revenue * seed.margin
    const interest = debt * (state.macro.selic + COMPANY_OPS.debtSpread)
    const pretax = operating - interest
    const annualProfit = pretax > 0 ? pretax * (1 - industry.taxRate) : pretax
    const quarter = annualProfit / 4

    const floatShares = Math.round(seed.sharesOutstanding * seed.floatPct)

    const company: Company = {
      id: seed.id,
      name: seed.name,
      industryId: seed.industryId,
      isPublic: true,
      founded: { dayIndex: 0, day: 1, month: 1, year: state.date.year - 20 },
      cash: seed.revenue * seed.cashRatio,
      debt,
      revenue: seed.revenue,
      costs: seed.revenue - operating + interest,
      lastQuarterProfit: 0,
      // Quatro trimestres fechados para que o valor justo exista no dia 1.
      profitHistory: [quarter, quarter, quarter, quarter],
      employees: [],
      productQuality: 50,
      brandAwareness: 50,
      rndLevel: 1,
      rndProgress: 0,
      price: 1,
      marketingSpend: 0,
      ownership: [
        { holderId: 'float', shares: floatShares },
        { holderId: `bloco-${seed.id}`, shares: seed.sharesOutstanding - floatShares },
      ],
      stock: {
        companyId: seed.id,
        // Substituído logo abaixo pelo valor justo; nasce em 1 só para o objeto
        // ficar completo antes de `fairValue` ler os fundamentos dele.
        price: 1,
        sharesOutstanding: seed.sharesOutstanding,
        beta: seed.beta,
        volatility: industry.volatility,
        dividendYieldTarget: seed.dividendYieldTarget,
        history: [],
        weeklyCount: 0,
        volumeToday: 0,
        eventShockToday: 0,
      },
      reputation: seed.reputation,
      directives: {
        price: 1,
        marketingRatio: 0.03,
        rndRatio: 0.02,
        headcountTarget: 0,
        payoutRatio: 0.3,
        cashReserveTarget: 0.15,
        minMargin: 0.03,
      },
      capacity: seed.revenue,
      baseMargin: seed.margin,
      marketShare: 0,
      status: 'ativa',
      quartersNegativeCash: 0,
      quartersInRj: 0,
      managedBy: 'ai',
      quartersReported: 4,
    }

    // O preço de abertura **é** o valor justo, com ±10% de dispersão: nenhuma
    // ação nasce descolada do que a empresa ganha, mas o mercado já começa com
    // papel caro e papel barato.
    company.stock!.price = Math.max(0.5, fairValue(state, company)) * range(state.rng, 0.9, 1.1)

    companies[seed.id] = company
    companyOrder.push(seed.id)
    industries[seed.industryId]?.companyOrder.push(seed.id)
  }

  // Participação de mercado inicial, por receita dentro do setor.
  for (const industryId of industryOrder) {
    const ids = industries[industryId]?.companyOrder ?? []
    const total = ids.reduce((sum, id) => sum + (companies[id]?.revenue ?? 0), 0)
    for (const id of ids) {
      const company = companies[id]
      if (company && total > 0) company.marketShare = company.revenue / total
    }
  }

  const outlets: GameState['news']['outlets'] = {}
  const outletOrder: string[] = []
  for (const definition of NEWS_OUTLETS) {
    outlets[definition.id] = {
      id: definition.id,
      name: definition.name,
      credibility: definition.credibility,
      bias: { ...definition.bias },
      reach: definition.reach,
      ownerId: null,
      publishLagDays: definition.publishLagDays,
      rumorAccuracy: definition.rumorAccuracy,
      companyId: definition.companyId,
    }
    outletOrder.push(definition.id)
  }
  state.news.outlets = outlets
  state.news.outletOrder = outletOrder

  state.industries = industries
  state.industryOrder = industryOrder
  state.companies = companies
  state.companyOrder = companyOrder
  state.macro.marketIndex = MARKET_INDEX_BASE
}

/** Base do índice: 100 pontos no primeiro dia, como qualquer índice do mundo. */
const MARKET_INDEX_BASE = 100

export function createInitialState(options: NewGameOptions): GameState {
  const date = initialDate()
  const macro = initialMacro()
  const now = options.now ?? 0
  const startArchetype: StartArchetype = options.startArchetype ?? 'comum'

  const state: GameState = {
    saveVersion: SAVE_VERSION,
    createdAt: now,
    lastTickAt: now,
    rng: createRng(options.seed),
    date,
    player: initialPlayer(options.playerName),
    macro,
    companies: {},
    companyOrder: [],
    industries: {},
    industryOrder: [],
    market: {
      positions: {},
      positionOrder: [],
      orders: [],
      realizedPnlMonth: 0,
      salesVolumeMonth: 0,
      realizedPnlTotal: 0,
      dividendsReceivedTotal: 0,
      taxDebts: [],
      margin: { enabled: false, collateral: 0, borrowed: 0, maintenanceRatio: 0.3 },
      subscriptions: [],
    },
    banking: {
      accounts: [],
      loans: [],
      cards: [],
      paymentsOnTime: 0,
      paymentsLate: 0,
      bankruptcies: 0,
    },
    news: { outlets: {}, outletOrder: [], headlines: [], editorialOrders: [], lastReadDayIndex: 0 },
    politics: {
      politicians: {},
      politicianOrder: [],
      policies: {},
      policyOrder: [],
      elections: [],
      donations: [],
      lobbyEfforts: [],
      investigations: [],
      antitrustCases: [],
      activeDeltas: {},
    },
    events: { pending: [], active: [], lastFiredDayIndex: {} },
    ai: {
      profiles: {} as GameState['ai']['profiles'],
      agents: {},
      agentOrder: [],
      tycoons: {},
      tycoonOrder: [],
      institutional: {},
      funds: {},
      fundOrder: [],
      defenses: [],
    },
    publicView: initialPublicView(date, macro),
    personalAssets: { assets: [], residenceId: null, monthlyRent: DEFAULT_MONTHLY_RENT },
    ownershipDisclosures: [],
    tenders: [],
    ipos: [],
    mergers: [],
    log: [],
    flags: {},
    meta: {
      saveVersion: SAVE_VERSION,
      startArchetype,
      unlockedArchetypes: ['comum'],
      ranking: [],
      ending: null,
      companiesFoundedCount: 0,
      officesHeld: [],
    },
  }

  seedWorld(state)
  return state
}

/** Blocos de ação ainda disponíveis hoje. */
export function blocksRemaining(state: GameState): number {
  return Math.max(0, ACTION_BLOCKS_PER_DAY - state.player.blocksUsedToday)
}
