/**
 * Tipos de domínio do jogo. TypeScript puro — nenhum import, nem de tipo.
 *
 * Este arquivo descreve o `GameState` **final**, incluindo sistemas que só serão
 * implementados nas fases 6 a 8. Campos de sistemas futuros existem e nascem
 * vazios; nenhuma fase seguinte deveria precisar mudar a forma do estado.
 *
 * Convenções obrigatórias (ver CLAUDE.md §6):
 * - O save é JSON puro. Nunca `Date`, `Map`, `Set` ou `class` aqui.
 * - Ausência é `| null`, nunca `?` nem `undefined` — `undefined` não sobrevive a
 *   `JSON.stringify` e quebraria o round-trip do save.
 * - Todo dicionário indexado por id vem acompanhado de um array de ordem
 *   (`*Order`), porque a ordem de iteração determina o consumo do RNG e,
 *   portanto, o determinismo.
 */

// ---------------------------------------------------------------------------
// Primitivos
// ---------------------------------------------------------------------------

export type EntityId = string

/** Valores monetários em BRL nominal. */
export type Money = number

/** 0 a 1. */
export type Ratio = number

/** Taxa anual, ex.: 0.1075 para 10,75% a.a. */
export type AnnualRate = number

/**
 * Data do jogo. `dayIndex` é o número de dias desde o início da partida e é a
 * única forma correta de fazer aritmética de tempo — dia/mês/ano são derivados
 * e existem para exibição e para marcos de calendário.
 */
export interface GameDate {
  dayIndex: number
  day: number
  month: number
  year: number
}

export type Quarter = 1 | 2 | 3 | 4

/** Estado do mulberry32. Vive dentro do GameState (spec §3.1). */
export interface RngState {
  seed: number
  counter: number
}

export type EntityKind =
  | 'player'
  | 'company'
  | 'industry'
  | 'politician'
  | 'outlet'
  | 'tycoon'
  | 'fund'

export interface EntityRef {
  kind: EntityKind
  id: EntityId
}

/** Detentor de participação: o jogador, um NPC nomeado, ou o float do mercado. */
export type HolderId = 'player' | 'float' | EntityId

// ---------------------------------------------------------------------------
// §5.1 Jogador
// ---------------------------------------------------------------------------

export interface Skills {
  intelligence: number
  charisma: number
  technical: number
  fitness: number
}

export type ActionBlockKind =
  | 'trabalhar'
  | 'horaExtra'
  | 'estudar'
  | 'academia'
  | 'lazer'
  | 'socializar'
  | 'gerir'

/** Progresso no curso em andamento. */
export interface CourseProgress {
  courseId: string
  daysDone: number
}

export interface CareerState {
  jobId: string | null
  daysInJob: number
  /** 0-100, alimenta a elegibilidade a promoção. */
  performance: number
  /** Salário mensal nominal vigente, já reajustado pela inflação. */
  salary: Money
  daysSinceLastRaise: number
}

/** Cargo eletivo ocupado pelo jogador (§5.7, carreira política). */
export type PublicOffice = 'vereador' | 'deputado' | 'senador' | 'presidente'

export interface Player {
  name: string
  age: number
  money: Money
  energy: number
  health: number
  mood: number
  hunger: number
  skills: Skills
  /** Ids de cursos concluídos. */
  education: string[]
  activeCourse: CourseProgress | null
  currentJobId: string | null
  career: CareerState
  creditScore: number
  publicReputation: number
  notoriety: number
  /** Blocos já gastos hoje (teto em config.ACTION_BLOCKS_PER_DAY). */
  blocksUsedToday: number
  /** Refeições feitas hoje (teto em config.MEALS_PER_DAY). Comer é livre de bloco. */
  mealsToday: number
  /**
   * Rotina usada pelo avanço rápido de tempo (GAME_DESIGN C1): a ordem em que
   * os blocos do dia são gastos automaticamente.
   */
  routine: ActionBlockKind[]
  /** Contatos ganhos socializando; alimenta oportunidades e lobby. */
  contacts: number
  /**
   * Contas de casa vencidas e não pagas. Sem banco até a Fase 2, é aqui que a
   * conta fica: acumula, drena humor e score, e é quitada assim que entra
   * dinheiro.
   */
  overdueBills: Money
  office: PublicOffice | null
  /** Dias restantes de prisão; > 0 bloqueia ações e cargos de gestão (§5.7). */
  incarceratedDays: number
}

// ---------------------------------------------------------------------------
// §5.2 Macroeconomia
// ---------------------------------------------------------------------------

export type CyclePhase = 'expansao' | 'pico' | 'recessao' | 'recuperacao'

