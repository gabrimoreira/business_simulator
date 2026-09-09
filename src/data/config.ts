/**
 * Constantes globais. Nenhum número de balanceamento vive na lógica (CLAUDE.md §5).
 * Os valores vêm de docs/GAME_DESIGN.md §3 — mudar aqui, não no código.
 *
 * Esta fase só declara o que é de fato consumido. As tabelas grandes (jobs,
 * courses, industries, companies.seed, ...) entram na fase que as usar.
 */

/** Versão do formato de save. Incrementar exige uma migration (§3.5). */
export const SAVE_VERSION = 3

// --- Tempo (GAME_DESIGN §3.1) ----------------------------------------------

/** 1 dia de jogo = 4 minutos reais. */
export const MS_PER_GAME_DAY = 240_000

/** Teto de progresso offline, em dias de jogo. */
export const OFFLINE_CAP_DAYS = 3

/** Blocos de ação por dia (spec §5.1). */
export const ACTION_BLOCKS_PER_DAY = 3

/** Saltos oferecidos pelo avanço rápido de tempo (GAME_DESIGN C1). */
export const FAST_FORWARD_STEPS = [7, 30] as const

export const START_AGE = 18
export const RETIREMENT_AGE = 65

/** Data inicial da partida. */
export const START_DAY = 1
export const START_MONTH = 1
export const START_YEAR = 2025

// --- Jogador inicial -------------------------------------------------------

export const INITIAL_PLAYER = {
  /**
   * Reserva inicial. O spec §1 diz "começa sem dinheiro", e R$ 400 é
   * praticamente isso — mas com zero absoluto o jogador não consegue comer no
   * primeiro dia e morre antes do primeiro salário. Medido no runner.
   */
  money: 600,
  energy: 100,
  health: 100,
  mood: 70,
  hunger: 80,
  skills: { intelligence: 10, charisma: 10, technical: 10, fitness: 10 },
  creditScore: 300,
  publicReputation: 0,
  notoriety: 0,
} as const

/**
 * Aluguel do quarto padrão (GAME_DESIGN §3.5). Quarto compartilhado, não quarto
 * inteiro: com 700 o orçamento do primeiro ano não fecha nem comendo marmita.
 */
export const DEFAULT_MONTHLY_RENT = 550

// --- Macro inicial (GAME_DESIGN §3.6) --------------------------------------

export const INITIAL_MACRO = {
  selic: 0.1075,
  inflation: 0.042,
  inflationTarget: 0.045,
  confidence: 60,
  marketIndex: 100,
  unemployment: 0.08,
} as const

/** Intervalo entre reuniões do banco central, em dias. */
export const CENTRAL_BANK_MEETING_DAYS = 45

// --- Janelas de histórico (spec §3.5) --------------------------------------

/** Dias de candle diário mantidos por ativo antes de agregar em semanal. */
export const PRICE_HISTORY_DAILY_DAYS = 365

/** Entradas de log mantidas no save. */
export const LOG_WINDOW_SIZE = 200

/** Manchetes mantidas no feed. */
export const HEADLINE_WINDOW_SIZE = 120

// --- Persistência ----------------------------------------------------------

/** Debounce do autosave, em ms (spec §3.5). */
export const AUTOSAVE_DEBOUNCE_MS = 500

// --- Vitais e decaimento (GAME_DESIGN §3.2) --------------------------------

export const VITALS = {
  max: 100,
  /** Fome cai 50/dia: uma refeição normal (+50) cobre exatamente um dia. */
  hungerDecayPerDay: 50,
  moodDecayPerDay: 3,
  /** Fome zerada drena saúde. */
  starvingHealthDrain: 3,
  /** Abaixo disso o sono não restaura direito. */
  lowHungerThreshold: 30,
  lowHungerSleepPenalty: 20,
  /** Base do sono automático na virada do dia (resolução C3). */
  sleepBase: 65,
  /** Humor baixo penaliza produtividade e decisão de gestão. */
  lowMoodThreshold: 30,
  lowMoodMultiplier: 0.75,
  veryLowMoodThreshold: 10,
  veryLowMoodMultiplier: 0.5,
  lowMoodHealthDrain: 0.5,
  /** Envelhecimento: saúde decai devagar a partir daqui. */
  agingStartsAtAge: 50,
  agingHealthDrainPerDay: 0.02,
  /** Contas atrasadas corroem humor e score todo dia. */
  overdueMoodDrainPerDay: 0.3,
  overdueScoreDrainPerDay: 1,
  /**
   * Recuperação natural de saúde de quem está alimentado e descansado. Sem ela
   * um único episódio de fome vira sentença de morte: nada mais no jogo devolve
   * saúde, e o runner morria no dia 49 por dívida acumulada de saúde.
   */
  healthRecoveryPerDay: 0.3,
  healthRecoveryMinHunger: 20,
  healthRecoveryMinEnergy: 30,
} as const

