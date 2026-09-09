/**
 * Constantes globais. Nenhum número de balanceamento vive na lógica (CLAUDE.md §5).
 * Os valores vêm de docs/GAME_DESIGN.md §3 — mudar aqui, não no código.
 *
 * Esta fase só declara o que é de fato consumido. As tabelas grandes (jobs,
 * courses, industries, companies.seed, ...) entram na fase que as usar.
 */

/** Versão do formato de save. Incrementar exige uma migration (§3.5). */
export const SAVE_VERSION = 11

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
  // `charismaGain` é o ganho **na base zero**; o rendimento cai com o quadrado
  // da folga que ainda resta (ver `SKILL_CURVE`). Linear, este 0,2 levava
  // carisma de 10 a 100 em pouco mais de um ano de blocos — e carisma é o
  // requisito de `encarregado`, `gerente`, `diretor` e `c-level`. Um bloco
  // repetido comprava a diretoria inteira enquanto inteligência custava
  // R$ 136 mil de mensalidade e 2.540 dias de estudo.
  socializar: { blocks: 1, energy: 15, charismaGain: 0.2, contacts: 1 },
} as const

/**
 * Rendimento decrescente das skills treinadas por bloco repetido.
 *
 * `ganho = base × (1 − skill/100)^expoente`. Com expoente 2, sair de 10 e
 * chegar a 30 leva ~5 meses (o portão de `encarregado` continua barato), a 60
 * leva ~2 anos, a 85 leva ~7,6 anos e 100 é inalcançável na prática.
 *
 * É o formato certo para a coisa que modela: ficar sociável é fácil, ficar
 * magnético é obra de uma vida. E impede que a escada executiva inteira seja
 * comprada com um bloco repetido.
 */
export const SKILL_CURVE = { exponent: 2 } as const

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

/**
 * Dias de comida que o saque automático cobre de uma vez.
 *
 * Sacar todo dia enche o log de trinta linhas por mês; sacar um mês de uma vez
 * é o que uma pessoa faz. Ver `autoEat` em `engine/autoplay.ts`.
 */
export const AUTOPLAY_TOPUP_DAYS = 30

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

// --- Bolsa (GAME_DESIGN §3.7) ----------------------------------------------

export const MARKET = {
  /** Selic de referência do múltiplo setorial. */
  selicReference: 0.1,
  /** Piso da Selic no cálculo do múltiplo: evita múltiplo explodindo a juro zero. */
  selicFloorForMultiple: 0.04,
  multipleExponent: 0.6,
  multipleFloorRatio: 0.35,
  multipleCeilingRatio: 2.2,

  /** Reversão à média: fração do desvio do valor justo corrigida por dia. */
  meanReversionRate: 0.06,
  /** Desvio máximo considerado no drift, para não haver salto. */
  driftClamp: 0.05,

  /** Deriva anual do índice por fase do ciclo. */
  indexPhaseDrift: { expansao: 0.12, pico: 0.04, recessao: -0.25, recuperacao: 0.18 },
  /** Volatilidade diária do fator de mercado. */
  indexVolatility: 0.009,
  /** Choque no índice por ponto percentual de mudança da Selic. */
  selicShock: 4,
  /** Efeito da variação diária de confiança no índice. */
  confidenceEffect: 0.002,

  /** Teto do choque de evento/notícia por ativo por dia (Fase 4). */
  eventShockCap: 0.12,

  /** Volume diário negociável como fração das ações em circulação. */
  dailyVolumeRatio: 0.004,
  slippageK: 0.08,
  slippageExponent: 1.3,
  slippageCap: 0.25,

  /** Corretagem: fixo + percentual. */
  brokerageFixed: 4.9,
  brokeragePercent: 0.0015,

  /** IR sobre lucro realizado e isenção mensal de vendas. */
  capitalGainsTax: 0.15,
  monthlySalesExemption: 20_000,
  taxDebtPenalty: 0.02,
  taxDebtMonthlyInterest: 0.01,

  /** Dividendo trimestral = preço × yield alvo ÷ 4, limitado pelo caixa. */
  dividendCashReserve: 0.05,

  /** Trimestres seguidos de caixa negativo até a recuperação judicial. */
  quartersToBankruptcy: 3,
  /** Trimestres em recuperação judicial até a deslistagem. */
  quartersToDelisting: 2,

  /** Janela de candles diários mantida em estado. */
  dailyCandleWindow: 365,
  /**
   * Teto de candles semanais (3 anos). Sem ele o histórico cresce para sempre:
   * numa partida de 47 anos seriam 2.400 semanais por ativo, e o custo do tick
   * é proporcional ao total de candles — medido em 2,2 ms/dia com 196 candles
   * contra 6,3 ms/dia com 460.
   */
  weeklyCandleWindow: 156,
} as const