export interface MacroState {
  cyclePhase: CyclePhase
  cycleDayCounter: number
  /** Duração sorteada da fase atual, em dias. */
  cycleTargetDays: number
  selic: AnnualRate
  inflation: AnnualRate
  /** Meta de inflação — deslocável por política aprovada (§5.7). */
  inflationTarget: AnnualRate
  confidence: number
  marketIndex: number
  marketIndexHistory: Candle[]
  unemployment: Ratio
  /** Desvio do produto potencial, entra na regra de reação do banco central. */
  outputGap: number
  nextMeetingDayIndex: number
  /**
   * Índice de preços acumulado, base 1,0 no primeiro dia. Toda constante de
   * `src/data/` está em R$ do ano 0 e é convertida para nominal multiplicando
   * por aqui — sem isso, 30 anos de inflação transformam o aluguel em troco e o
   * jogador fica rico por acidente.
   */
  priceLevel: number
}

/** Macro como o público vê: com lag de divulgação (§5.12 Regra 2). */
export interface PublishedMacro {
  asOfDayIndex: number
  selic: AnnualRate
  inflation: AnnualRate
  confidence: number
  marketIndex: number
  unemployment: Ratio
  cyclePhase: CyclePhase | null
}

// ---------------------------------------------------------------------------
// §5.3 Bolsa
// ---------------------------------------------------------------------------

export interface Candle {
  dayIndex: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  /** Candles semanais agregados a partir de 365 dias (spec §3.5). */
  isWeekly: boolean
}

export interface Stock {
  companyId: EntityId
  price: number
  sharesOutstanding: number
  beta: number
  volatility: number
  dividendYieldTarget: Ratio
  history: Candle[]
  /**
   * Quantos candles do início de `history` são semanais. Guardado para que a
   * compactação diária seja O(1) na verificação: varrer o histórico todo dia
   * custa caro dentro do draft do Immer.
   */
  weeklyCount: number
  /** Volume negociado hoje; limita ordens grandes e gera slippage. */
  volumeToday: number
  /** Soma dos choques de evento/notícia aplicáveis hoje. */
  eventShockToday: number
}

export interface Position {
  companyId: EntityId
  shares: number
  avgPrice: number
  /** Negativo em posição vendida a descoberto (fase tardia). */
  shortShares: number
}

export type OrderKind = 'mercado' | 'limite'
export type OrderSide = 'compra' | 'venda' | 'vendaDescoberto' | 'recompra'

export interface Order {
  id: EntityId
  companyId: EntityId
  kind: OrderKind
  side: OrderSide
  shares: number
  /** Preço-limite; null em ordem a mercado. */
  limitPrice: number | null
  placedDayIndex: number
  expiresDayIndex: number | null
}

/** Pendência de imposto não pago por falta de caixa (GAME_DESIGN C6). */
export interface TaxDebt {
  id: EntityId
  amount: Money
  createdDayIndex: number
  /** Multa e juros já acumulados sobre o principal. */
  penalty: Money
}

export interface MarginAccount {
  enabled: boolean
  /** Garantia depositada. */
  collateral: Money
  borrowed: Money
  maintenanceRatio: Ratio
}

export interface MarketState {
  positions: Record<EntityId, Position>
  positionOrder: EntityId[]
  orders: Order[]
  /** Lucro realizado no mês corrente, base do IR de 15%. */
  realizedPnlMonth: Money
  /** Vendas do mês, para a isenção mensal (GAME_DESIGN C6). */
  salesVolumeMonth: Money
  realizedPnlTotal: Money
  dividendsReceivedTotal: Money
  taxDebts: TaxDebt[]
  margin: MarginAccount
  /** Assinaturas premium de veículos (§5.8). */
  subscriptions: Subscription[]
}

// ---------------------------------------------------------------------------
// §5.4 Bancos
// ---------------------------------------------------------------------------

export interface BankAccount {
  bankId: string
  checking: Money
  savings: Money
  /** Fração da Selic paga pela poupança/CDB deste banco. */
  savingsRate: Ratio
  /** Dia em que o CDB pode ser resgatado sem perda. */
  savingsLockedUntilDayIndex: number | null
}

export type AssetRef = EntityRef | { kind: 'personalAsset'; id: EntityId }

export type LoanKind = 'pessoal' | 'capitalDeGiro' | 'imobiliario' | 'consignado'

export interface Loan {
  id: EntityId
  bankId: string
  kind: LoanKind
  /** Devedor: o jogador ou uma empresa. */
  borrower: HolderId
  principal: Money
  rate: AnnualRate
  termDays: number
  remaining: Money
  /** Parcela diária equivalente; simplifica o passo de banking. */
  dailyPayment: Money
  nextDueDayIndex: number
  daysOverdue: number
  collateral: AssetRef | null
}

export interface CreditCard {
  bankId: string
  limit: Money
  balance: Money
  /** Rotativo: taxa mensal punitiva. */
  revolvingMonthlyRate: number
  statementDay: number
}

export interface BankingState {
  accounts: BankAccount[]
  loans: Loan[]
  cards: CreditCard[]
  /** Histórico de pagamentos em dia / atrasos, base do score. */
  paymentsOnTime: number
  paymentsLate: number
  bankruptcies: number
}

// ---------------------------------------------------------------------------
// §5.5 Empresas
// ---------------------------------------------------------------------------

