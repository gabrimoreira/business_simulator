import { describe, expect, it } from 'vitest'
import { AI_PROFILES } from '@/data/aiProfiles'
import { AI, OPERATIONS } from '@/data/config'
import { findIndustry } from '@/data/industries'
import { unitCost } from '@/engine/companies'
import { generateCandidates } from '@/engine/ai/companyAgent'
import { passesGuardrails, passesHardRules, utility } from '@/engine/ai/utility'
import type { ArchetypeId, GameState } from '@/engine/types'
import { advance, fresh, funded } from './helpers'

const SECTOR = { averagePrice: 1, minPrice: 0.95, leaderPrice: 1, leaderMarketingRatio: 0.05 }

/** Cinco anos com todos os agentes ativos. */
function played(seed = 42, days = 1825): GameState {
  return advance(funded(fresh(seed), 5_000_000), days).state
}

describe('regras duras', () => {
  it('nenhum candidato proibido passa pelo filtro do arquétipo', () => {
    const state = fresh()
    const company = state.companies['nimbo']!

    for (const profile of Object.values(AI_PROFILES)) {
      const candidates = generateCandidates(company, SECTOR, profile)
      const allowed = candidates.filter((candidate) =>
        passesHardRules(profile.hardRules, candidate, company, SECTOR),
      )
      for (const rule of profile.hardRules) {
        if (rule.kind !== 'forbid') continue
        expect(allowed.some((candidate) => candidate.kind === rule.action)).toBe(false)
      }
    }
  })

  it('a Fortaleza recusa cortar preço; o Bandeirante aceita', () => {
    const state = fresh()
    const company = state.companies['nimbo']!
    const cut = { kind: 'ajustarPreco' as const, label: 'cortar', override: { price: company.price * 0.93 } }

    expect(passesHardRules(AI_PROFILES.fortaleza.hardRules, cut, company, SECTOR)).toBe(false)
    expect(passesHardRules(AI_PROFILES.oficina.hardRules, cut, company, SECTOR)).toBe(false)
    expect(passesHardRules(AI_PROFILES.abutre.hardRules, cut, company, SECTOR)).toBe(false)
    expect(passesHardRules(AI_PROFILES.bandeirante.hardRules, cut, company, SECTOR)).toBe(true)
  })

  it('a Oficina não desce de 25% de P&D e o Espelho não sobe de zero', () => {
    const state = fresh()
    const company = state.companies['nimbo']!
    const lowRnd = { kind: 'investirPeD' as const, label: 'cortar P&D', override: { rndRatio: 0.05 } }
    const someRnd = { kind: 'investirPeD' as const, label: 'algum P&D', override: { rndRatio: 0.02 } }

    expect(passesHardRules(AI_PROFILES.oficina.hardRules, lowRnd, company, SECTOR)).toBe(false)
    expect(passesHardRules(AI_PROFILES.espelho.hardRules, someRnd, company, SECTOR)).toBe(false)
  })

  it('o Sobrevivente não investe em nada', () => {
    const state = fresh()
    const company = state.companies['nimbo']!
    const candidates = generateCandidates(company, SECTOR, AI_PROFILES.sobrevivente)
    const allowed = candidates.filter((candidate) =>
      passesHardRules(AI_PROFILES.sobrevivente.hardRules, candidate, company, SECTOR),
    )
    for (const forbidden of ['expandirCapacidade', 'investirPeD', 'pagarDividendos', 'contratar']) {
      expect(allowed.some((candidate) => candidate.kind === forbidden)).toBe(false)
    }
  })
})

describe('guardrails globais', () => {
  it('o piso duro de preço é custo unitário × (1 + margem mínima)', () => {
    const state = fresh()
    const company = state.companies['nimbo']!
    const industry = findIndustry(company.industryId)!
    const cost = unitCost(industry, company)
    const profile = AI_PROFILES.bandeirante
    const guardrails = {
      hysteresis: AI.hysteresis,
      priceRateLimit: AI.priceRateLimit,
      marketingCap: AI.marketingCap,
      warFatigueLimit: AI.warFatigueLimit,
    }

    const belowFloor = {
      kind: 'ajustarPreco' as const,
      label: 'preço suicida',
      override: { price: cost * (1 + profile.minMargin) * 0.9 },
    }
    expect(passesGuardrails(belowFloor, company, profile, guardrails, cost)).toBe(false)
  })

  it('a variação de preço por decisão respeita o rate limit', () => {
    const state = fresh()
    const company = state.companies['nimbo']!
    const guardrails = {
      hysteresis: AI.hysteresis,
      priceRateLimit: AI.priceRateLimit,
      marketingCap: AI.marketingCap,
      warFatigueLimit: AI.warFatigueLimit,
    }
    const huge = {
      kind: 'ajustarPreco' as const,
      label: 'salto',
      override: { price: company.price * 1.5 },
    }
    expect(passesGuardrails(huge, company, AI_PROFILES.bandeirante, guardrails, 0.1)).toBe(false)
  })
})

