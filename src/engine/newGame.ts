/**
 * Construção do estado inicial. TypeScript puro.
 *
 * Nesta fase o mundo nasce vazio: nenhuma empresa, nenhum político, nenhum
 * veículo. Cada fase seguinte popula a sua parte a partir de `src/data/`.
 */
import type {
  GameDate,
  GameState,
  MacroState,
  Player,
  PublicView,
  StartArchetype,
} from './types'
import { createRng } from './rng'
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

export function createInitialState(options: NewGameOptions): GameState {
  const date = initialDate()
  const macro = initialMacro()
  const now = options.now ?? 0
  const startArchetype: StartArchetype = options.startArchetype ?? 'comum'

  return {
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
}

/** Blocos de ação ainda disponíveis hoje. */
export function blocksRemaining(state: GameState): number {
  return Math.max(0, ACTION_BLOCKS_PER_DAY - state.player.blocksUsedToday)
}