/**
 * Quadro de funcionários **agregado**.
 *
 * O spec §5.5 descreve funcionários individuais, mas 28 empresas com milhares de
 * pessoas cada não cabem no save nem no orçamento do tick — e nada na mecânica
 * distingue um operador do outro. O que importa (folha, produtividade e moral)
 * é modelado no agregado, e vale igual para a empresa do jogador e para a
 * concorrente: uma engenharia só, como a §5.5 exige.
 */
export interface Workforce {
  headcount: number
  /** Salário anual médio, nominal. */
  avgSalary: Money
  /** 0-100. Cai com carga excessiva, sobe com salário acima do mercado. */
  productivity: number
  morale: number
}

export interface OwnershipEntry {
  holderId: HolderId
  shares: number
}

/** Divulgação obrigatória de participação ≥ 5% (§5.6). */
export interface OwnershipDisclosure {
  id: EntityId
  companyId: EntityId
  holderId: HolderId
  stakePct: Ratio
  dayIndex: number
}

/**
 * Diretrizes persistentes de gestão (GAME_DESIGN C2). A empresa opera sozinha
 * com o que está aqui; bloco de ação só é cobrado ao **alterar** uma diretriz.
 * O mesmo tipo é usado pelo jogador e pelos agentes NPC (§5.12 Regra 1).
 */
export interface CompanyDirectives {
  price: number
  /** Fração da receita gasta em marketing. */
  marketingRatio: Ratio
  /** Fração da receita gasta em P&D. */
  rndRatio: Ratio
  /** Alvo de quadro de funcionários. */
  headcountTarget: number
  /** Fração do lucro distribuída como dividendo. */
  payoutRatio: Ratio
  /** Alvo de caixa como fração da receita anual. */
  cashReserveTarget: Ratio
  /** Margem mínima aceita — define o piso duro de preço (§5.12 guardrails). */
  minMargin: Ratio
}

export type CompanyStatus = 'ativa' | 'recuperacaoJudicial' | 'deslistada' | 'fechada' | 'adquirida'

export interface Company {
  id: EntityId
  name: string
  industryId: string
  isPublic: boolean
  founded: GameDate
  cash: Money
  debt: Money
  revenue: Money
  costs: Money
  lastQuarterProfit: Money
  /** Últimos 8 trimestres de lucro, do mais recente para o mais antigo. */
  profitHistory: Money[]
  workforce: Workforce
  productQuality: number
  brandAwareness: number
  rndLevel: number
  /** Progresso acumulado até o próximo salto de qualidade (Oficina). */
  rndProgress: number
  price: number
  marketingSpend: Money
  ownership: OwnershipEntry[]
  stock: Stock | null
  reputation: number
  directives: CompanyDirectives
  /**
   * Receita anual de tendência, em nominal. Na Fase 3 ela é o eixo em torno do
   * qual a receita realizada oscila com o ciclo; na Fase 5 passa a ser o teto
   * físico de produção, que é o freio do early game.
   */
  capacity: number
  /** Margem operacional de referência da empresa, antes do efeito do ciclo. */
  baseMargin: number
  /**
   * Capital instalado (imobilizado). Junto com o quadro, é o que limita a
   * capacidade: gente sem máquina não produz. É o freio que faz expandir custar
   * caro — sem ele, contratar tinha retorno praticamente infinito e a empresa
   * do jogador passava de R$ 120 mil a R$ 8 bilhões de receita em cinco anos.
   */
  capitalStock: Money
  /** Participação no setor, derivada de atratividade relativa (C4). */
  marketShare: Ratio
  status: CompanyStatus
  quartersNegativeCash: number
  /** Trimestres em recuperação judicial. */
  quartersInRj: number
  /** Quem responde pela empresa: o jogador ou um arquétipo de IA. */
  managedBy: 'player' | 'ai'
  /** Fim do trimestre em que a empresa foi fundada, para elegibilidade a IPO. */
  quartersReported: number
}

export interface IndustryState {
  industryId: string
  /** Receita anual agregada do setor, em BRL nominal. */
  marketSize: Money
  /**
   * Tendência para a qual `marketSize` volta. Eventos de setor multiplicam o
   * tamanho corrente; sem um eixo de retorno, 47 anos de choques acumulados
   * levariam o setor a zero ou ao infinito.
   */
  trendSize: Money
  /** Preço médio praticado, usado na elasticidade (C4). */
  averagePrice: number
  /** Alíquota vigente, deslocável por política aprovada. */
  taxRate: Ratio
  /** Subsídio vigente como fração da receita. */
  subsidyRatio: Ratio
  /** Tarifa de importação vigente. */
  importTariff: Ratio
  companyOrder: EntityId[]
}

/** Financeiro divulgado: só o ÚLTIMO trimestre fechado (§5.12 Regra 2). */
export interface PublishedFinancials {
  companyId: EntityId
  asOfDayIndex: number
  revenue: Money
  profit: Money
  cash: Money
  debt: Money
  employeeCount: number
  marketShare: Ratio
  reputation: number
  /** Nulo para empresa privada — o concorrente não enxerga (C13). */
  price: number | null
}