describe('comportamento em cinco anos', () => {
  const state = played()

  it('nenhum NPC pratica preço abaixo do próprio piso de margem', () => {
    for (const id of state.companyOrder) {
      const company = state.companies[id]!
      const agent = state.ai.agents[id]
      const industry = findIndustry(company.industryId)
      if (!agent || !industry || company.managedBy !== 'ai') continue
      const profile = state.ai.profiles[agent.profileId]!
      expect(company.price).toBeGreaterThanOrEqual(
        unitCost(industry, company) * (1 + profile.minMargin) * 0.999,
      )
    }
  })

  it('as diretrizes obrigatórias do arquétipo são mantidas', () => {
    for (const id of state.companyOrder) {
      const company = state.companies[id]!
      const agent = state.ai.agents[id]
      if (!agent || company.managedBy !== 'ai') continue
      // Durante a quebra de personagem as regras ficam suspensas.
      if (agent.breakUntilDayIndex !== null) continue

      if (agent.profileId === 'oficina') expect(company.directives.rndRatio).toBeGreaterThanOrEqual(0.25)
      if (agent.profileId === 'espelho') expect(company.directives.rndRatio).toBe(0)
      if (agent.profileId === 'vitrine') {
        expect(company.directives.marketingRatio).toBeGreaterThanOrEqual(0.15)
      }
      if (agent.profileId === 'abutre') expect(company.directives.marketingRatio).toBeLessThanOrEqual(0.03)
    }
  })

  it('o preço do setor não converge para um valor único', () => {
    for (const industryId of state.industryOrder) {
      const prices = state.industries[industryId]!.companyOrder
        .map((id) => state.companies[id]?.price ?? 0)
        .filter((price) => price > 0)
      if (prices.length < 3) continue
      const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length
      const spread = Math.max(...prices) - Math.min(...prices)
      expect(spread / mean).toBeGreaterThan(0.03)
    }
  })

  it('a fadiga de guerra tem teto', () => {
    for (const id of state.ai.agentOrder) {
      expect(state.ai.agents[id]!.warFatigue).toBeLessThanOrEqual(AI.warFatigueLimit + 2)
    }
  })

  it('a reavaliação é escalonada: nem todo agente decide no mesmo dia', () => {
    const offsets = new Set(state.ai.agentOrder.map((id) => state.ai.agents[id]!.reviewOffset))
    expect(offsets.size).toBeGreaterThan(5)
  })

  it('decisão de NPC vira manchete: a IA não é trabalho invisível', () => {
    const fromAgents = state.news.headlines.filter((headline) =>
      headline.eventId?.startsWith('ai-'),
    )
    expect(fromAgents.length).toBeGreaterThan(0)
  })
})

describe('distinguibilidade dos arquétipos', () => {
  it('arquétipos diferentes produzem perfis de decisão diferentes', () => {
    const state = played(7, 2555)

    /** Assinatura observável de uma empresa: o que dá para ver de fora. */
    function signature(id: string): number[] {
      const company = state.companies[id]!
      return [
        company.directives.rndRatio,
        company.directives.marketingRatio,
        company.price,
        company.marketShare,
      ]
    }

    const byArchetype = new Map<ArchetypeId, number[][]>()
    for (const id of state.ai.agentOrder) {
      const agent = state.ai.agents[id]!
      const list = byArchetype.get(agent.profileId) ?? []
      list.push(signature(id))
      byArchetype.set(agent.profileId, list)
    }

    const centroid = (rows: number[][]): number[] =>
      rows[0]!.map((_, index) => rows.reduce((sum, row) => sum + row[index]!, 0) / rows.length)

    const archetypes = [...byArchetype.keys()]
    let compared = 0
    for (let i = 0; i < archetypes.length; i += 1) {
      for (let j = i + 1; j < archetypes.length; j += 1) {
        const a = centroid(byArchetype.get(archetypes[i]!)!)
        const b = centroid(byArchetype.get(archetypes[j]!)!)
        const distance = Math.hypot(...a.map((value, index) => value - b[index]!))
        // Dois arquétipos com centróides idênticos seriam indistinguíveis.
        expect(distance).toBeGreaterThan(0.001)
        compared += 1
      }
    }
    expect(compared).toBeGreaterThan(10)
  })

  it('a utilidade ordena diferente para arquétipos diferentes', () => {
    const lucrativo = {
      revenue: 1000,
      profit: 200,
      cash: 100,
      share: 0.1,
      quality: 50,
      brand: 50,
      leverage: 0.2,
      margin: 0.2,
    }
    const dominante = {
      revenue: 1000,
      profit: 20,
      cash: 50,
      share: 0.45,
      quality: 50,
      brand: 60,
      leverage: 0.6,
      margin: 0.02,
    }

    // O Bandeirante prefere a fatia; a Fortaleza prefere o lucro e o caixa.
    expect(utility(AI_PROFILES.bandeirante, dominante)).toBeGreaterThan(
      utility(AI_PROFILES.bandeirante, lucrativo),
    )
    expect(utility(AI_PROFILES.fortaleza, lucrativo)).toBeGreaterThan(
      utility(AI_PROFILES.fortaleza, dominante),
    )
  })
})

describe('determinismo com agentes ativos', () => {
  it('duas execuções idênticas dão o mesmo estado', () => {
    expect(played(3, 400)).toEqual(played(3, 400))
  })
})

describe('capacidade e demanda continuam sãs', () => {
  it('o nível de preço do setor fica ancorado', () => {
    const state = played(11, 2555)
    for (const industryId of state.industryOrder) {
      const average = state.industries[industryId]!.averagePrice
      expect(average).toBeGreaterThan(0.5)
      expect(average).toBeLessThan(2)
    }
    void OPERATIONS
  })
})
