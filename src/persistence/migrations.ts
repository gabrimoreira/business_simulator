/**
 * Pipeline de migrations do save (spec §3.5).
 *
 * Cada entrada leva o save da versão `N` para `N + 1`. A cadeia é aplicada em
 * ordem, então uma migration nunca precisa conhecer nada além da versão anterior.
 * Ao subir `SAVE_VERSION` em `src/data/config.ts`, adicione a migration aqui e o
 * teste correspondente em `tests/persistence.spec.ts`.
 */
import { SAVE_VERSION } from '@/data/config'
import { buildOwnership, seedWorld } from '@/engine/newGame'
import { INDUSTRIES } from '@/data/industries'
import { AI_PROFILES, ARCHETYPE_BY_COMPANY } from '@/data/aiProfiles'
import { TYCOON_SEEDS } from '@/data/tycoons'
import { POLITICIAN_SEEDS } from '@/data/politicians'
import { hashId } from '@/engine/rng'
import type { GameState } from '@/engine/types'

type RawSave = Record<string, unknown>

export type Migration = (save: RawSave) => RawSave

export const MIGRATIONS: Record<number, Migration> = {
  /**
   * 0 → 1: saves de desenvolvimento anteriores ao congelamento do formato não
   * tinham `meta` (New Game+ e ranking) nem `player.routine` (o avanço rápido de
   * tempo da resolução C1). Sem os dois, o app abre e quebra na primeira leitura.
   */
  0: (save) => {
    const player = (save.player ?? {}) as RawSave
    if (!Array.isArray(player.routine)) {
      player.routine = ['trabalhar', 'trabalhar', 'lazer']
    }
    if (typeof player.blocksUsedToday !== 'number') player.blocksUsedToday = 0
    save.player = player

    if (!save.meta || typeof save.meta !== 'object') {
      save.meta = {
        saveVersion: 1,
        startArchetype: 'comum',
        unlockedArchetypes: ['comum'],
        ranking: [],
        ending: null,
        companiesFoundedCount: 0,
        officesHeld: [],
      }
    }
    save.saveVersion = 1
    return save
  },

  /**
   * 1 → 2: a Fase 1 trouxe contas de casa e refeições com teto diário. Sem
   * banco até a Fase 2, a conta vencida precisa de um lugar para ficar
   * (`overdueBills`), e `mealsToday` limita o quanto se come por dia.
   */
  1: (save) => {
    const player = (save.player ?? {}) as RawSave
    if (typeof player.overdueBills !== 'number') player.overdueBills = 0
    if (typeof player.mealsToday !== 'number') player.mealsToday = 0
    save.player = player
    save.saveVersion = 2
    return save
  },

  /**
   * 2 → 3: a Fase 2 pôs a inflação para andar. Sem `priceLevel`, todo preço em
   * R$ do ano 0 ficaria congelado enquanto o salário sobe.
   */
  2: (save) => {
    const macro = (save.macro ?? {}) as RawSave
    if (typeof macro.priceLevel !== 'number') macro.priceLevel = 1
    save.macro = macro
    save.saveVersion = 3
    return save
  },

  /**
   * 3 → 4: a Fase 3 abriu a bolsa. Saves anteriores não têm empresa nenhuma, e
   * o mundo é povoado pelo mesmo `seedWorld` da partida nova — a alternativa
   * seria uma tabela paralela que sairia do ar na primeira mudança de seed.
   */
  3: (save) => {
    seedWorld(save as unknown as GameState)
    save.saveVersion = 4
    return save
  },

  /**
   * 4 → 5: a Fase 5 trocou a lista de funcionários individuais pelo quadro
   * agregado e deu ao setor um tamanho de tendência. Reparo dirigido em vez de
   * repovoar o mundo: a partir daqui o save pode conter a empresa do jogador, e
   * repovoar apagaria o trabalho dele.
   */
  4: (save) => {
    const industries = (save.industries ?? {}) as Record<string, RawSave>
    for (const industry of Object.values(industries)) {
      if (typeof industry.trendSize !== 'number') industry.trendSize = industry.marketSize
    }

    const companies = (save.companies ?? {}) as Record<string, RawSave>
    for (const company of Object.values(companies)) {
      const definition = INDUSTRIES.find((item) => item.id === company.industryId)
      if (!company.workforce && definition) {
        const revenue = typeof company.revenue === 'number' ? company.revenue : 0
        const headcount = Math.max(1, Math.round(revenue / definition.outputPerEmployee))
        company.workforce = {
          headcount,
          avgSalary: (revenue * definition.payrollRatio) / headcount,
          productivity: 100,
          morale: 70,
        }
      }
      delete company.employees
      if (typeof company.price !== 'number' || company.price <= 0) company.price = 1
      if (typeof company.capitalStock !== 'number' && definition) {
        const revenue = typeof company.revenue === 'number' ? company.revenue : 0
        company.capitalStock = revenue / definition.capitalTurnover
      }
    }

    save.saveVersion = 5
    return save
  },

  /**
   * 5 → 6: a Fase 5b deu personalidade às concorrentes. Saves anteriores não
   * têm agentes; sem eles as 28 empresas continuariam no piloto automático.
   */
  5: (save) => {
    const ai = (save.ai ?? {}) as RawSave
    ai.profiles = { ...AI_PROFILES }

    const agents = (ai.agents ?? {}) as Record<string, unknown>
    const order = Array.isArray(save.companyOrder) ? (save.companyOrder as string[]) : []
    const agentOrder: string[] = []
    for (const id of order) {
      const company = (save.companies as Record<string, RawSave> | undefined)?.[id]
      if (!company || company.managedBy === 'player') continue
      if (!agents[id]) {
        agents[id] = {
          companyId: id,
          profileId: ARCHETYPE_BY_COMPANY[id] ?? 'fortaleza',
          stress: 0,
          breakUntilDayIndex: null,
          warFatigue: 0,
          grudge: {},
          lastReviewDayIndex: -1,
          reviewOffset: hashId(id) % 90,
          cooldowns: {},
          badQuarters: 0,
          imitationTargetId: null,
        }
      }
      agentOrder.push(id)
    }
    ai.agents = agents
    ai.agentOrder = agentOrder
    save.ai = ai

    save.saveVersion = 6
    return save
  },

  /**
   * 6 → 7: a Fase 6 quebrou o bloco de controle único em acionistas
   * identificáveis. Sem isso não há de quem comprar participação relevante, e a
   * OPA do §5.6 fica sem contraparte.
   */
  6: (save) => {
    const companies = (save.companies ?? {}) as Record<string, RawSave>
    for (const [id, company] of Object.entries(companies)) {
      const ownership = company.ownership
      if (!Array.isArray(ownership)) continue
      const entries = ownership as Array<{ holderId: string; shares: number }>
      const legacy = entries.find((entry) => entry.holderId === `bloco-${id}`)
      if (!legacy) continue

      const float = entries.find((entry) => entry.holderId === 'float')
      const total = entries.reduce((sum, entry) => sum + entry.shares, 0)
      company.ownership = buildOwnership(id, total, float?.shares ?? 0)
    }
    save.saveVersion = 7
    return save
  },

  /**
   * 7 → 8: a Fase 6b trouxe os tycoons rivais e a nomeação de CEO. Saves
   * anteriores não têm rival nenhum — e sem antagonista o fim de jogo vira um
   * vazio onde só se acumula dinheiro.
   */
  7: (save) => {
    const ai = (save.ai ?? {}) as RawSave

    const agents = (ai.agents ?? {}) as Record<string, RawSave>
    for (const agent of Object.values(agents)) {
      if (typeof agent.appointedByPlayer !== 'boolean') agent.appointedByPlayer = false
    }
    ai.agents = agents

    const tycoons = (ai.tycoons ?? {}) as Record<string, unknown>
    const tycoonOrder: string[] = []
    for (const seed of TYCOON_SEEDS) {
      if (!tycoons[seed.id]) {
        tycoons[seed.id] = {
          id: seed.id,
          name: seed.name,
          profileId: seed.profileId,
          cash: seed.wealth,
          positions: {},
          positionOrder: [],
          controlledCompanyIds: [],
          politicalInfluence: 0,
          ambition: seed.ambition,
          homeIndustryId: seed.homeIndustryId,
          wealthFloor: seed.wealth * 0.2,
          targetCompanyId: null,
          lastTargetDayIndex: -1,
          grudge: {},
          lastReviewDayIndex: -1,
          notoriety: 0,
        }
      }
      tycoonOrder.push(seed.id)
    }
    ai.tycoons = tycoons
    ai.tycoonOrder = tycoonOrder
    if (!Array.isArray(ai.defenses)) ai.defenses = []
    save.ai = ai

    save.saveVersion = 8
    return save
  },

  /**
   * 8 → 9: a Fase 7 abriu o Congresso. Saves anteriores não têm político nenhum
   * — e sem casa não há quem proponha, vote ou receba doação.
   */
  8: (save) => {
    const politics = (save.politics ?? {}) as RawSave
    const politicians = (politics.politicians ?? {}) as Record<string, unknown>
    const order: string[] = []
    for (const seed of POLITICIAN_SEEDS) {
      if (!politicians[seed.id]) {
        politicians[seed.id] = {
          id: seed.id,
          name: seed.name,
          party: seed.party,
          stance: { ...seed.stance },
          approval: seed.approval,
          office: seed.office,
          loyaltyToPlayer: 0,
          donationsFromPlayer: 0,
          patronageOf: [],
        }
      }
      order.push(seed.id)
    }
    politics.politicians = politicians
    politics.politicianOrder = order
    if (!politics.policies) politics.policies = {}
    if (!Array.isArray(politics.policyOrder)) politics.policyOrder = []
    if (!Array.isArray(politics.donations)) politics.donations = []
    if (!Array.isArray(politics.lobbyEfforts)) politics.lobbyEfforts = []
    if (!Array.isArray(politics.investigations)) politics.investigations = []
    if (!Array.isArray(politics.elections)) politics.elections = []
    save.politics = politics

    save.saveVersion = 9
    return save
  },

  /**
   * 9 → 10: a Fase 8 trouxe os bens pessoais. Saves anteriores não têm a
   * estrutura, e o passo do jogador leria `undefined` na primeira virada de mês.
   */
  9: (save) => {
    const assets = (save.personalAssets ?? {}) as RawSave
    if (!Array.isArray(assets.assets)) assets.assets = []
    if (assets.residenceId === undefined) assets.residenceId = null
    if (typeof assets.monthlyRent !== 'number') assets.monthlyRent = 550
    save.personalAssets = assets

    const meta = (save.meta ?? {}) as RawSave
    if (!Array.isArray(meta.ranking)) meta.ranking = []
    if (!Array.isArray(meta.unlockedArchetypes)) meta.unlockedArchetypes = ['comum']
    if (!Array.isArray(meta.officesHeld)) meta.officesHeld = []
    save.meta = meta

    save.saveVersion = 10
    return save
  },
}

export class SaveTooNewError extends Error {
  constructor(version: number) {
    super(`Save da versão ${version} é mais novo que o app (${SAVE_VERSION}).`)
    this.name = 'SaveTooNewError'
  }
}

export class MissingMigrationError extends Error {
  constructor(version: number) {
    super(`Sem migration da versão ${version} para ${version + 1}.`)
    this.name = 'MissingMigrationError'
  }
}

/** Aplica a cadeia de migrations até `SAVE_VERSION`. */
export function migrate(raw: unknown): GameState {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('Save inválido: não é um objeto.')
  }
  const save = raw as RawSave
  let version = typeof save.saveVersion === 'number' ? save.saveVersion : 0

  if (version > SAVE_VERSION) throw new SaveTooNewError(version)

  let current = save
  while (version < SAVE_VERSION) {
    const migration = MIGRATIONS[version]
    if (!migration) throw new MissingMigrationError(version)
    current = migration(current)
    version += 1
    current.saveVersion = version
  }
  return current as unknown as GameState
}
