/**
 * Políticos e partidos (spec §5.7).
 *
 * `stance` é a posição por pauta, de -1 a 1: quanto maior, mais o político
 * empurra aquela agenda. É o que decide quais políticas ele propõe e como ele
 * vota — e é por isso que financiar o político certo importa mais que financiar
 * o mais barato.
 */

export interface PoliticianSeed {
  id: string
  name: string
  party: string
  approval: number
  office: string | null
  /** Pautas: imposto, ambiental, trabalhista, credito, protecionismo. */
  stance: Record<string, number>
}

export const POLITICIAN_SEEDS: PoliticianSeed[] = [
  {
    id: 'moraes',
    name: 'Cláudia Moraes',
    party: 'PDL',
    approval: 58,
    office: 'presidente',
    stance: { imposto: -0.3, ambiental: 0.6, trabalhista: 0.4, credito: 0.1, protecionismo: -0.2 },
  },
  {
    id: 'brandao',
    name: 'Nelson Brandão',
    party: 'PIN',
    approval: 46,
    office: 'senador',
    stance: { imposto: -0.7, ambiental: -0.5, trabalhista: -0.6, credito: 0.5, protecionismo: 0.3 },
  },
  {
    id: 'tavares',
    name: 'Iara Tavares',
    party: 'PDL',
    approval: 52,
    office: 'deputado',
    stance: { imposto: 0.2, ambiental: 0.8, trabalhista: 0.7, credito: -0.2, protecionismo: 0.1 },
  },
  {
    id: 'quirino',
    name: 'Ademar Quirino',
    party: 'PRT',
    approval: 41,
    office: 'deputado',
    stance: { imposto: -0.6, ambiental: -0.7, trabalhista: -0.3, credito: 0.6, protecionismo: 0.8 },
  },
  {
    id: 'sampaio',
    name: 'Beatriz Sampaio',
    party: 'PIN',
    approval: 49,
    office: 'senador',
    stance: { imposto: -0.4, ambiental: 0.1, trabalhista: -0.4, credito: 0.7, protecionismo: -0.5 },
  },
  {
    id: 'nogueira',
    name: 'Ruy Nogueira',
    party: 'PRT',
    approval: 37,
    office: null,
    stance: { imposto: 0.5, ambiental: 0.3, trabalhista: 0.8, credito: -0.4, protecionismo: 0.6 },
  },
]
