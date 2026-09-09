/**
 * Políticas públicas e seus efeitos em parâmetros globais (spec §5.7).
 *
 * O efeito de uma política aprovada é **recalculado a partir do conjunto de
 * aprovadas**, nunca somado incrementalmente ao estado — assim revogar uma
 * política devolve o mundo ao lugar certo, e um save carregado não acumula
 * efeito duas vezes.
 */
import type { MacroDelta } from '@/engine/types'

export interface PolicyDefinition {
  id: string
  name: string
  /** Pauta a que a política pertence; casa com o `stance` do político. */
  topic: string
  effects: MacroDelta
  /** Setores beneficiados — alimenta notoriedade se você tiver empresa neles. */
  beneficiaryIndustryIds: string[]
  /** Apoio inicial na tramitação, 0 a 1. */
  baseSupport: number
  /** Dias de tramitação até a votação. */
  debateDays: number
}

export const POLICY_DEFS: PolicyDefinition[] = [
  {
    id: 'reforma-tributaria',
    name: 'Reforma tributária ampla',
    topic: 'imposto',
    effects: {
      taxRateByIndustry: {
        tecnologia: -0.05,
        saude: -0.05,
        varejo: -0.05,
        midia: -0.04,
        energia: -0.04,
        bancos: -0.03,
        mineracao: -0.04,
      },
    },
    beneficiaryIndustryIds: [],
    baseSupport: 0.35,
    debateDays: 270,
  },
  {
    id: 'incentivo-tecnologia',
    name: 'Incentivo fiscal à tecnologia',
    topic: 'imposto',
    effects: {
      taxRateByIndustry: { tecnologia: -0.1 },
      subsidyByIndustry: { tecnologia: 0.02 },
    },
    beneficiaryIndustryIds: ['tecnologia'],
    baseSupport: 0.4,
    debateDays: 180,
  },
  {
    id: 'aperto-ambiental',
    name: 'Endurecimento da regra ambiental',
    topic: 'ambiental',
    effects: { taxRateByIndustry: { mineracao: 0.07, energia: 0.05 } },
    beneficiaryIndustryIds: [],
    baseSupport: 0.3,
    debateDays: 240,
  },
  {
    id: 'subsidio-energia',
    name: 'Subsídio à geração de energia',
    topic: 'ambiental',
    effects: { subsidyByIndustry: { energia: 0.04 } },
    beneficiaryIndustryIds: ['energia'],
    baseSupport: 0.45,
    debateDays: 150,
  },
  {
    id: 'tarifa-importacao',
    name: 'Tarifa sobre importados',
    topic: 'protecionismo',
    effects: { importTariffByIndustry: { varejo: 0.12, mineracao: 0.08 } },
    beneficiaryIndustryIds: ['varejo', 'mineracao'],
    baseSupport: 0.35,
    debateDays: 180,
  },
  {
    id: 'credito-facilitado',
    name: 'Crédito facilitado ao consumo',
    topic: 'credito',
    effects: { creditLooseness: 0.2, taxRateByIndustry: { bancos: -0.03 } },
    beneficiaryIndustryIds: ['bancos', 'varejo'],
    baseSupport: 0.4,
    debateDays: 120,
  },
  {
    id: 'meta-inflacao',
    name: 'Meta de inflação mais dura',
    topic: 'credito',
    effects: { inflationTarget: -0.012 },
    beneficiaryIndustryIds: ['bancos'],
    baseSupport: 0.35,
    debateDays: 210,
  },
  {
    id: 'reforma-trabalhista',
    name: 'Flexibilização trabalhista',
    topic: 'trabalhista',
    effects: {
      taxRateByIndustry: { varejo: -0.04, saude: -0.03, midia: -0.03 },
    },
    beneficiaryIndustryIds: ['varejo', 'saude'],
    baseSupport: 0.3,
    debateDays: 300,
  },
  {
    id: 'saude-publica',
    name: 'Ampliação da saúde pública',
    topic: 'trabalhista',
    effects: { subsidyByIndustry: { saude: 0.05 }, taxRateByIndustry: { bancos: 0.03 } },
    beneficiaryIndustryIds: ['saude'],
    baseSupport: 0.5,
    debateDays: 240,
  },
]

export function findPolicyDef(id: string): PolicyDefinition | null {
  return POLICY_DEFS.find((policy) => policy.id === id) ?? null
}
