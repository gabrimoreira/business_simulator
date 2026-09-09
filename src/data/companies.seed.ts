/**
 * As 28 empresas listadas na abertura da partida (spec §5.3), quatro por setor.
 *
 * O arquivo declara **fundamentos**, não preço: receita anual, margem e número
 * de ações. O preço de abertura é derivado disso pelo múltiplo do setor em
 * `src/engine/newGame.ts`, para que nenhuma ação nasça descolada do que ela
 * ganha. `beta` e `dividendYieldTarget` são a personalidade financeira de cada
 * uma: quem oscila mais que o índice, quem paga dividendo.
 */

export interface CompanySeed {
  id: string
  name: string
  industryId: string
  /** Receita anual em R$ do ano 0. */
  revenue: number
  /** Margem operacional própria, em torno da margem do setor. */
  margin: number
  sharesOutstanding: number
  beta: number
  dividendYieldTarget: number
  /** Caixa e dívida iniciais como fração da receita anual. */
  cashRatio: number
  debtRatio: number
  reputation: number
  /** Fração do capital em circulação; o resto está com acionistas NPC. */
  floatPct: number
}

export const COMPANY_SEEDS: CompanySeed[] = [
  // --- Tecnologia (mercado R$ 18 bi) ---------------------------------------
  { id: 'nimbo', name: 'Nimbo Sistemas', industryId: 'tecnologia', revenue: 6.2e9, margin: 0.26, sharesOutstanding: 420e6, beta: 1.35, dividendYieldTarget: 0.01, cashRatio: 0.28, debtRatio: 0.12, reputation: 62, floatPct: 0.55 },
  { id: 'vetorial', name: 'Vetorial Software', industryId: 'tecnologia', revenue: 4.1e9, margin: 0.21, sharesOutstanding: 300e6, beta: 1.45, dividendYieldTarget: 0.0, cashRatio: 0.35, debtRatio: 0.08, reputation: 58, floatPct: 0.62 },
  { id: 'cortex', name: 'Córtex Digital', industryId: 'tecnologia', revenue: 3.4e9, margin: 0.18, sharesOutstanding: 260e6, beta: 1.6, dividendYieldTarget: 0.0, cashRatio: 0.22, debtRatio: 0.24, reputation: 51, floatPct: 0.7 },
  { id: 'lumen-tech', name: 'Lumen Tecnologia', industryId: 'tecnologia', revenue: 2.6e9, margin: 0.15, sharesOutstanding: 210e6, beta: 1.25, dividendYieldTarget: 0.015, cashRatio: 0.18, debtRatio: 0.3, reputation: 55, floatPct: 0.48 },

  // --- Saúde (R$ 22 bi) -----------------------------------------------------
  { id: 'sanare', name: 'Sanare Hospitais', industryId: 'saude', revenue: 8.4e9, margin: 0.15, sharesOutstanding: 520e6, beta: 0.75, dividendYieldTarget: 0.035, cashRatio: 0.15, debtRatio: 0.4, reputation: 71, floatPct: 0.45 },
  { id: 'vitalis', name: 'Vitalis Farma', industryId: 'saude', revenue: 6.1e9, margin: 0.19, sharesOutstanding: 380e6, beta: 0.7, dividendYieldTarget: 0.04, cashRatio: 0.2, debtRatio: 0.22, reputation: 68, floatPct: 0.5 },
  { id: 'orion-med', name: 'Órion Medicina', industryId: 'saude', revenue: 4.5e9, margin: 0.12, sharesOutstanding: 290e6, beta: 0.85, dividendYieldTarget: 0.025, cashRatio: 0.12, debtRatio: 0.35, reputation: 60, floatPct: 0.58 },
  { id: 'bemvida', name: 'BemVida Planos', industryId: 'saude', revenue: 3.0e9, margin: 0.1, sharesOutstanding: 240e6, beta: 0.9, dividendYieldTarget: 0.03, cashRatio: 0.1, debtRatio: 0.28, reputation: 47, floatPct: 0.66 },

  // --- Varejo (R$ 45 bi) ----------------------------------------------------
  { id: 'casapronta', name: 'Casa Pronta', industryId: 'varejo', revenue: 16.5e9, margin: 0.075, sharesOutstanding: 700e6, beta: 1.2, dividendYieldTarget: 0.03, cashRatio: 0.08, debtRatio: 0.45, reputation: 64, floatPct: 0.52 },
  { id: 'mercadinho', name: 'Rede Mercadinho', industryId: 'varejo', revenue: 12.8e9, margin: 0.06, sharesOutstanding: 610e6, beta: 1.05, dividendYieldTarget: 0.035, cashRatio: 0.06, debtRatio: 0.3, reputation: 66, floatPct: 0.44 },
  { id: 'trilha', name: 'Trilha Calçados', industryId: 'varejo', revenue: 8.9e9, margin: 0.08, sharesOutstanding: 430e6, beta: 1.3, dividendYieldTarget: 0.02, cashRatio: 0.1, debtRatio: 0.38, reputation: 57, floatPct: 0.6 },
  { id: 'aurora-loja', name: 'Aurora Magazine', industryId: 'varejo', revenue: 6.8e9, margin: 0.05, sharesOutstanding: 380e6, beta: 1.5, dividendYieldTarget: 0.01, cashRatio: 0.05, debtRatio: 0.28, reputation: 49, floatPct: 0.68 },

  // --- Mídia (R$ 6 bi) ------------------------------------------------------
  { id: 'gazeta', name: 'Grupo Gazeta', industryId: 'midia', revenue: 2.3e9, margin: 0.11, sharesOutstanding: 180e6, beta: 1.15, dividendYieldTarget: 0.03, cashRatio: 0.12, debtRatio: 0.3, reputation: 72, floatPct: 0.4 },
  { id: 'canal-sete', name: 'Canal Sete', industryId: 'midia', revenue: 1.8e9, margin: 0.1, sharesOutstanding: 150e6, beta: 1.25, dividendYieldTarget: 0.02, cashRatio: 0.09, debtRatio: 0.42, reputation: 58, floatPct: 0.46 },
  { id: 'radar', name: 'Editora Radar', industryId: 'midia', revenue: 1.1e9, margin: 0.09, sharesOutstanding: 95e6, beta: 1.1, dividendYieldTarget: 0.025, cashRatio: 0.14, debtRatio: 0.2, reputation: 63, floatPct: 0.55 },
  { id: 'pulso', name: 'Pulso Comunicação', industryId: 'midia', revenue: 0.8e9, margin: 0.07, sharesOutstanding: 70e6, beta: 1.4, dividendYieldTarget: 0.0, cashRatio: 0.07, debtRatio: 0.26, reputation: 44, floatPct: 0.72 },

  // --- Energia (R$ 30 bi) ---------------------------------------------------
  { id: 'hidrus', name: 'Hidrus Energia', industryId: 'energia', revenue: 11.2e9, margin: 0.2, sharesOutstanding: 640e6, beta: 0.8, dividendYieldTarget: 0.06, cashRatio: 0.14, debtRatio: 0.55, reputation: 69, floatPct: 0.42 },
  { id: 'ventos', name: 'Ventos do Sul', industryId: 'energia', revenue: 7.9e9, margin: 0.19, sharesOutstanding: 480e6, beta: 0.95, dividendYieldTarget: 0.045, cashRatio: 0.11, debtRatio: 0.6, reputation: 65, floatPct: 0.5 },
  { id: 'petro-costa', name: 'Petro Costa', industryId: 'energia', revenue: 6.6e9, margin: 0.17, sharesOutstanding: 400e6, beta: 1.25, dividendYieldTarget: 0.05, cashRatio: 0.16, debtRatio: 0.5, reputation: 52, floatPct: 0.38 },
  { id: 'solaris', name: 'Solaris Renováveis', industryId: 'energia', revenue: 4.3e9, margin: 0.16, sharesOutstanding: 320e6, beta: 1.1, dividendYieldTarget: 0.02, cashRatio: 0.19, debtRatio: 0.44, reputation: 74, floatPct: 0.56 },

  // --- Bancos (R$ 40 bi) ----------------------------------------------------
  { id: 'banco-meridiano', name: 'Banco Meridiano', industryId: 'bancos', revenue: 14.5e9, margin: 0.3, sharesOutstanding: 760e6, beta: 1.1, dividendYieldTarget: 0.055, cashRatio: 0.25, debtRatio: 0.7, reputation: 61, floatPct: 0.4 },
  { id: 'banco-povo', name: 'Banco do Povo', industryId: 'bancos', revenue: 11.0e9, margin: 0.27, sharesOutstanding: 620e6, beta: 1.0, dividendYieldTarget: 0.05, cashRatio: 0.22, debtRatio: 0.68, reputation: 58, floatPct: 0.45 },
  { id: 'aurora-invest', name: 'Aurora Investimentos', industryId: 'bancos', revenue: 8.7e9, margin: 0.33, sharesOutstanding: 450e6, beta: 1.35, dividendYieldTarget: 0.04, cashRatio: 0.3, debtRatio: 0.62, reputation: 66, floatPct: 0.5 },
  { id: 'coop-raiz', name: 'Cooperativa Raiz', industryId: 'bancos', revenue: 5.8e9, margin: 0.24, sharesOutstanding: 340e6, beta: 0.9, dividendYieldTarget: 0.045, cashRatio: 0.2, debtRatio: 0.58, reputation: 70, floatPct: 0.35 },

  // --- Mineração (R$ 25 bi) -------------------------------------------------
  { id: 'ferro-norte', name: 'Ferro Norte', industryId: 'mineracao', revenue: 10.4e9, margin: 0.23, sharesOutstanding: 580e6, beta: 1.4, dividendYieldTarget: 0.07, cashRatio: 0.18, debtRatio: 0.4, reputation: 46, floatPct: 0.44 },
  { id: 'serra-alta', name: 'Serra Alta Mineração', industryId: 'mineracao', revenue: 7.1e9, margin: 0.21, sharesOutstanding: 420e6, beta: 1.5, dividendYieldTarget: 0.05, cashRatio: 0.15, debtRatio: 0.46, reputation: 41, floatPct: 0.52 },
  { id: 'cobre-real', name: 'Cobre Real', industryId: 'mineracao', revenue: 4.6e9, margin: 0.18, sharesOutstanding: 300e6, beta: 1.55, dividendYieldTarget: 0.03, cashRatio: 0.12, debtRatio: 0.52, reputation: 50, floatPct: 0.6 },
  { id: 'granito', name: 'Granito Participações', industryId: 'mineracao', revenue: 2.9e9, margin: 0.15, sharesOutstanding: 220e6, beta: 1.3, dividendYieldTarget: 0.02, cashRatio: 0.1, debtRatio: 0.58, reputation: 43, floatPct: 0.64 },
]