/** Convergência da receita para a tendência e ruído idiossincrático. */
export const COMPANY_OPS = {
  revenueSpeed: 0.02,
  revenueNoise: 0.004,
  /** Quanto a margem comprime/expande com o ciclo. */
  marginCycleWeight: 1.5,
  /** Juro da dívida corporativa = Selic + isto. */
  debtSpread: 0.04,
  /** Trimestres de lucro guardados. */
  profitHistorySize: 8,
} as const

// --- Eventos e notícias (spec §5.8 e §5.9) ---------------------------------

export const EVENTS = {
  /** Probabilidade diária de um evento qualquer ser sorteado. */
  dailyChance: 0.22,
  /** Chance de o evento sorteável virar rumor antes de acontecer. */
  rumorChance: 0.45,
  /** Prazo em que o rumor se resolve. */
  rumorMinDays: 3,
  rumorMaxDays: 14,
  /** Chance de um rumor ser falso — nunca vai se confirmar. */
  falseRumorChance: 0.35,
  /** Janela de eventos mantidos para o passo de notícias. */
  pendingWindowDays: 5,
} as const

export const NEWS = {
  /**
   * Coeficiente do choque de preço por manchete:
   * `sentimento × alcance × credibilidade × este número`. Uma matéria devastadora
   * (−0,85) no veículo de maior alcance e credibilidade alta move ~8%.
   */
  priceCoefficient: 0.12,
  /**
   * Decaimento do choque acumulado por ativo. Sem ele, uma sequência de
   * manchetes ruins empilha choque no teto por dias seguidos e o preço passa a
   * andar por notícia em vez de por fundamento.
   */
  shockDecay: 0.5,
  /** Manchete só sai se a prioridade passar deste piso no veículo. */
  minPriorityByReach: 3,
  /** Dia do mês em que a assinatura premium é cobrada. */
  subscriptionDay: 1,
} as const

// --- Operação de empresas (GAME_DESIGN C4) ---------------------------------

