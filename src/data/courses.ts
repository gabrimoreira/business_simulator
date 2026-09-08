/**
 * Cursos (GAME_DESIGN §3.4). `studyDays` é medido em **blocos de estudo**, não em
 * dias de calendário: quem estuda dois blocos por dia termina na metade do tempo.
 */
import type { Skills } from '@/engine/types'

export interface CourseDefinition {
  id: string
  name: string
  /** Blocos de estudo necessários. */
  studyDays: number
  cost: number
  grants: Partial<Skills>
  /** Curso que precisa estar concluído antes. */
  requires: string[]
}

export const COURSES: CourseDefinition[] = [
  {
    id: 'oratoria',
    name: 'Oratória',
    studyDays: 90,
    cost: 1500,
    grants: { charisma: 8 },
    requires: [],
  },
  {
    id: 'tecnico',
    name: 'Curso técnico',
    studyDays: 240,
    cost: 2400,
    grants: { technical: 15 },
    requires: [],
  },
  {
    id: 'financas',
    name: 'Mercado financeiro',
    studyDays: 150,
    cost: 3500,
    grants: { intelligence: 6 },
    requires: [],
  },
  {
    id: 'graduacao',
    name: 'Graduação',
    studyDays: 1100,
    cost: 28000,
    grants: { intelligence: 20, technical: 8 },
    requires: [],
  },
  {
    id: 'pos',
    name: 'Pós-graduação',
    studyDays: 500,
    cost: 18000,
    grants: { intelligence: 12 },
    requires: ['graduacao'],
  },
  {
    id: 'mba',
    name: 'MBA',
    studyDays: 700,
    cost: 90000,
    grants: { charisma: 18, intelligence: 10 },
    requires: ['graduacao'],
  },
]

export function findCourse(id: string): CourseDefinition | null {
  return COURSES.find((course) => course.id === id) ?? null
}