// ---------------------------------------------------------------------------
// §5.6 Participação, controle e M&A
// ---------------------------------------------------------------------------

export type ControlLevel = 'nenhum' | 'relevante' | 'conselho' | 'bloqueio' | 'controle' | 'fechamento'

export type TenderStatus = 'aberta' | 'aceita' | 'recusada' | 'expirada'

/** OPA — oferta pública de aquisição (§5.6). */
export interface Tender {
  id: EntityId
  companyId: EntityId
  bidderId: HolderId
  /** Prêmio sobre a média de mercado dos últimos 60 dias. */
  premium: Ratio
  pricePerShare: number
  sharesSought: number
  hostile: boolean
  openedDayIndex: number
  expiresDayIndex: number
  status: TenderStatus
  /** Aceitação acumulada dos acionistas NPC. */
  acceptedShares: number
}

export interface IpoPlan {
  companyId: EntityId
  underwriterBankId: string
  /** Fração do capital vendida ao mercado. */
  floatPct: Ratio
  pricePerShare: number
  feePaid: Money
  dayIndex: number
}

export interface MergerPlan {
  id: EntityId
  acquirerId: EntityId
  targetId: EntityId
  cashPaid: Money
  sharesIssued: number
  synergyRatio: Ratio
  /** Queda de moral pós-fusão. */
  cultureShock: number
  dayIndex: number
}

export type AntitrustStatus = 'investigando' | 'arquivada' | 'condenada'

export interface AntitrustCase {
  id: EntityId
  industryId: string
  targetId: EntityId
  openedDayIndex: number
  deadlineDayIndex: number
  status: AntitrustStatus
  /** Gasto de lobby aplicado à mitigação. */
  lobbyMitigation: Money
}

/** Defesas do conselho ao ver alguém acumulando posição (§5.12 reações). */
export type DefenseKind = 'recompra' | 'pilulaDeVeneno' | 'cavaleiroBranco' | 'bancoDeDefesa'

export interface DefenseAction {
  id: EntityId
  companyId: EntityId
  kind: DefenseKind
  againstId: HolderId
  dayIndex: number
  cost: Money
}

// ---------------------------------------------------------------------------
// §5.7 Política
// ---------------------------------------------------------------------------

/** Deslocamentos que uma política aprovada aplica a parâmetros globais. */
export interface MacroDelta {
  selic?: number
  inflationTarget?: number
  /** Alíquota por setor. */
  taxRateByIndustry?: Record<string, number>
  subsidyByIndustry?: Record<string, number>
  importTariffByIndustry?: Record<string, number>
  minimumWage?: number
  creditLooseness?: number
  environmentalStrictness?: number
}

export interface Politician {
  id: EntityId
  name: string
  party: string
  /** Posição por pauta, -1 a 1. */
  stance: Record<string, number>
  approval: number
  office: string | null
  loyaltyToPlayer: number
  /** Doações recebidas do jogador, rastreáveis numa investigação. */
  donationsFromPlayer: Money
  /** Empresas que ele protege — o Padrinho depende disto. */
  patronageOf: EntityId[]
}

export type PolicyStatus = 'proposta' | 'tramitando' | 'aprovada' | 'rejeitada'

export interface Policy {
  id: string
  name: string
  effects: MacroDelta
  sponsorId: EntityId
  status: PolicyStatus
  supportPct: Ratio
  proposedDayIndex: number
  voteDayIndex: number | null
  /** Quem beneficia — alimenta notoriety se for empresa do jogador. */
  beneficiaryIndustryIds: string[]
}

export interface Donation {
  id: EntityId
  donorId: HolderId
  politicianId: EntityId
  amount: Money
  dayIndex: number
  /** Doação de empresa é mais rastreável que doação pessoal. */
  traceable: boolean
}

export interface LobbyEffort {
  id: EntityId
  policyId: string
  actorId: HolderId
  amount: Money
  /** Empurrar a favor ou contra — é isso que faz o lobby virar leilão. */
  direction: 1 | -1
  dayIndex: number
}

export type ElectionScope = 'federal' | 'local'

export interface Election {
  id: EntityId
  scope: ElectionScope
  dayIndex: number
  candidateIds: EntityId[]
  /** Nulo até a apuração. */
  winnerId: EntityId | null
  /** Votos por candidato, preenchido na apuração. */
  results: Record<EntityId, Ratio>
}

export type InvestigationStatus = 'aberta' | 'arquivada' | 'condenada'

export interface Investigation {
  id: EntityId
  targetId: HolderId
  openedDayIndex: number
  deadlineDayIndex: number
  /** Provas acumuladas; define P(condenação) = provas / (provas + 8). */
  evidence: number
  status: InvestigationStatus
  lawyerSpend: Money
  /** Político leal que pode engavetar. */
  shieldedByPoliticianId: EntityId | null
}