export const OPERATIONS = {
  /**
   * Atratividade (spec §5.5, resolvido em C4):
   *
   *   A = marca^0,8 × (0,55 + 0,45·qualidade^0,9) × fatorPreço^0,6
   *
   * **Multiplicativa na marca**, não aditiva. Na forma aditiva o termo de preço
   * dava um piso de atratividade a quem ninguém conhece: uma empresa recém
   * fundada, de um funcionário, levava 13% do setor só por cobrar o preço médio
   * — e como não tinha capacidade para atender, a venda simplesmente sumia do
   * setor. Sem alcance não há fatia; qualidade e preço modulam o que a marca
   * abre.
   */
  brandExponent: 0.8,
  qualityBase: 0.55,
  qualityWeight: 0.45,
  qualityExponent: 0.9,
  /**
   * Expoente do preço na atratividade. Com 0,6 a elasticidade relativa efetiva
   * ficava em ~1,0: um prêmio de 10% custava 9% de fatia e dobrava a margem, e
   * todo agente subia preço para sempre. Em 1,4 o prêmio custa mais do que
   * rende, e o preço volta a ter âncora competitiva.
   */
  priceExponent: 1.4,
  /** Elasticidade: quanto a atratividade responde a preço abaixo da média. */
  priceElasticity: 1.6,
  /** Teto do fator de preço, para não haver share infinito a preço zero. */
  priceFactorCap: 3,
  /**
   * Elasticidade da demanda **do setor** ao nível de preço. Sem ela só o preço
   * relativo importava, e todo mundo podia subir preço junto sem perder volume:
   * os agentes da Fase 5b levaram o setor inteiro a cobrar 2× em cinco anos.
   */
  marketPriceElasticity: 1.5,

  /** Retorno do tamanho do setor à tendência, por dia. */
  marketSizeReversion: 0.004,

  /**
   * Marca e qualidade são **estoques com depreciação proporcional**: perder 1
   * ponto por dia de forma absoluta fazia todo mundo saturar em 100 e a
   * diferenciação sumir. Com depreciação percentual, o nível de equilíbrio é
   * ditado pela intensidade do gasto — e quem para de gastar volta a zero.
   */
  brandDecayRate: 0.00045,
  qualityDecayRate: 0.00025,
  /**
   * Ganho por real gasto, relativo à receita diária do setor. Calibrado para
   * que gastar o padrão do setor **mantenha** marca e qualidade: gastar mais
   * cresce, gastar menos erode. Com os valores antigos todo mundo saturava em
   * 100 no segundo ano e a diferenciação sumia.
   */
  /** Marca comprada: gasto de marketing sobre o tamanho diário do setor. */
  brandGainPerRatio: 2.5,
  /**
   * Marca conquistada: quem entrega tudo o que produz fica conhecido. Depende da
   * **utilização da própria capacidade**, não da fatia do setor — é o que
   * permite uma empresa nova sair de zero sem precisar comprar alcance nacional,
   * e é o teto natural dela: alcance de bairro, não de país.
   */
  brandGainPerUtilization: 0.02,
  /**
   * Qualidade é **intensidade**, não escala: depende da fração da receita posta
   * em P&D, não do tamanho da empresa. Uma oficina de dez pessoas pode fazer o
   * melhor produto do setor; medir P&D contra o setor inteiro tornava isso
   * impossível.
   */
  qualityGainPerRndRatio: 0.75,

  /** Moral e produtividade. Peso aplicado à folga salarial: 10% acima do
   *  mercado vale 4 pontos de moral. */
  moraleSalaryWeight: 40,
  moraleOverloadWeight: 15,
  moraleSpeed: 0.02,
  productivitySpeed: 0.01,
  /**
   * Depreciação anual do capital instalado — vida útil de ~20 anos. Com 8% ela
   * comia todo o lucro reinvestido de uma empresa pequena e o crescimento ficava
   * em zero.
   */
  capitalDepreciation: 0.05,
  /** Fração do lucro que a empresa dirigida pela IA reinveste em capital. */
  aiReinvestRatio: 0.5,
  productivityMax: 160,

  /** Demissão em massa: efeito em moral e reputação. */
  layoffMoraleHit: 18,
  layoffReputationHit: 10,

  /** Ajuste diário do quadro em direção ao alvo da diretriz. */
  headcountAdjustSpeed: 0.006,

  /** Fundação: capital mínimo e quadro inicial. */
  minFoundingCapital: 50_000,
  foundingHeadcount: 1,
  foundingQuality: 30,
  foundingBrand: 2,

  /** Venda da empresa: descontos sobre o valuation. */
  saleDebtDiscount: 1,
  saleReputationWeight: 0.3,
  /** Piso do valuation como fração da receita anual. */
  saleRevenueFloor: 0.2,
} as const

// --- Guardrails da IA (spec §5.12) -----------------------------------------

export const AI = {
  /** Reavaliação estratégica a cada 90 dias, com offset hash(id) % 90. */
  reviewIntervalDays: 90,
  /** Gatilho fora do ciclo respeita este cooldown. */
  triggerCooldownDays: 15,
  /** Só muda se o ganho projetado superar isto. */
  hysteresis: 0.03,
  /** Variação máxima de preço por decisão. */
  priceRateLimit: 0.15,
  /** Cooldown por tipo de ação, em dias. */
  actionCooldownDays: {
    ajustarPreco: 45,
    ajustarMarketing: 30,
    investirPeD: 90,
    contratar: 30,
    demitir: 30,
    demissaoEmMassa: 180,
    expandirCapacidade: 60,
    pagarDividendos: 90,
    anunciarProduto: 120,
  } as Record<string, number>,
  /** Teto de marketing como fração da receita, para todo mundo. */
  marketingCap: 0.3,
  /** Trimestres com margem abaixo do mínimo até o agente recuar. */
  warFatigueLimit: 3,
  /** Decaimento diário do rancor. */
  grudgeDecayPerDay: 0.005,
  /** Estresse acumulado por trimestre ruim. */
  stressPerLossQuarter: 0.08,
  stressPerShareLoss: 0.05,
  stressPerPriceDrop: 0.04,
  stressReliefPerGoodQuarter: 0.03,
  /** Quebra de personagem: duração e estresse remanescente. */
  breakQuarters: 4,
  breakStressReset: 0.3,
  /** Trimestres ruins até o conselho trocar o CEO. */
  badQuartersToSuccession: 6,
  /** Semanas simuladas na projeção de um trimestre (resolução C5). */
  projectionSteps: 13,
  /** Passos de dias por semana projetada. */
  projectionStepDays: 7,
} as const

