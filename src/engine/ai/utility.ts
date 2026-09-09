/**
 * Função de utilidade e filtro de regras duras (spec §5.12).
 *
 * **Este arquivo não pode importar nada além de `types`, `perception` e
 * `companies`** — é a regra de arquitetura que garante que nenhum agente leia o
 * `GameState`. Constantes de guardrail e a projeção chegam por parâmetro, e o
 * teste de arquitetura verifica os imports.
 */
import type {
  ActionKind,
  AIProfile,
  Company,
  HardRule,
} from '../types'
import type { Projection } from '../companies'

/** Guardrails globais, iguais para todos e nunca suspensos. */
export interface Guardrails {
  hysteresis: number
  priceRateLimit: number
  marketingCap: number
  warFatigueLimit: number
}

/** Um candidato é uma ação com os parâmetros já resolvidos. */
export interface Candidate {
  kind: ActionKind
  label: string
  override: {
    price?: number
    marketingRatio?: number
    rndRatio?: number
    headcountTarget?: number
    capitalAdd?: number
    payoutRatio?: number
  }
}

/** Estado do setor que o agente enxerga — tudo público. */
export interface SectorView {
  averagePrice: number
  minPrice: number
  /** Empresa de maior participação divulgada; alvo do imitador. */
  leaderPrice: number
  leaderMarketingRatio: number
}

/**
 * Aplica as `hardRules` do arquétipo. Elas **não são penalidade**: a ação nem
 * entra na lista de candidatos. É o que faz o arquétipo produzir recusa a
 * jogada obviamente boa — e é o que o critério de distinguibilidade mede.
 */
export function passesHardRules(
  rules: HardRule[],
  candidate: Candidate,
  company: Company,
  sector: SectorView,
): boolean {
  for (const rule of rules) {
    if (rule.kind === 'forbid' && rule.action === candidate.kind) return false

    if (rule.kind === 'ceiling') {
      if (rule.field === 'marketingRatio' && candidate.override.marketingRatio !== undefined) {
        if (candidate.override.marketingRatio > rule.value) return false
      }
      if (rule.field === 'rndRatio' && candidate.override.rndRatio !== undefined) {
        if (candidate.override.rndRatio > rule.value) return false
      }
      if (rule.field === 'priceVsSectorMin' && candidate.override.price !== undefined) {
        // Nunca acima do menor preço do setor.
        if (candidate.override.price > sector.minPrice * rule.value) return false
      }
      if (rule.field === 'leverage' && candidate.override.capitalAdd) {
        const revenue = company.revenue || 1
        if ((company.debt + candidate.override.capitalAdd) / revenue > rule.value) return false
      }
    }

    if (rule.kind === 'floor') {
      if (rule.field === 'rndRatio' && candidate.override.rndRatio !== undefined) {
        if (candidate.override.rndRatio < rule.value) return false
      }
      if (rule.field === 'marketingRatio' && candidate.override.marketingRatio !== undefined) {
        if (candidate.override.marketingRatio < rule.value) return false
      }
      if (rule.field === 'priceChange' && candidate.override.price !== undefined) {
        // Proibido cortar preço, mesmo sob ataque.
        if (candidate.override.price - company.price < rule.value) return false
      }
      if (rule.field === 'cashRatio' && candidate.override.capitalAdd) {
        const revenue = company.revenue || 1
        if ((company.cash - candidate.override.capitalAdd) / revenue < rule.value) return false
      }
    }
  }
  return true
}

/** Guardrails globais. Valem sempre — nem a quebra de personagem os suspende. */
export function passesGuardrails(
  candidate: Candidate,
  company: Company,
  profile: AIProfile,
  guardrails: Guardrails,
  unitCost: number,
): boolean {
  if (candidate.override.price !== undefined) {
    const change = Math.abs(candidate.override.price / company.price - 1)
    if (change > guardrails.priceRateLimit) return false
    // Piso duro: preço ≥ custo unitário × (1 + margem mínima).
    if (candidate.override.price < unitCost * (1 + profile.minMargin)) return false
  }

  if (candidate.override.marketingRatio !== undefined) {
    if (candidate.override.marketingRatio > guardrails.marketingCap) return false
  }

  if (candidate.override.capitalAdd) {
    const reserve = company.revenue * profile.cashReserveTarget
    if (company.cash - candidate.override.capitalAdd < reserve) return false
  }

  return true
}

/**
 * Utilidade de um **estado projetado**, não de um delta.
 *
 * O spec §5.12 compara `U(candidato) > U(statusQuo) × (1 + histerese)` — um
 * limiar **relativo**. Pontuar deltas contra um limiar absoluto, como fiz na
 * primeira versão, fazia todo candidato ficar abaixo de 0,03 e o agente nunca
 * mudava nada: as 28 empresas passaram cinco anos com o mesmo preço.
 *
 * Os termos de qualidade e influência existem para que nem todo agente esteja
 * maximizando lucro. Sem eles, todos os arquétipos convergem para o mesmo
 * comportamento com sotaques diferentes.
 */
export function utility(profile: AIProfile, projection: Projection): number {
  const w = profile.weights
  const quarterRevenue = Math.max(1, projection.revenue / 4)

  const lucro = projection.profit / quarterRevenue
  const share = projection.share
  const caixa = projection.cash / Math.max(1, projection.revenue)
  const acao = projection.margin
  const qualidade = (projection.quality + projection.brand) / 200
  const risco = projection.leverage + Math.max(0, -projection.margin)

  return (
    w.lucro * lucro +
    w.share * share +
    w.caixa * caixa +
    w.acao * acao +
    w.qualidade * qualidade -
    w.risco * risco
  )
}

/**
 * Escolhe o melhor candidato, mas só troca o status quo se o ganho **relativo**
 * superar a histerese — sem isso duas empresas ficam alternando decisão para
 * sempre.
 *
 * O amortecimento por `imitation` reduz a magnitude da reação, para o setor não
 * convergir para um preço único.
 */
export function pickBest(
  scored: Array<{ candidate: Candidate; score: number }>,
  baseline: number,
  guardrails: Guardrails,
  imitationDamping: number,
): Candidate | null {
  let best: { candidate: Candidate; score: number } | null = null
  for (const item of scored) {
    if (!best || item.score > best.score) best = item
  }
  if (!best) return null

  const required = baseline >= 0
    ? baseline * (1 + guardrails.hysteresis / imitationDamping)
    : baseline * (1 - guardrails.hysteresis / imitationDamping)

  return best.score > required ? best.candidate : null
}