export interface PoliticsState {
  politicians: Record<EntityId, Politician>
  politicianOrder: EntityId[]
  policies: Record<string, Policy>
  policyOrder: string[]
  elections: Election[]
  donations: Donation[]
  lobbyEfforts: LobbyEffort[]
  investigations: Investigation[]
  antitrustCases: AntitrustCase[]
  /** Deslocamentos vigentes, soma de todas as políticas aprovadas. */
  activeDeltas: MacroDelta
}

// ---------------------------------------------------------------------------
// §5.8 Jornais e mídia
// ---------------------------------------------------------------------------

export interface NewsOutlet {
  id: string
  name: string
  credibility: number
  /** Viés por assunto/setor/partido, -1 a 1. */
  bias: Record<string, number>
  reach: number
  ownerId: HolderId | null
  /** Dias de atraso na publicação de um evento. */
  publishLagDays: number
  /** Probabilidade de o rumor publicado ser verdadeiro. */
  rumorAccuracy: Ratio
  /** Empresa correspondente, quando o veículo é listado/adquirível. */
  companyId: EntityId | null
}

export interface Headline {
  id: EntityId
  outletId: string
  dayIndex: number
  text: string
  subject: EntityRef
  /** -1 a 1. */
  sentiment: number
  isRumor: boolean
  /** Confiança do veículo na informação. Rumor falso tem accuracy alta e é falso. */
  accuracy: Ratio
  /** Se falso, o mundo nunca vai confirmar — e o NPC reagiu de todo jeito. */
  isTrue: boolean
  /** Matéria plantada pelo dono do veículo. */
  planted: boolean
  eventId: EntityId | null
}

/** Pauta editorial imposta pelo dono do veículo (§5.8). */
export interface EditorialOrder {
  id: EntityId
  outletId: string
  subject: EntityRef
  targetSentiment: number
  dayIndex: number
  /** Cooldown: dia a partir do qual o veículo aceita nova pauta. */
  cooldownUntilDayIndex: number
}

export interface Subscription {
  outletId: string
  startedDayIndex: number
  monthlyCost: Money
}

export interface NewsState {
  outlets: Record<string, NewsOutlet>
  outletOrder: string[]
  /** Janela recente de manchetes; o feed é a tela inicial (§5.8). */
  headlines: Headline[]
  editorialOrders: EditorialOrder[]
  /** Manchetes já lidas, para o badge de não lidas. */
  lastReadDayIndex: number
}

// ---------------------------------------------------------------------------
// §5.9 Eventos
// ---------------------------------------------------------------------------

export type EventScope = 'global' | 'setor' | 'empresa' | 'jogador'

export interface EventEffect {
  /** Campo alvo em notação de caminho, resolvido pelo catálogo de efeitos. */
  target: string
  /** Delta absoluto ou multiplicador, conforme `mode`. */
  value: number
  mode: 'delta' | 'multiply' | 'set'
  /** Duração em dias; 0 é instantâneo. */
  durationDays: number
}

export interface EventDefinition {
  id: string
  scope: EventScope
  weight: number
  /** Expressões de pré-condição avaliadas pelo catálogo. */
  preconditions: string[]
  effects: EventEffect[]
  /** Template de manchete com placeholders. */
  headlineTemplate: string
  sentiment: number
  /** Pode ser publicado como rumor antes de acontecer. */
  rumorable: boolean
  cooldownDays: number
}

/** Instância sorteada de um evento (spec chama de WorldEvent). */
export interface WorldEvent {
  id: EntityId
  definitionId: string
  dayIndex: number
  scope: EventScope
  subject: EntityRef
  /** Prioridade para virar manchete (§5.12 Visibilidade). */
  priority: number
  /** Rumor pendente: já noticiável, mas ainda não aconteceu. */
  pending: boolean
  /** Dia em que o efeito se materializa, se pendente. */
  resolvesDayIndex: number | null
  /** Falso quando é rumor que não vai se confirmar. */
  willHappen: boolean
  applied: boolean
}

export interface ActiveEffect {
  id: EntityId
  eventId: EntityId
  effect: EventEffect
  remainingDays: number
}

export interface EventState {
  /** Eventos da rodada, consumidos pelo passo de notícias. */
  pending: WorldEvent[]
  active: ActiveEffect[]
  /** Último dia em que cada definição disparou, para cooldown. */
  lastFiredDayIndex: Record<string, number>
}

// ---------------------------------------------------------------------------
// §5.10 Ativos pessoais
// ---------------------------------------------------------------------------

export type PersonalAssetKind = 'imovel' | 'veiculo' | 'luxo'

export interface PersonalAsset {
  id: EntityId
  assetId: string
  kind: PersonalAssetKind
  name: string
  purchasePrice: Money
  currentValue: Money
  purchasedDayIndex: number
  /** Aluguel mensal, quando imóvel alugado a terceiros. */
  monthlyIncome: Money
  /** Depreciação anual (veículos) ou valorização (imóveis). */
  annualValueChange: number
  moodBonus: number
  reputationBonus: number
  notorietyCost: number
  /** Dado em garantia de empréstimo. */
  pledgedToLoanId: EntityId | null
  /** Moradia atual do jogador — afeta a recuperação do sono. */
  isResidence: boolean
}

