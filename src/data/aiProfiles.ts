/**
 * Os 9 arquétipos da tabela do spec §5.12.
 *
 * Os pesos são os do documento, sem suavizar: é o exagero que faz o arquétipo
 * ser reconhecível. As `hardRules` são **invioláveis** e filtram o leque de
 * ações **antes** do cálculo de utilidade — elas não são penalidade, a ação nem
 * entra na lista. É isso que produz recusa a jogadas obviamente boas, e é o que
 * o critério de aceite da fase mede.
 */
import type { AIProfile, ArchetypeId } from '@/engine/types'

export const AI_PROFILES: Record<ArchetypeId, AIProfile> = {
  bandeirante: {
    id: 'bandeirante',
    name: 'Bandeirante',
    weights: { lucro: 0.15, share: 1.0, caixa: 0.05, acao: 0.25, qualidade: 0.1, influencia: 0.1, risco: 0.05 },
    hardRules: [
      { kind: 'forbid', action: 'pagarDividendos' },
      { kind: 'forbid', action: 'reduzirCapacidade' },
      // Teto de preço no menor preço do setor: nunca é o mais caro.
      { kind: 'ceiling', field: 'priceVsSectorMin', value: 1 },
    ],
    signatureMove: 'entrarEmSetor',
    conviction: 0.7,
    imitation: 0.15,
    vindictiveness: 0.45,
    cashReserveTarget: 0.05,
    minMargin: 0.01,
    headlineVoice: 'agressivo',
  },

  fortaleza: {
    id: 'fortaleza',
    name: 'Fortaleza',
    weights: { lucro: 0.7, share: 0.05, caixa: 0.9, acao: 0.35, qualidade: 0.1, influencia: 0.05, risco: 1.0 },
    hardRules: [
      // O dividendo é sagrado: paga até o caixa acabar.
      { kind: 'always', action: 'pagarDividendos', min: 0.3 },
      { kind: 'ceiling', field: 'leverage', value: 0.3 },
      // Proibido cortar preço em resposta a concorrente.
      { kind: 'floor', field: 'priceChange', value: 0 },
    ],
    signatureMove: 'recomprarAcoes',
    conviction: 0.8,
    imitation: 0.1,
    vindictiveness: 0.2,
    cashReserveTarget: 0.25,
    minMargin: 0.12,
    headlineVoice: 'sóbrio',
  },

  oficina: {
    id: 'oficina',
    name: 'Oficina',
    weights: { lucro: 0.15, share: 0.3, caixa: 0.25, acao: 0.1, qualidade: 1.0, influencia: 0.05, risco: 0.3 },
    hardRules: [
      { kind: 'floor', field: 'rndRatio', value: 0.25 },
      // Se atacada, sobe preço e qualidade em vez de brigar por preço.
      { kind: 'floor', field: 'priceChange', value: 0 },
    ],
    signatureMove: 'investirPeD',
    conviction: 0.75,
    imitation: 0.05,
    vindictiveness: 0.25,
    cashReserveTarget: 0.15,
    minMargin: 0.1,
    headlineVoice: 'técnico',
  },

  abutre: {
    id: 'abutre',
    name: 'Abutre',
    weights: { lucro: 0.6, share: 0.4, caixa: 0.8, acao: 0.2, qualidade: 0, influencia: 0.2, risco: 0.25 },
    hardRules: [
      { kind: 'floor', field: 'priceChange', value: 0 },
      { kind: 'ceiling', field: 'marketingRatio', value: 0.03 },
      { kind: 'floor', field: 'cashRatio', value: 0.4 },
    ],
    signatureMove: 'lancarOpa',
    conviction: 0.6,
    imitation: 0.2,
    vindictiveness: 0.8,
    cashReserveTarget: 0.4,
    minMargin: 0.08,
    headlineVoice: 'frio',
  },

  espelho: {
    id: 'espelho',
    name: 'Espelho',
    weights: { lucro: 0.4, share: 0.5, caixa: 0.3, acao: 0.15, qualidade: 0.05, influencia: 0.05, risco: 0.6 },
    hardRules: [
      // P&D = 0, sempre. Margem fina porque não inventa nada.
      { kind: 'ceiling', field: 'rndRatio', value: 0 },
    ],
    signatureMove: 'ajustarPreco',
    conviction: 0.3,
    imitation: 0.9,
    vindictiveness: 0.3,
    cashReserveTarget: 0.12,
    minMargin: 0.04,
    headlineVoice: 'satírico',
  },

  vitrine: {
    id: 'vitrine',
    name: 'Vitrine',
    weights: { lucro: 0.05, share: 0.3, caixa: 0.1, acao: 1.0, qualidade: 0.2, influencia: 0.15, risco: 0.1 },
    hardRules: [
      { kind: 'floor', field: 'marketingRatio', value: 0.15 },
      // Proibido admitir fracasso: nunca corta estrutura.
      { kind: 'forbid', action: 'demissaoEmMassa' },
      { kind: 'forbid', action: 'reduzirCapacidade' },
    ],
    signatureMove: 'anunciarProduto',
    conviction: 0.35,
    imitation: 0.35,
    vindictiveness: 0.55,
    cashReserveTarget: 0.08,
    minMargin: 0.03,
    headlineVoice: 'grandiloquente',
  },

  padrinho: {
    id: 'padrinho',
    name: 'Padrinho',
    weights: { lucro: 0.3, share: 0.25, caixa: 0.3, acao: 0.1, qualidade: 0, influencia: 1.0, risco: 0.2 },
    hardRules: [
      // Nunca demite: custo político.
      { kind: 'forbid', action: 'demitir' },
      { kind: 'forbid', action: 'demissaoEmMassa' },
    ],
    signatureMove: 'doar',
    conviction: 0.65,
    imitation: 0.25,
    vindictiveness: 0.6,
    cashReserveTarget: 0.18,
    minMargin: 0.06,
    headlineVoice: 'protegido',
  },

  herdeiro: {
    id: 'herdeiro',
    name: 'Herdeiro',
    weights: { lucro: 0.5, share: 0.1, caixa: 0.6, acao: 0.05, qualidade: 0.3, influencia: 0.15, risco: 0.85 },
    hardRules: [
      // Recusa qualquer OPA enquanto a família mantiver o controle (Fase 6).
      { kind: 'forbid', action: 'responderOpa' },
      { kind: 'forbid', action: 'abrirCapital' },
      // Nepotismo impõe teto de produtividade.
      { kind: 'ceiling', field: 'productivity', value: 105 },
    ],
    signatureMove: 'responderOpa',
    conviction: 0.85,
    imitation: 0.15,
    vindictiveness: 0.7,
    cashReserveTarget: 0.3,
    minMargin: 0.09,
    headlineVoice: 'ofendido',
  },

  sobrevivente: {
    id: 'sobrevivente',
    name: 'Sobrevivente',
    weights: { lucro: 0.2, share: 0.05, caixa: 1.0, acao: 0.1, qualidade: 0, influencia: 0.1, risco: 0.95 },
    hardRules: [
      // Proibido investir em qualquer coisa: toda decisão é corte.
      { kind: 'forbid', action: 'expandirCapacidade' },
      { kind: 'forbid', action: 'investirPeD' },
      { kind: 'forbid', action: 'pagarDividendos' },
      { kind: 'forbid', action: 'contratar' },
    ],
    signatureMove: 'venderDivisao',
    conviction: 0.2,
    imitation: 0.5,
    vindictiveness: 0.15,
    cashReserveTarget: 0.03,
    minMargin: 0.02,
    headlineVoice: 'defensivo',
  },
}

/** Distribuição dos arquétipos pelas 28 empresas da seed. */
export const ARCHETYPE_BY_COMPANY: Record<string, ArchetypeId> = {
  nimbo: 'bandeirante',
  vetorial: 'oficina',
  cortex: 'vitrine',
  'lumen-tech': 'espelho',

  sanare: 'fortaleza',
  vitalis: 'oficina',
  'orion-med': 'herdeiro',
  bemvida: 'sobrevivente',

  casapronta: 'bandeirante',
  mercadinho: 'fortaleza',
  trilha: 'espelho',
  'aurora-loja': 'vitrine',

  gazeta: 'herdeiro',
  'canal-sete': 'vitrine',
  radar: 'oficina',
  pulso: 'sobrevivente',

  hidrus: 'padrinho',
  ventos: 'oficina',
  'petro-costa': 'padrinho',
  solaris: 'bandeirante',

  'banco-meridiano': 'fortaleza',
  'banco-povo': 'padrinho',
  'aurora-invest': 'abutre',
  'coop-raiz': 'herdeiro',

  'ferro-norte': 'abutre',
  'serra-alta': 'bandeirante',
  'cobre-real': 'espelho',
  granito: 'sobrevivente',
}