// --- Controle, OPA, IPO e fusão (spec §5.6) --------------------------------

export const CONTROL = {
  /** Limiares de participação que desbloqueiam poder. */
  relevantStake: 0.05,
  boardStake: 0.15,
  blockingStake: 0.25,
  controlStake: 0.5,
  squeezeOutStake: 0.9,

  /** Prazo de uma OPA, em dias. */
  tenderDays: 30,
  /** Prêmio mínimo aceito como oferta séria. */
  minPremium: 0.05,
  maxPremium: 1.5,
  /** Janela usada para o preço de referência da oferta. */
  referenceWindowDays: 60,

  /**
   * Aceitação de cada bloco: base + prêmio − lealdade − confiança na gestão
   * atual + humor da imprensa. É aqui que comprar jornal vira arma real.
   */
  acceptBase: 0.1,
  acceptPremiumWeight: 1.4,
  acceptLoyaltyWeight: 0.8,
  acceptManagementWeight: 0.5,
  acceptSentimentWeight: 0.35,

  /** IPO: exigências mínimas e custo. */
  ipoMinQuarters: 4,
  ipoMinAnnualRevenue: 5_000_000,
  ipoMinAnnualProfit: 400_000,
  ipoBankFeeRatio: 0.05,
  ipoMinFloat: 0.15,
  ipoMaxFloat: 0.6,

  /** Fusão: sinergia e choque de cultura. */
  mergerSynergy: 0.08,
  mergerCultureShock: 20,

  /** Antitruste: participação setorial que aciona investigação. */
  antitrustShare: 0.45,
  antitrustDeadlineDays: 540,
} as const

// --- Defesas do conselho e tycoons (spec §5.12) ----------------------------

export const DEFENSE = {
  /** Participação de terceiro que acorda o conselho. */
  wakeStake: 0.05,
  /** Cooldown entre defesas da mesma empresa. */
  cooldownDays: 90,
  /** Recompra: fração do caixa que o conselho topa gastar. */
  buybackCashRatio: 0.25,
  /** Pílula de veneno: emissão como fração do capital existente. */
  poisonPillIssue: 0.2,
  /** Cavaleiro branco: fração do float que vai para o aliado. */
  whiteKnightFloat: 0.35,
  /** Lealdade do bloco do cavaleiro branco. */
  whiteKnightLoyalty: 0.85,
  /** Banco de defesa: custo como fração do caixa, e ganho de confiança. */
  defenseBankCashRatio: 0.05,

  /** Rancor marcado em quem ataca. */
  grudgeOnDisclosure: 0.4,
  grudgeOnTender: 1,
} as const

export const TYCOONS = {
  /** Reavaliação do tycoon, em dias. */
  reviewIntervalDays: 90,
  /** Compra até esta fração do volume diário do papel. */
  dailyVolumeShare: 0.5,
  /**
   * Participação a partir da qual ele parte para a OPA. Casada com o limiar de
   * assento no conselho: com 0,20 os três rivais disputavam o mesmo float,
   * empacavam em 17% e nenhuma oferta saía.
   */
  tenderFromStake: 0.15,
  /** Prêmio que o tycoon oferece. */
  tenderPremium: 0.45,
  /**
   * Só ataca empresa cujo preço esteja abaixo deste múltiplo do valor justo.
   * Com 1,05 quase nunca havia alvo — os arquétipos que buscam margem empurram
   * o preço acima do justo, e os rivais passavam a partida inteira parados em
   * 8%. Um predador não precisa de pechincha, precisa de alvo tomável.
   */
  cheapThreshold: 1.25,
} as const

// --- Política (spec §5.7) ---------------------------------------------------

