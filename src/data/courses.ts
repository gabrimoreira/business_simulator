/**
 * Cursos (GAME_DESIGN §3.4). `studyDays` é medido em **blocos de estudo**, não em
 * dias de calendário: quem estuda dois blocos por dia termina na metade do tempo.
 *
 * **Custo e duração revisados depois do primeiro playtest.** A graduação pedia
 * R$ 28.000 e 1.100 blocos: com a sobra de R$ 810/mês de um atendente, eram 35
 * meses juntando dinheiro **e depois** três anos estudando todo dia. Seis anos
 * até o diploma que abre metade da escada de carreira, e o jogador desistia
 * antes — com razão. Agora são ~20 meses de poupança e menos de dois anos de
 * estudo: continua sendo um projeto de vida, deixou de ser uma parede.
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
    studyDays: 180,
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
    studyDays: 700,
    cost: 16000,
    grants: { intelligence: 20, technical: 8 },
    requires: [],
  },
  {
    id: 'pos',
    name: 'Pós-graduação',
    studyDays: 350,
    cost: 11000,
    grants: { intelligence: 12 },
    requires: ['graduacao'],
  },
  {
    id: 'mba',
    name: 'MBA',
    studyDays: 500,
    cost: 55000,
    grants: { charisma: 18, intelligence: 10 },
    requires: ['graduacao'],
  },
]

export function findCourse(id: string): CourseDefinition | null {
  return COURSES.find((course) => course.id === id) ?? null
}
