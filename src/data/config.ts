/**
 * Constantes globais. Nenhum número de balanceamento vive na lógica (CLAUDE.md §5).
 * Os valores vêm de docs/GAME_DESIGN.md §3 — mudar aqui, não no código.
 *
 * Esta fase só declara o que é de fato consumido. As tabelas grandes (jobs,
 * courses, industries, companies.seed, ...) entram na fase que as usar.
 */

/** Versão do formato de save. Incrementar exige uma migration (§3.5). */
export const SAVE_VERSION = 1

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
  money: 0,
  energy: 100,
  health: 100,
  mood: 70,
  hunger: 80,
  skills: { intelligence: 10, charisma: 10, technical: 10, fitness: 10 },
  creditScore: 300,
  publicReputation: 0,
  notoriety: 0,
} as const

/** Aluguel do quarto padrão, em BRL do ano 0 (GAME_DESIGN §3.5). */
export const DEFAULT_MONTHLY_RENT = 700

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
