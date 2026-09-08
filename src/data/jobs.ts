/**
 * Os 10 empregos da tabela de `docs/GAME_DESIGN.md §3.3`.
 *
 * Cargos 0 a 2 não exigem diploma — é o teto de carreira da estratégia
 * `passive`, e o que sustenta o alvo de patrimônio dela no §2.1 do mesmo
 * documento. Mexer nestes salários muda a curva inteira.
 */
import type { Skills } from '@/engine/types'

export type Wear = 'baixo' | 'medio' | 'alto'

export interface JobRequirements {
  skills: Partial<Skills>
  /** Ids de cursos concluídos exigidos. */
  education: string[]
  /** Dias no emprego anterior antes de poder se candidatar. */
  minDaysInPreviousJob: number
}

export interface JobDefinition {
  id: string
  title: string
  level: number
  /** Salário mensal em BRL do ano 0. */
  salary: number
  wear: Wear
  requirements: JobRequirements
}

/** Multiplicador de energia gasta ao trabalhar, por desgaste do cargo. */
export const WEAR_ENERGY_MULTIPLIER: Record<Wear, number> = {
  baixo: 0.85,
  medio: 1,
  alto: 1.15,
}

export const JOBS: JobDefinition[] = [
  {
    id: 'atendente',
    title: 'Atendente de balcão',
    level: 0,
    salary: 1800,
    wear: 'alto',
    requirements: { skills: {}, education: [], minDaysInPreviousJob: 0 },
  },
  {
    id: 'auxiliar',
    title: 'Auxiliar administrativo',
    level: 1,
    salary: 2400,
    wear: 'medio',
    requirements: { skills: { intelligence: 20 }, education: [], minDaysInPreviousJob: 0 },
  },
  {
    id: 'encarregado',
    title: 'Encarregado de loja',
    level: 2,
    salary: 3400,
    wear: 'alto',
    requirements: { skills: { charisma: 30 }, education: [], minDaysInPreviousJob: 730 },
  },
  {
    id: 'suporte',
    title: 'Técnico de suporte',
    level: 3,
    salary: 4800,
    wear: 'medio',
    requirements: { skills: { technical: 35 }, education: ['tecnico'], minDaysInPreviousJob: 0 },
  },
  {
    id: 'analista-jr',
    title: 'Analista júnior',
    level: 4,
    salary: 7000,
    wear: 'medio',
    requirements: { skills: { intelligence: 45 }, education: ['graduacao'], minDaysInPreviousJob: 0 },
  },
  {
    id: 'desenvolvedor',
    title: 'Desenvolvedor',
    level: 5,
    salary: 11000,
    wear: 'medio',
    requirements: { skills: { technical: 55 }, education: ['graduacao'], minDaysInPreviousJob: 0 },
  },
  {
    id: 'especialista',
    title: 'Especialista sênior',
    level: 6,
    salary: 16000,
    wear: 'baixo',
    requirements: { skills: { intelligence: 65 }, education: ['graduacao'], minDaysInPreviousJob: 730 },
  },
  {
    id: 'gerente',
    title: 'Gerente',
    level: 7,
    salary: 26000,
    wear: 'alto',
    requirements: {
      skills: { charisma: 60, intelligence: 60 },
      education: ['graduacao'],
      minDaysInPreviousJob: 730,
    },
  },
  {
    id: 'diretor',
    title: 'Diretor',
    level: 8,
    salary: 55000,
    wear: 'alto',
    requirements: {
      skills: { charisma: 75, intelligence: 70 },
      education: ['graduacao', 'mba'],
      minDaysInPreviousJob: 730,
    },
  },
  {
    id: 'c-level',
    title: 'C-level',
    level: 9,
    salary: 120000,
    wear: 'alto',
    requirements: {
      skills: { charisma: 85, intelligence: 80 },
      education: ['graduacao', 'mba'],
      minDaysInPreviousJob: 1095,
    },
  },
]

export function findJob(id: string): JobDefinition | null {
  return JOBS.find((job) => job.id === id) ?? null
}
