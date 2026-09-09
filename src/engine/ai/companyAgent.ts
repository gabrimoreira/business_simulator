/**
 * Decisão operacional das empresas NPC (spec §5.12).
 *
 * O agente **nunca lê o `GameState`**: recebe o `PublicView` congelado ontem, o
 * seu próprio balanço (uma empresa conhece os próprios livros) e uma função de
 * projeção injetada pelo chamador. Só pode importar `types`, `perception` e
 * `companies` — existe teste de arquitetura para isso.
 *
 * Precedência em conflito: `hardRules` do arquétipo > guardrails globais >
 * utilidade. A quebra de personagem suspende as `hardRules` temporariamente e
 * **nunca** os guardrails.
 */
import type { AgentState, AIProfile, Company, PublicView } from '../types'
import type { CandidateOverride, Projection } from '../companies'
import {
  passesGuardrails,
  passesHardRules,
  pickBest,
  utility,
  type Candidate,
  type Guardrails,
  type SectorView,
} from './utility'

export type ProjectFn = (override: CandidateOverride) => Projection

export interface AgentInput {
  view: PublicView
  company: Company
  profile: AIProfile
  agent: AgentState
  sector: SectorView
  guardrails: Guardrails
  unitCost: number
  /** Cooldown por tipo de ação: ActionKind → dia liberado. */
  dayIndex: number
  project: ProjectFn
}

export interface Decision {
  candidate: Candidate
  score: number
}

/** Gera o leque de ações viáveis, antes de qualquer filtro. */
export function generateCandidates(company: Company, sector: SectorView, profile: AIProfile): Candidate[] {
  const price = company.price
  const marketing = company.directives.marketingRatio
  const rnd = company.directives.rndRatio
  const headcount = company.directives.headcountTarget || company.workforce.headcount

  const candidates: Candidate[] = [
    { kind: 'ajustarPreco', label: 'cortar preço', override: { price: price * 0.93 } },
    { kind: 'ajustarPreco', label: 'subir preço', override: { price: price * 1.07 } },
    { kind: 'ajustarMarketing', label: 'mais marketing', override: { marketingRatio: marketing + 0.02 } },
    { kind: 'ajustarMarketing', label: 'menos marketing', override: { marketingRatio: Math.max(0, marketing - 0.02) } },
    { kind: 'investirPeD', label: 'mais P&D', override: { rndRatio: rnd + 0.02 } },
    { kind: 'investirPeD', label: 'menos P&D', override: { rndRatio: Math.max(0, rnd - 0.02) } },
    { kind: 'expandirCapacidade', label: 'ampliar capacidade', override: { capitalAdd: Math.max(0, company.cash * 0.3) } },
    { kind: 'contratar', label: 'contratar', override: { headcountTarget: Math.ceil(headcount * 1.1) } },
    { kind: 'demitir', label: 'enxugar quadro', override: { headcountTarget: Math.max(1, Math.floor(headcount * 0.9)) } },
    { kind: 'pagarDividendos', label: 'distribuir dividendo', override: { payoutRatio: 0.4 } },
  ]

  // Jogada assinatura: o imitador copia o líder em vez de inventar.
  if (profile.imitation > 0.6) {
    candidates.push({
      kind: 'ajustarPreco',
      label: 'copiar o líder',
      override: { price: sector.leaderPrice },
    })
    candidates.push({
      kind: 'ajustarMarketing',
      label: 'copiar o marketing do líder',
      override: { marketingRatio: sector.leaderMarketingRatio },
    })
  }

  // Vitrine: anúncio grandioso que move a percepção antes do resultado.
  if (profile.signatureMove === 'anunciarProduto') {
    candidates.push({
      kind: 'anunciarProduto',
      label: 'anúncio grandioso',
      override: { marketingRatio: Math.min(0.3, marketing + 0.08) },
    })
  }

  return candidates
}

/**
 * Decide a jogada do trimestre. Devolve `null` quando o status quo vence — que
 * é o resultado mais comum, e é o que impede o setor de oscilar.
 */
export function decide(input: AgentInput): Decision | null {
  const { company, profile, agent, sector, guardrails, unitCost, dayIndex } = input

  // Quebra de personagem: as regras duras ficam suspensas por 4 trimestres.
  const broken = agent.breakUntilDayIndex !== null && dayIndex < agent.breakUntilDayIndex

  // Fadiga de guerra: acima do limiar o agente recua independentemente da
  // utilidade — é o freio que faz uma guerra de preços terminar.
  const exhausted = agent.warFatigue >= guardrails.warFatigueLimit

  const baseline = input.project({})

  const viable = generateCandidates(company, sector, profile).filter((candidate) => {
    if (agent.cooldowns[candidate.kind] !== undefined && dayIndex < agent.cooldowns[candidate.kind]!) {
      return false
    }
    if (exhausted && candidate.override.price !== undefined && candidate.override.price < company.price) {
      return false
    }
    if (!broken && !passesHardRules(profile.hardRules, candidate, company, sector)) return false
    return passesGuardrails(candidate, company, profile, guardrails, unitCost)
  })

  const baselineScore = utility(profile, baseline)
  const scored = viable.map((candidate) => ({
    candidate,
    score: utility(profile, input.project(candidate.override)),
  }))

  const damping = 1 - profile.imitation * 0.5
  const best = pickBest(scored, baselineScore, guardrails, damping)
  if (!best) return null

  const score = scored.find((item) => item.candidate === best)?.score ?? 0
  return { candidate: best, score }
}

/**
 * Regras duras do tipo `always`: obrigações que o agente cumpre fora do leque de
 * utilidade. É o que faz a Fortaleza pagar dividendo mesmo no prejuízo.
 */
export function mandatoryOverrides(profile: AIProfile, broken: boolean): CandidateOverride {
  const override: CandidateOverride = {}
  if (broken) return override

  for (const rule of profile.hardRules) {
    if (rule.kind === 'always' && rule.action === 'pagarDividendos') {
      override.payoutRatio = rule.min
    }
    if (rule.kind === 'floor' && rule.field === 'rndRatio') {
      override.rndRatio = rule.value
    }
    if (rule.kind === 'floor' && rule.field === 'marketingRatio') {
      override.marketingRatio = rule.value
    }
    if (rule.kind === 'ceiling' && rule.field === 'rndRatio') {
      override.rndRatio = rule.value
    }
    if (rule.kind === 'ceiling' && rule.field === 'marketingRatio') {
      override.marketingRatio = rule.value
    }
  }
  return override
}