/** Custo e efeito de cada bloco de ação (GAME_DESIGN §3.2). */
export const ACTION_COSTS = {
  // Trabalhar desgasta o humor: sem isso o lazer diário vira fonte infinita de
  // humor e o sistema perde qualquer tensão.
  trabalhar: { blocks: 1, energy: 30, moodDelta: -1.5 },
  horaExtra: { blocks: 1, energy: 35, moodDelta: -4, payMultiplier: 1.6 },
  estudar: { blocks: 1, energy: 20, intelligenceGain: 0.02 },
  academia: { blocks: 1, energy: 25, fitnessGain: 0.4, healthGain: 0.3 },
  lazer: { blocks: 1, energy: 10, moodGain: 8 },
  socializar: { blocks: 1, energy: 15, charismaGain: 0.2, contacts: 1 },
} as const

// --- Carreira (GAME_DESIGN §3.3) -------------------------------------------

export const CAREER = {
  /** Dia do mês em que o salário cai. */
  paydayDay: 5,
  /** Dia do mês em que as contas são debitadas. */
  billsDay: 10,
  /**
   * Carência do primeiro mês. Quem começa aos 18 com R$ 600 e é contratado no
   * dia 3 só recebe no dia 5 do mês seguinte — cobrar aluguel no dia 10 do
   * primeiro mês abre um buraco do qual não se sai, e o runner morria por isso.
   */
  firstBillsGraceDays: 30,
  performanceGainPerWork: 0.35,
  performanceDecayPerIdleDay: 0.05,
  /** Trabalhar exausto rende menos desempenho. */
  lowEnergyThreshold: 40,
  lowEnergyPerformancePenalty: 0.5,
  minPerformanceForPromotion: 60,
  /** Chance de ser contratado: base + folga de skill + carisma + reputação. */
  hireBaseChance: 0.35,
  hireSkillMarginWeight: 0.01,
  hireCharismaWeight: 0.004,
  hireReputationWeight: 0.002,
  hireMaxChance: 0.95,
} as const

/** Auto-alimentação do avanço rápido: come quando a fome cai abaixo disto. */
export const AUTOPLAY_HUNGER_THRESHOLD = 50

/** E escolhe a refeição mais barata que leve a fome até aqui. */
export const AUTOPLAY_TARGET_HUNGER = 80

/** Teto de refeições por dia. */
export const MEALS_PER_DAY = 3

// --- Macroeconomia (GAME_DESIGN §3.6) --------------------------------------

export const MACRO = {
  /** Duração sorteada de cada fase, em dias. Ciclo completo de 2 a 7 anos. */
  cycleDurations: {
    expansao: [540, 1460],
    pico: [90, 270],
    recessao: [180, 540],
    recuperacao: [270, 730],
  },
  confidenceTarget: { expansao: 70, pico: 85, recessao: 30, recuperacao: 55 },
  /** Fator de demanda por fase — consumido pelas empresas a partir da Fase 5. */
  demandFactor: { expansao: 1.1, pico: 1.18, recessao: 0.8, recuperacao: 0.95 },
  unemploymentTarget: { expansao: 0.07, pico: 0.05, recessao: 0.14, recuperacao: 0.09 },
  outputGapTarget: { expansao: 0.01, pico: 0.03, recessao: -0.03, recuperacao: -0.01 },

  /** Velocidades de convergência por dia. */
  confidenceSpeed: 0.5,
  unemploymentSpeed: 0.0015,
  outputGapSpeed: 0.0006,

  /**
   * Inflação persegue um nível de equilíbrio: meta + pressão de demanda − juro
   * real. É o sinal negativo do juro real que impede a espiral.
   */
  inflationSpeed: 1 / 365,
  inflationPassthrough: 0.35,
  inflationSelicWeight: 0.25,
  inflationNoise: 0.0009,
  inflationMin: -0.02,
  inflationMax: 0.3,

  /** Regra de reação do banco central (Taylor simplificada). */
  neutralRealRate: 0.03,
  taylorInflationWeight: 1.5,
  taylorGapWeight: 0.8,
  /** Fração do gap fechada em cada reunião. */
  selicSmoothing: 0.25,
  selicMin: 0.02,
  selicMax: 0.3,

  /** Choque: pular a fase de pico e cair direto em recessão. */
  shockFromExpansionChance: 0.2,
  /** Recaída: voltar da recuperação para a recessão. */
  doubleDipChance: 0.12,
} as const

// --- Bancos (GAME_DESIGN §3.8) ---------------------------------------------

export const BANKING = {
  /** Penalidade de taxa por score baixo, somada ao spread do banco. */
  scoreRatePenaltyMax: 0.12,
  scoreRateReference: 650,
  /** Score. */
  scoreMin: 0,
  scoreMax: 1000,
  scoreCleanRecoveryPerDay: 0.3,
  /**
   * Teto da recuperação passiva. Acima disto o score só sobe com histórico de
   * crédito de verdade — quem nunca tomou nada emprestado não é cliente
   * preferencial de banco nenhum, e sem esse teto o score chegava a 1000 no
   * ano 8 sem o jogador nunca ter pego um empréstimo.
   */
  scoreCleanRecoveryCeiling: 700,
  scoreOnTimePaymentPerDay: 0.05,
  scoreLoanSettledBonus: 25,
  scoreLatePenalty: 60,
  scoreLateAfterDays: 30,
  scoreBankruptcyPenalty: 150,
  /** Alavancagem acima de 4× a renda mensal começa a custar score. */
  leverageFreeMultiple: 4,
  scoreLeveragePenaltyPerStep: 1,
  /** Dia do mês em que a fatura do cartão fecha. */
  cardStatementDay: 20,
} as const
