/**
 * Catálogo de eventos (spec §5.9). Cada entrada tem pré-condição, peso, escopo,
 * efeitos e template de manchete.
 *
 * `when` é função porque pré-condição declarada como string exigiria um
 * interpretador só para ela — e este arquivo é código, não save: nada daqui é
 * serializado.
 */
import type { Company, EventEffect, EventScope, GameState } from '@/engine/types'

export interface EventContext {
  state: GameState
  /** Empresa sorteada como alvo, quando o escopo é empresa. */
  company: Company | null
  industryId: string | null
}

export interface EventDef {
  id: string
  scope: EventScope
  weight: number
  when: (ctx: EventContext) => boolean
  effects: EventEffect[]
  /** `{alvo}` vira o nome da empresa, do setor ou do jogador. */
  headline: string
  /** -1 a 1. Alimenta o choque de preço e o humor da praça. */
  sentiment: number
  rumorable: boolean
  cooldownDays: number
  /** Prioridade editorial: manchete de primeira página tem prioridade alta. */
  priority: number
  /** Assunto, para casar com o viés do veículo. */
  topic: string
}

const always = (): boolean => true
const listed = (ctx: EventContext): boolean =>
  ctx.company !== null && ctx.company.status === 'ativa'

export const EVENT_DEFS: EventDef[] = [
  // --- Empresa --------------------------------------------------------------
  {
    id: 'escandalo-contabil',
    scope: 'empresa',
    weight: 0.6,
    when: listed,
    effects: [
      { target: 'company.reputation', value: -25, mode: 'delta', durationDays: 0 },
      { target: 'company.revenue', value: 0.92, mode: 'multiply', durationDays: 0 },
    ],
    headline: '{alvo} sob suspeita de maquiar balanço',
    sentiment: -0.85,
    rumorable: true,
    cooldownDays: 720,
    priority: 9,
    topic: 'escandalo',
  },
  {
    id: 'greve',
    scope: 'empresa',
    weight: 1.2,
    when: listed,
    effects: [
      { target: 'company.revenue', value: 0.97, mode: 'multiply', durationDays: 0 },
      { target: 'company.reputation', value: -6, mode: 'delta', durationDays: 0 },
    ],
    headline: 'Funcionários de {alvo} cruzam os braços',
    sentiment: -0.4,
    rumorable: true,
    cooldownDays: 365,
    priority: 5,
    topic: 'trabalho',
  },
  {
    id: 'recall',
    scope: 'empresa',
    weight: 0.9,
    when: listed,
    effects: [
      { target: 'company.cash', value: -0.04, mode: 'multiply', durationDays: 0 },
      { target: 'company.reputation', value: -12, mode: 'delta', durationDays: 0 },
    ],
    headline: '{alvo} faz recall de produto com defeito',
    sentiment: -0.5,
    rumorable: true,
    cooldownDays: 540,
    priority: 6,
    topic: 'produto',
  },
  {
    id: 'ciberataque',
    scope: 'empresa',
    weight: 0.7,
    when: (ctx) =>
      listed(ctx) && (ctx.company?.industryId === 'tecnologia' || ctx.company?.industryId === 'bancos'),
    effects: [
      { target: 'company.cash', value: -0.05, mode: 'multiply', durationDays: 0 },
      { target: 'company.reputation', value: -15, mode: 'delta', durationDays: 0 },
    ],
    headline: '{alvo} sofre ciberataque e tira sistemas do ar',
    sentiment: -0.6,
    rumorable: true,
    cooldownDays: 540,
    priority: 7,
    topic: 'tecnologia',
  },
  {
    id: 'processo-trabalhista',
    scope: 'empresa',
    weight: 1,
    when: listed,
    effects: [{ target: 'company.cash', value: -0.02, mode: 'multiply', durationDays: 0 }],
    headline: '{alvo} é condenada em ação trabalhista coletiva',
    sentiment: -0.3,
    rumorable: false,
    cooldownDays: 300,
    priority: 3,
    topic: 'trabalho',
  },
  {
    id: 'morte-ceo',
    scope: 'empresa',
    weight: 0.35,
    when: listed,
    effects: [{ target: 'company.reputation', value: -8, mode: 'delta', durationDays: 0 }],
    headline: 'Morre o presidente de {alvo}',
    sentiment: -0.45,
    rumorable: false,
    cooldownDays: 1460,
    priority: 8,
    topic: 'gestao',
  },
  {
    id: 'jazida',
    scope: 'empresa',
    weight: 0.5,
    when: (ctx) =>
      listed(ctx) &&
      (ctx.company?.industryId === 'mineracao' || ctx.company?.industryId === 'energia'),
    effects: [
      { target: 'company.capacity', value: 1.12, mode: 'multiply', durationDays: 0 },
      { target: 'company.reputation', value: 5, mode: 'delta', durationDays: 0 },
    ],
    headline: '{alvo} anuncia descoberta de nova jazida',
    sentiment: 0.8,
    rumorable: true,
    cooldownDays: 720,
    priority: 8,
    topic: 'mineracao',
  },
  {
    id: 'contrato-bilionario',
    scope: 'empresa',
    weight: 0.8,
    when: listed,
    effects: [{ target: 'company.capacity', value: 1.06, mode: 'multiply', durationDays: 0 }],
    headline: '{alvo} fecha contrato bilionário',
    sentiment: 0.65,
    rumorable: true,
    cooldownDays: 400,
    priority: 6,
    topic: 'negocios',
  },
  {
    id: 'patente',
    scope: 'empresa',
    weight: 0.6,
    when: (ctx) =>
      listed(ctx) &&
      (ctx.company?.industryId === 'tecnologia' || ctx.company?.industryId === 'saude'),
    effects: [
      { target: 'company.baseMargin', value: 1.05, mode: 'multiply', durationDays: 0 },
      { target: 'company.reputation', value: 6, mode: 'delta', durationDays: 0 },
    ],
    headline: '{alvo} registra patente que promete mudar o setor',
    sentiment: 0.7,
    rumorable: true,
    cooldownDays: 540,
    priority: 6,
    topic: 'tecnologia',
  },

  // --- Setor ----------------------------------------------------------------
  {
    id: 'boom-setorial',
    scope: 'setor',
    weight: 0.7,
    when: (ctx) => ctx.state.macro.cyclePhase !== 'recessao',
    effects: [{ target: 'industry.marketSize', value: 1.08, mode: 'multiply', durationDays: 0 }],
    headline: 'Demanda dispara e {alvo} vive euforia',
    sentiment: 0.6,
    rumorable: true,
    cooldownDays: 540,
    priority: 6,
    topic: 'setor',
  },
  {
    id: 'regulacao',
    scope: 'setor',
    weight: 0.8,
    when: always,
    effects: [{ target: 'industry.marketSize', value: 0.95, mode: 'multiply', durationDays: 0 }],
    headline: 'Nova regulação aperta o cerco sobre {alvo}',
    sentiment: -0.5,
    rumorable: true,
    cooldownDays: 540,
    priority: 7,
    topic: 'setor',
  },
  {
    id: 'commodity',
    scope: 'setor',
    weight: 0.9,
    when: (ctx) => ctx.industryId === 'mineracao' || ctx.industryId === 'energia',
    effects: [{ target: 'industry.marketSize', value: 1.06, mode: 'multiply', durationDays: 0 }],
    headline: 'Preço da commodity sobe e {alvo} comemora',
    sentiment: 0.55,
    rumorable: false,
    cooldownDays: 300,
    priority: 5,
    topic: 'setor',
  },

  // --- Global ---------------------------------------------------------------
  {
    id: 'quebra-banco',
    scope: 'global',
    weight: 0.25,
    when: (ctx) => ctx.state.macro.selic > 0.13 || ctx.state.macro.cyclePhase === 'recessao',
    effects: [
      { target: 'macro.confidence', value: -18, mode: 'delta', durationDays: 0 },
      { target: 'industry.marketSize', value: 0.94, mode: 'multiply', durationDays: 0 },
    ],
    headline: 'Banco médio quebra e assusta o mercado',
    sentiment: -0.9,
    rumorable: true,
    cooldownDays: 1460,
    priority: 10,
    topic: 'bancos',
  },
  {
    id: 'pandemia',
    scope: 'global',
    weight: 0.12,
    when: always,
    effects: [
      { target: 'macro.confidence', value: -25, mode: 'delta', durationDays: 0 },
      { target: 'player.health', value: -8, mode: 'delta', durationDays: 0 },
    ],
    headline: 'Surto sanitário fecha cidades e paralisa a economia',
    sentiment: -0.95,
    rumorable: true,
    cooldownDays: 3650,
    priority: 10,
    topic: 'saude',
  },
  {
    id: 'otimismo',
    scope: 'global',
    weight: 1,
    when: (ctx) => ctx.state.macro.cyclePhase === 'expansao',
    effects: [{ target: 'macro.confidence', value: 8, mode: 'delta', durationDays: 0 }],
    headline: 'Confiança do empresariado atinge maior nível em anos',
    sentiment: 0.5,
    rumorable: false,
    cooldownDays: 240,
    priority: 4,
    topic: 'macro',
  },

  // --- Jogador --------------------------------------------------------------
  {
    id: 'heranca',
    scope: 'jogador',
    weight: 0.15,
    when: (ctx) => ctx.state.player.age > 22,
    effects: [{ target: 'player.money', value: 12_000, mode: 'delta', durationDays: 0 }],
    headline: 'Herança inesperada muda a vida de {alvo}',
    sentiment: 0.6,
    rumorable: false,
    cooldownDays: 7300,
    priority: 2,
    topic: 'jogador',
  },
  {
    id: 'assalto',
    scope: 'jogador',
    weight: 0.5,
    when: (ctx) => ctx.state.player.money > 500,
    effects: [
      { target: 'player.money', value: 0.85, mode: 'multiply', durationDays: 0 },
      { target: 'player.mood', value: -12, mode: 'delta', durationDays: 0 },
    ],
    headline: '{alvo} é vítima de assalto',
    sentiment: -0.5,
    rumorable: false,
    cooldownDays: 400,
    priority: 1,
    topic: 'jogador',
  },
  {
    id: 'doenca',
    scope: 'jogador',
    weight: 0.6,
    when: (ctx) => ctx.state.player.health < 90,
    effects: [
      { target: 'player.health', value: -12, mode: 'delta', durationDays: 0 },
      { target: 'player.energy', value: -30, mode: 'delta', durationDays: 0 },
    ],
    headline: '{alvo} adoece e precisa se afastar',
    sentiment: -0.4,
    rumorable: false,
    cooldownDays: 300,
    priority: 1,
    topic: 'jogador',
  },
]

export function findEventDef(id: string): EventDef | null {
  return EVENT_DEFS.find((def) => def.id === id) ?? null
}
