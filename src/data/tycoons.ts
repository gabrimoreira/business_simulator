/**
 * Tycoons rivais (spec §5.12).
 *
 * Jogam o mesmo jogo que o jogador: têm patrimônio, carteira, empresas
 * controladas e ambição. São o antagonista que impede o fim de jogo de virar um
 * vazio onde só se acumula dinheiro — e aparecem nas manchetes pelo nome.
 */
import type { ArchetypeId } from '@/engine/types'

export interface TycoonSeed {
  id: string
  name: string
  profileId: ArchetypeId
  /** Patrimônio inicial em R$ do ano 0. */
  wealth: number
  /** 0-1: quanto do caixa ele põe em risco por rodada. */
  ambition: number
  homeIndustryId: string
}

export const TYCOON_SEEDS: TycoonSeed[] = [
  {
    id: 'valadares',
    name: 'Otávio Valadares',
    profileId: 'abutre',
    wealth: 900_000_000,
    ambition: 0.55,
    homeIndustryId: 'mineracao',
  },
  {
    id: 'bittencourt',
    name: 'Regina Bittencourt',
    profileId: 'bandeirante',
    wealth: 600_000_000,
    ambition: 0.7,
    homeIndustryId: 'varejo',
  },
  {
    id: 'khoury',
    name: 'Fábio Khoury',
    profileId: 'fortaleza',
    wealth: 1_200_000_000,
    ambition: 0.3,
    homeIndustryId: 'bancos',
  },
]
