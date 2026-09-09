/**
 * Ativos pessoais (spec §5.10).
 *
 * Imóvel valoriza com a inflação, rende aluguel e serve de garantia. Veículo
 * deprecia e paga em humor. Luxo paga em humor e reputação — e cobra
 * notoriedade, que é o preço de aparecer.
 */
import type { PersonalAssetKind } from '@/engine/types'

export interface AssetDefinition {
  id: string
  name: string
  kind: PersonalAssetKind
  /** Preço em R$ do ano 0. */
  price: number
  /** Aluguel mensal recebido, se alugado a terceiros. */
  monthlyIncome: number
  /** Variação anual do valor: positiva valoriza, negativa deprecia. */
  annualValueChange: number
  moodBonus: number
  reputationBonus: number
  notorietyCost: number
  /** Multiplicador da recuperação do sono, quando é a moradia. */
  comfort: number
  /** Custo mensal de manutenção. */
  upkeep: number
}

export const ASSETS: AssetDefinition[] = [
  // --- Imóveis --------------------------------------------------------------
  {
    id: 'kitnet',
    name: 'Kitnet',
    kind: 'imovel',
    price: 90_000,
    monthlyIncome: 750,
    annualValueChange: 0.01,
    moodBonus: 3,
    reputationBonus: 0,
    notorietyCost: 0,
    comfort: 1.05,
    upkeep: 180,
  },
  {
    id: 'apartamento',
    name: 'Apartamento',
    kind: 'imovel',
    price: 380_000,
    monthlyIncome: 2_600,
    annualValueChange: 0.015,
    moodBonus: 8,
    reputationBonus: 2,
    notorietyCost: 0,
    comfort: 1.15,
    upkeep: 700,
  },
  {
    id: 'casa-alto-padrao',
    name: 'Casa de alto padrão',
    kind: 'imovel',
    price: 1_600_000,
    monthlyIncome: 9_000,
    annualValueChange: 0.02,
    moodBonus: 14,
    reputationBonus: 6,
    notorietyCost: 4,
    comfort: 1.3,
    upkeep: 3_200,
  },
  {
    id: 'cobertura',
    name: 'Cobertura à beira-mar',
    kind: 'imovel',
    price: 7_500_000,
    monthlyIncome: 32_000,
    annualValueChange: 0.025,
    moodBonus: 20,
    reputationBonus: 10,
    notorietyCost: 12,
    comfort: 1.45,
    upkeep: 14_000,
  },

  // --- Veículos -------------------------------------------------------------
  {
    id: 'carro-popular',
    name: 'Carro popular',
    kind: 'veiculo',
    price: 55_000,
    monthlyIncome: 0,
    annualValueChange: -0.12,
    moodBonus: 5,
    reputationBonus: 0,
    notorietyCost: 0,
    comfort: 1,
    upkeep: 350,
  },
  {
    id: 'sedan',
    name: 'Sedã executivo',
    kind: 'veiculo',
    price: 220_000,
    monthlyIncome: 0,
    annualValueChange: -0.14,
    moodBonus: 9,
    reputationBonus: 3,
    notorietyCost: 3,
    comfort: 1,
    upkeep: 900,
  },
  {
    id: 'esportivo',
    name: 'Esportivo importado',
    kind: 'veiculo',
    price: 1_200_000,
    monthlyIncome: 0,
    annualValueChange: -0.1,
    moodBonus: 16,
    reputationBonus: 4,
    notorietyCost: 15,
    comfort: 1,
    upkeep: 4_500,
  },

  // --- Luxo -----------------------------------------------------------------
  {
    id: 'relogio',
    name: 'Relógio de coleção',
    kind: 'luxo',
    price: 180_000,
    monthlyIncome: 0,
    annualValueChange: 0.03,
    moodBonus: 6,
    reputationBonus: 3,
    notorietyCost: 6,
    comfort: 1,
    upkeep: 0,
  },
  {
    id: 'arte',
    name: 'Obra de arte',
    kind: 'luxo',
    price: 900_000,
    monthlyIncome: 0,
    annualValueChange: 0.05,
    moodBonus: 8,
    reputationBonus: 8,
    notorietyCost: 10,
    comfort: 1,
    upkeep: 1_200,
  },
  {
    id: 'iate',
    name: 'Iate',
    kind: 'luxo',
    price: 6_000_000,
    monthlyIncome: 0,
    annualValueChange: -0.06,
    moodBonus: 22,
    reputationBonus: 6,
    notorietyCost: 25,
    comfort: 1,
    upkeep: 25_000,
  },
]

export function findAsset(id: string): AssetDefinition | null {
  return ASSETS.find((asset) => asset.id === id) ?? null
}