export const POLITICS = {
  /** Eleição federal a cada 4 anos, em outubro. */
  electionIntervalDays: 1460,
  electionMonth: 10,

  /** Peso de cada componente no resultado da eleição. */
  approvalWeight: 0.45,
  donationWeight: 0.15,
  mediaWeight: 0.2,
  economyWeight: 0.2,
  resultNoise: 0.06,

  /** Doação: R$ 100 mil é a unidade de lealdade. */
  donationUnit: 100_000,
  loyaltyExponent: 0.7,
  loyaltyMaxPerDonation: 25,
  loyaltyDecayPerDay: 0.05,

  /** Lobby: R$ 500 mil move 1 ponto percentual, com retorno decrescente. */
  lobbyUnit: 500_000,
  lobbyExponent: 0.75,
  /** Teto de deslocamento de apoio por rodada de lobby. */
  lobbyMaxShift: 0.25,

  /** Tramitação: deriva diária do apoio em direção à posição média da casa. */
  supportDrift: 0.002,
  /** Apoio necessário na votação. */
  approvalThreshold: 0.5,

  /** Projeto rejeitado pode voltar depois deste prazo. */
  reproposalDelayDays: 730,

  /** Político leal propõe política alinhada a cada tantos dias. */
  proposalIntervalDays: 365,
  loyaltyToPropose: 30,

  /**
   * Notoriedade. Ela **decai** e só vira problema com prova: uma aquisição
   * hostil chama atenção, mas não é crime — quem condena é a prova rastreável.
   */
  notorietyDecayPerDay: 0.04,
  investigationThreshold: 60,
  investigationDeadlineDays: 180,
  /** P(condenação) = provas / (provas + isto). */
  evidenceDivisor: 8,
  /** Provas por ato rastreável. */
  evidenceDonation: 1.2,
  evidencePlantedStory: 1,
  evidenceMassLayoff: 0.8,
  evidenceTailoredPolicy: 2.5,
  /** Advogado: quanto R$ 1 milhão apaga de prova. */
  evidencePerMillionLawyer: 0.8,

  /** Condenação: multa, bloqueio e prisão. */
  convictionFineRatio: 0.25,
  convictionPrisonDays: 180,

  /** Carreira política do jogador. */
  officeRequirements: {
    vereador: { charisma: 35, reputation: 0, campaign: 50_000 },
    deputado: { charisma: 55, reputation: 10, campaign: 400_000 },
    senador: { charisma: 70, reputation: 25, campaign: 2_000_000 },
    presidente: { charisma: 85, reputation: 45, campaign: 20_000_000 },
  } as Record<string, { charisma: number; reputation: number; campaign: number }>,

  /**
   * Peso do voto do jogador no apoio a um projeto, por cargo.
   *
   * Vereador quase não move a agulha; presidente decide. É o que dá sentido a
   * subir na carreira política em vez de parar no primeiro cargo elegível.
   */
  voteWeightByOffice: {
    vereador: 0.02,
    deputado: 0.06,
    senador: 0.12,
    presidente: 0.25,
  } as Record<string, number>,

  /** Notoriedade cobrada quando uma política aprovada beneficia sua empresa. */
  notorietyPerTailoredPolicy: 15,
  notorietyPerDonation: 3,
} as const

// --- Ativos pessoais e fim de jogo (spec §5.10 e §5.11) --------------------

export const ASSETS_CONFIG = {
  /** Fração do valor perdida ao vender por fora do mercado. */
  saleSpread: 0.06,
  /** Renda de aluguel só entra se o imóvel não for a residência. */
  rentDay: 8,
  upkeepDay: 12,
  /** Notoriedade cobrada por dia enquanto o luxo está no nome. */
  notorietyPerDay: 0.02,
} as const

export const ENDGAME = {
  /** Entradas guardadas no ranking local. */
  rankingSize: 10,
  /** Arquétipos iniciais e o que cada um troca (New Game+). */
  /**
   * Cada arquétipo troca uma vantagem por uma desvantagem — sem isso o New
   * Game+ vira só um bônus, e o jogo deixa de ser sobre escolha.
   * O filho de político começa com contatos **e** com o fisco de olho.
   */
  archetypes: {
    comum: { money: 0, charisma: 0, intelligence: 0, reputation: 0, notoriety: 0, unlockNetWorth: 0 },
    herdeiro: {
      money: 250_000,
      charisma: 5,
      intelligence: 0,
      reputation: -10,
      notoriety: 0,
      unlockNetWorth: 5_000_000,
    },
    genio: {
      money: 0,
      charisma: -5,
      intelligence: 20,
      reputation: 0,
      notoriety: 0,
      unlockNetWorth: 20_000_000,
    },
    filhoDePolitico: {
      money: 60_000,
      charisma: 15,
      intelligence: 0,
      reputation: 15,
      // O sobrenome abre portas e chama auditoria.
      notoriety: 35,
      unlockNetWorth: 50_000_000,
    },
  } as Record<
    string,
    {
      money: number
      charisma: number
      intelligence: number
      reputation: number
      notoriety: number
      unlockNetWorth: number
    }
  >,
} as const
