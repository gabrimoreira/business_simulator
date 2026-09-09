/**
 * Os veículos de imprensa da tabela de `docs/GAME_DESIGN.md §3.11`.
 *
 * Os três eixos que importam: **alcance** (quanto o preço se move),
 * **credibilidade** (quanto o mercado acredita) e **lag** (quantos dias depois
 * a matéria sai). O tabloide publica rumor no mesmo dia e acerta 60% das vezes;
 * o jornal de referência publica dois dias depois e acerta 95%. É essa tensão
 * entre ser rápido e estar certo que faz o rumor valer alguma coisa.
 */

export interface NewsOutletDefinition {
  id: string
  name: string
  credibility: number
  reach: number
  publishLagDays: number
  rumorAccuracy: number
  /** Viés por assunto: setor, 'jogador', ou 'escandalo'. -1 a 1. */
  bias: Record<string, number>
  /** Só assinantes leem. */
  premium: boolean
  /** Mensalidade em R$ do ano 0. */
  monthlyCost: number
  /** Empresa listada correspondente, quando o veículo é adquirível (Fase 6). */
  companyId: string | null
}

export const NEWS_OUTLETS: NewsOutletDefinition[] = [
  {
    id: 'tabloide',
    name: 'Diário Popular',
    credibility: 35,
    reach: 85,
    publishLagDays: 0,
    rumorAccuracy: 0.6,
    bias: { escandalo: 0.9, jogador: -0.2, midia: 0.1 },
    premium: false,
    monthlyCost: 0,
    companyId: 'pulso',
  },
  {
    id: 'portal',
    name: 'Portal Agora',
    credibility: 55,
    reach: 95,
    publishLagDays: 1,
    rumorAccuracy: 0.75,
    bias: { escandalo: 0.5, tecnologia: 0.2 },
    premium: false,
    monthlyCost: 0,
    companyId: 'canal-sete',
  },
  {
    id: 'referencia',
    name: 'O Estado',
    credibility: 90,
    reach: 60,
    publishLagDays: 2,
    rumorAccuracy: 0.95,
    bias: { escandalo: 0.2, bancos: 0.1 },
    premium: false,
    monthlyCost: 0,
    companyId: 'gazeta',
  },
  {
    id: 'revista',
    name: 'Revista Capital',
    credibility: 80,
    reach: 40,
    publishLagDays: 3,
    rumorAccuracy: 0.92,
    bias: { escandalo: 0.1, energia: 0.15, mineracao: -0.1 },
    premium: false,
    monthlyCost: 0,
    companyId: 'radar',
  },
  {
    id: 'boletim',
    name: 'Boletim de Mercado',
    credibility: 85,
    reach: 30,
    publishLagDays: 0,
    rumorAccuracy: 0.9,
    bias: {},
    premium: true,
    monthlyCost: 180,
    companyId: null,
  },
]

export function findOutlet(id: string): NewsOutletDefinition | null {
  return NEWS_OUTLETS.find((outlet) => outlet.id === id) ?? null
}