export interface PersonalAssetsState {
  assets: PersonalAsset[]
  /** Id do imóvel/quarto onde o jogador mora; null = quarto alugado padrão. */
  residenceId: EntityId | null
  monthlyRent: Money
}

// ---------------------------------------------------------------------------
// §5.12 Agentes NPC
// ---------------------------------------------------------------------------

export type ArchetypeId =
  | 'bandeirante'
  | 'fortaleza'
  | 'oficina'
  | 'abutre'
  | 'espelho'
  | 'vitrine'
  | 'padrinho'
  | 'herdeiro'
  | 'sobrevivente'

export interface UtilityWeights {
  lucro: number
  share: number
  caixa: number
  acao: number
  qualidade: number
  influencia: number
  risco: number
}

export type HardRule =
  | { kind: 'forbid'; action: ActionKind }
  | { kind: 'floor'; field: string; value: number }
  | { kind: 'ceiling'; field: string; value: number }
  | { kind: 'always'; action: ActionKind; min: number }

export interface AIProfile {
  id: ArchetypeId
  name: string
  weights: UtilityWeights
  hardRules: HardRule[]
  signatureMove: ActionKind
  conviction: number
  imitation: number
  vindictiveness: number
  cashReserveTarget: Ratio
  minMargin: Ratio
  headlineVoice: string
}

/** Estado mutável de um agente que comanda uma empresa. */
export interface AgentState {
  companyId: EntityId
  profileId: ArchetypeId
  /** Acumula quando o resultado contradiz a estratégia. */
  stress: number
  /** Quebra de personagem: hardRules suspensas até este dia. */
  breakUntilDayIndex: number | null
  /** Trimestres com margem abaixo do mínimo. */
  warFatigue: number
  /** Rancor por entidade — retaliação direcionada. */
  grudge: Record<string, number>
  /** Dia da última reavaliação estratégica (cadência de 90 dias). */
  lastReviewDayIndex: number
  /** Offset determinístico: hash(companyId) % 90. */
  reviewOffset: number
  /** Cooldown por tipo de ação: ActionKind -> dayIndex liberado. */
  cooldowns: Record<string, number>
  /** Trimestres ruins consecutivos; 6 disparam sucessão de CEO. */
  badQuarters: number
  /** Líder do setor que o Espelho está copiando. */
  imitationTargetId: EntityId | null
}

/** Tycoon rival: joga o mesmo jogo que o jogador (§5.12). */
export interface TycoonState {
  id: EntityId
  name: string
  profileId: ArchetypeId
  cash: Money
  positions: Record<EntityId, Position>
  positionOrder: EntityId[]
  controlledCompanyIds: EntityId[]
  politicalInfluence: number
  ambition: number
  homeIndustryId: string
  grudge: Record<string, number>
  lastReviewDayIndex: number
  notoriety: number
}

/** Pressão agregada dos fundos sobre um ativo (§5.12 institucionais). */
export interface InstitutionalPressure {
  companyId: EntityId
  /** -1 a 1: venda a compra. */
  pressure: number
  momentum: number
}

/** Fundos nomeados, que existem só para dar rosto às notícias. */
export interface NamedFund {
  id: EntityId
  name: string
  positions: Record<EntityId, number>
  positionOrder: EntityId[]
}

export interface AiState {
  profiles: Record<ArchetypeId, AIProfile>
  agents: Record<EntityId, AgentState>
  agentOrder: EntityId[]
  tycoons: Record<EntityId, TycoonState>
  tycoonOrder: EntityId[]
  institutional: Record<EntityId, InstitutionalPressure>
  funds: Record<EntityId, NamedFund>
  fundOrder: EntityId[]
  defenses: DefenseAction[]
}

// ---------------------------------------------------------------------------
// §5.12 Regra 2 — PublicView
// ---------------------------------------------------------------------------

/**
 * Tudo que um agente pode ler. Congelado no passo 11 do tick e usado no dia
 * seguinte. `history` compartilha referência com o array de candles do estado —
 * nunca é copiado (GAME_DESIGN C12).
 */
export interface PublicView {
  date: GameDate
  macro: PublishedMacro
  stocks: Record<EntityId, { price: number; volume: number; history: Candle[] }>
  companies: Record<EntityId, PublishedFinancials>
  companyOrder: EntityId[]
  headlines: Headline[]
  disclosures: OwnershipDisclosure[]
  /** Preço médio por setor, informação pública agregada. */
  industryAveragePrice: Record<string, number>
}

// ---------------------------------------------------------------------------
// §5.11 Fim de jogo e meta
// ---------------------------------------------------------------------------

export type StartArchetype = 'comum' | 'herdeiro' | 'genio' | 'filhoDePolitico'

export type EndingKind = 'aposentadoria' | 'morte' | 'falencia' | 'prisao'

