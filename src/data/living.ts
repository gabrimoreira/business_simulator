/**
 * Custo de vida e refeições (GAME_DESIGN §3.5).
 * Valores em BRL do ano 0; o passo de macro reajusta pela inflação nas fases
 * seguintes.
 */

export interface MealDefinition {
  id: string
  name: string
  cost: number
  hunger: number
  health: number
  mood: number
  energy: number
}

/** Comer não consome bloco de ação (resolução C3). */
export const MEALS: MealDefinition[] = [
  // Comida barata custa humor, não saúde: penalizar saúde aqui transformava a
  // única opção de quem está quebrado em morte lenta.
  { id: 'marmita', name: 'Marmita', cost: 8, hunger: 30, health: 0, mood: -1, energy: 2 },
  { id: 'normal', name: 'Refeição', cost: 20, hunger: 50, health: 0, mood: 1, energy: 5 },
  { id: 'restaurante', name: 'Restaurante', cost: 60, hunger: 60, health: 1, mood: 8, energy: 5 },
]

export function findMeal(id: string): MealDefinition | null {
  return MEALS.find((meal) => meal.id === id) ?? null
}

/** Contas debitadas no dia 10 de cada mês. */
export const MONTHLY_BILLS = {
  transport: 260,
  health: 180,
} as const