export interface RunResult {
  id: EntityId
  playerName: string
  endedAtDayIndex: number
  ending: EndingKind
  netWorth: Money
  companiesFounded: number
  officesHeld: PublicOffice[]
  finalHeadline: string
  startArchetype: StartArchetype
}

export interface MetaState {
  saveVersion: number
  startArchetype: StartArchetype
  /** Arquétipos iniciais desbloqueados para New Game+. */
  unlockedArchetypes: StartArchetype[]
  /** Ranking local de partidas encerradas. */
  ranking: RunResult[]
  ending: EndingKind | null
  companiesFoundedCount: number
  officesHeld: PublicOffice[]
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

/**
 * Todo tipo de ação do jogo. A união nasce completa porque `hardRules` e
 * `cooldowns` da IA são indexados por `ActionKind`, e porque a paridade de ações
 * (§5.12 Regra 1) exige um único vocabulário para jogador e NPC.
 */
export type ActionKind =
  // jogador
  | 'trabalhar'
  | 'horaExtra'
  | 'dormir'
  | 'comer'
  | 'academia'
  | 'lazer'
  | 'socializar'
  | 'estudar'
  | 'matricular'
  | 'candidatar'
  | 'pedirDemissao'
  | 'definirRotina'
  | 'avancarTempo'
  // mercado
  | 'comprarAcao'
  | 'venderAcao'
  | 'cancelarOrdem'
  | 'venderDescoberto'
  | 'recomprarDescoberto'
  | 'habilitarMargem'
  // banco
  | 'depositar'
  | 'sacar'
  | 'aplicar'
  | 'resgatar'
  | 'tomarEmprestimo'
  | 'pagarEmprestimo'
  | 'pagarImposto'
  | 'contratarCartao'
  // empresa
  | 'fundarEmpresa'
  | 'ajustarPreco'
  | 'ajustarMarketing'
  | 'investirPeD'
  | 'contratar'
  | 'demitir'
  | 'demissaoEmMassa'
  | 'expandirCapacidade'
  | 'reduzirCapacidade'
  | 'emprestimoEmpresarial'
  | 'pagarDividendos'
  | 'recomprarAcoes'
  | 'abrirCapital'
  | 'venderEmpresa'
  | 'entrarEmSetor'
  | 'venderDivisao'
  | 'nomearCeo'
  | 'anunciarProduto'
  // M&A
  | 'lancarOpa'
  | 'responderOpa'
  | 'fundir'
  | 'fecharCapital'
  | 'pilulaDeVeneno'
  | 'cavaleiroBranco'
  // política
  | 'doar'
  | 'fazerLobby'
  | 'proporPolitica'
  | 'votarPolitica'
  | 'contratarAdvogado'
  | 'candidatarCargo'
  // mídia
  | 'assinarVeiculo'
  | 'cancelarAssinatura'
  | 'comprarVeiculo'
  | 'definirPauta'
  // ativos
  | 'comprarAtivo'
  | 'venderAtivo'
  | 'mudarResidencia'
  // meta
  | 'iniciarPartida'
  | 'encerrarPartida'

export type GameAction =
  | { kind: 'trabalhar' }
  | { kind: 'horaExtra' }
  | { kind: 'dormir' }
  | { kind: 'comer'; mealId: string }
  | { kind: 'academia' }
  | { kind: 'lazer' }
  | { kind: 'socializar' }
  | { kind: 'estudar' }
  | { kind: 'matricular'; courseId: string }
  | { kind: 'candidatar'; jobId: string }
  | { kind: 'pedirDemissao' }
  | { kind: 'definirRotina'; routine: ActionBlockKind[] }
  | { kind: 'avancarTempo'; days: number }
  | { kind: 'comprarAcao'; companyId: EntityId; shares: number; limitPrice: number | null }
  | { kind: 'venderAcao'; companyId: EntityId; shares: number; limitPrice: number | null }
  | { kind: 'cancelarOrdem'; orderId: EntityId }
  | { kind: 'venderDescoberto'; companyId: EntityId; shares: number }
  | { kind: 'recomprarDescoberto'; companyId: EntityId; shares: number }
  | { kind: 'habilitarMargem'; collateral: Money }
  | { kind: 'depositar'; bankId: string; amount: Money }
  | { kind: 'sacar'; bankId: string; amount: Money }
  | { kind: 'aplicar'; bankId: string; amount: Money }
  | { kind: 'resgatar'; bankId: string; amount: Money }
  | { kind: 'tomarEmprestimo'; bankId: string; loanKind: LoanKind; amount: Money; termDays: number }
  | { kind: 'pagarEmprestimo'; loanId: EntityId; amount: Money }
  | { kind: 'pagarImposto'; debtId: EntityId }
  | { kind: 'contratarCartao'; bankId: string }
  | { kind: 'fundarEmpresa'; name: string; industryId: string; capital: Money }
  | { kind: 'ajustarPreco'; companyId: EntityId; price: number }
  | { kind: 'ajustarMarketing'; companyId: EntityId; ratio: Ratio }
  | { kind: 'investirPeD'; companyId: EntityId; ratio: Ratio }
  | { kind: 'contratar'; companyId: EntityId; count: number; salary: Money }
  | { kind: 'demitir'; companyId: EntityId; employeeId: EntityId }
  | { kind: 'demissaoEmMassa'; companyId: EntityId; count: number }
  | { kind: 'expandirCapacidade'; companyId: EntityId; investment: Money }
  | { kind: 'reduzirCapacidade'; companyId: EntityId; amount: number }
  | { kind: 'emprestimoEmpresarial'; companyId: EntityId; bankId: string; amount: Money; termDays: number }
  | { kind: 'pagarDividendos'; companyId: EntityId; ratio: Ratio }
  | { kind: 'recomprarAcoes'; companyId: EntityId; amount: Money }
  | { kind: 'abrirCapital'; companyId: EntityId; bankId: string; floatPct: Ratio; pricePerShare: number }
  | { kind: 'venderEmpresa'; companyId: EntityId }
  | { kind: 'entrarEmSetor'; companyId: EntityId; industryId: string; investment: Money }
  | { kind: 'venderDivisao'; companyId: EntityId; fraction: Ratio }
  | { kind: 'nomearCeo'; companyId: EntityId; profileId: ArchetypeId }
  | { kind: 'anunciarProduto'; companyId: EntityId; spend: Money }
  | { kind: 'lancarOpa'; companyId: EntityId; premium: Ratio; sharesSought: number }
  | { kind: 'responderOpa'; tenderId: EntityId; accept: boolean }
  | { kind: 'fundir'; acquirerId: EntityId; targetId: EntityId; cash: Money }
  | { kind: 'fecharCapital'; companyId: EntityId }
  | { kind: 'pilulaDeVeneno'; companyId: EntityId }
  | { kind: 'cavaleiroBranco'; companyId: EntityId; allyId: EntityId }
  | { kind: 'doar'; politicianId: EntityId; amount: Money; fromCompanyId: EntityId | null }
  | { kind: 'fazerLobby'; policyId: string; amount: Money; direction: 1 | -1 }
  | { kind: 'proporPolitica'; policyId: string }
  | { kind: 'votarPolitica'; policyId: string; inFavor: boolean }
  | { kind: 'contratarAdvogado'; investigationId: EntityId; spend: Money }
  | { kind: 'candidatarCargo'; office: PublicOffice; campaignSpend: Money }
  | { kind: 'assinarVeiculo'; outletId: string }
  | { kind: 'cancelarAssinatura'; outletId: string }
  | { kind: 'comprarVeiculo'; outletId: string }
  | { kind: 'definirPauta'; outletId: string; subject: EntityRef; targetSentiment: number }
  | { kind: 'comprarAtivo'; assetId: string; financed: boolean }
  | { kind: 'venderAtivo'; id: EntityId }
  | { kind: 'mudarResidencia'; id: EntityId | null }
  | { kind: 'iniciarPartida'; playerName: string; startArchetype: StartArchetype; seed: number }
  | { kind: 'encerrarPartida'; ending: EndingKind }

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

export type LogSeverity = 'info' | 'bom' | 'ruim' | 'critico'

export interface LogEntry {
  id: EntityId
  dayIndex: number
  severity: LogSeverity
  /** Sistema que emitiu: clock, macro, market, companies, banking, ... */
  source: string
  text: string
  /** Delta monetário associado, quando houver. */
  amount: Money | null
}

/** Resumo de um dia simulado, devolvido por worldTick. */
export interface DayLog {
  dayIndex: number
  entries: LogEntry[]
  headlineIds: EntityId[]
}

// ---------------------------------------------------------------------------
// Raiz
// ---------------------------------------------------------------------------

export interface GameState {
  saveVersion: number
  /** Epoch ms. Escrito pela UI/persistência; a engine nunca lê (C7). */
  createdAt: number
  lastTickAt: number
  rng: RngState
  date: GameDate
  player: Player
  macro: MacroState
  companies: Record<EntityId, Company>
  /** Ordem estável de iteração — pré-condição do determinismo. */
  companyOrder: EntityId[]
  industries: Record<string, IndustryState>
  industryOrder: string[]
  market: MarketState
  banking: BankingState
  news: NewsState
  politics: PoliticsState
  events: EventState
  ai: AiState
  /** Congelado ontem; é o que os agentes leem hoje (§5.12 Regra 2). */
  publicView: PublicView
  personalAssets: PersonalAssetsState
  ownershipDisclosures: OwnershipDisclosure[]
  tenders: Tender[]
  ipos: IpoPlan[]
  mergers: MergerPlan[]
  /** Janela recente do log; o histórico longo não vai para o save. */
  log: LogEntry[]
  /** Marcos e travas: tutorial visto, IPO liberado, endgame disparado. */
  flags: Record<string, boolean>
  meta: MetaState
}

/** Retorno de applyAction (spec §3.2). */
export interface ActionResult {
  state: GameState
  log: LogEntry[]
}

/** Retorno de worldTick (spec §3.2). */
export interface TickResult {
  state: GameState
  log: DayLog[]
}
