/**
 * Agrupa movimento de dinheiro por categoria legível.
 *
 * O log da engine é cronológico e carimbado pelo **sistema** que emitiu
 * (`player`, `banking`, `market`, `assets`…). Isso serve para depurar e não
 * serve para jogar: depois de avançar um mês, o resumo mostrava um número
 * líquido só, e o jogador via o caixa cair sem saber o que causou.
 *
 * Dado puro, sem Vue e sem DOM, pelo mesmo motivo de `cues.ts` e `motion.ts`:
 * a regra de classificação é o que erra, e regra que erra precisa de teste.
 */
import type { LogEntry, Money } from '@/engine/types'

export interface LedgerGroup {
  label: string
  total: Money
  lines: LogEntry[]
}

export interface Ledger {
  groups: LedgerGroup[]
  income: Money
  spent: Money
  net: Money
  /**
   * Dinheiro que só trocou de lugar, em valor absoluto.
   *
   * Comprar R$ 50 mil em ação **não é perda**: sai do caixa e entra na carteira,
   * com patrimônio idêntico. Somá-lo ao saldo fazia o balanço do mês oscilar a
   * esmo — foi a primeira coisa que o playtest apontou neste extrato.
   */
  moved: Money
  transfers: LedgerGroup[]
}

/**
 * Categoria de uma ação do jogador, lida do id.
 *
 * Toda ação entra no log com `source: 'action'` — um balde só para comida,
 * bolsa, empresa e banco —, e `LogEntry` não carrega o `kind`. O id carrega:
 * `entryFor` em `engine/actions.ts` monta `act-{dia}-{bloco}-{kind}`.
 *
 * É acoplamento a um formato de id, e por isso `tests/ledger.spec.ts` verifica
 * que o formato real da engine ainda casa com este parser. Se alguém mudar o
 * `entryFor`, o teste cai antes de o extrato começar a mentir.
 */
/**
 * A ação muda patrimônio, ou só move dinheiro entre bolsos?
 *
 * Comprar ação, depositar, sacar, aplicar, resgatar e comprar bem são
 * **transferência**: o caixa cai e outra linha do patrimônio sobe na mesma
 * medida. Tomar empréstimo também entra aqui — o dinheiro chega junto com a
 * dívida. Salário, contas, comida e juros, ao contrário, mudam o que você tem.
 *
 * Isso é o que separa "gastei" de "movi", e é a diferença entre um saldo mensal
 * que significa alguma coisa e um que dança conforme você mexe na carteira.
 */
/**
 * Fontes cujo `amount` sai **do bolso do jogador**.
 *
 * O log da engine é do **mundo**, não do jogador: `agents.ts` registra a
 * recompra defensiva de uma empresa da IA com `amount: -cost`, e somá-la ao
 * extrato pessoal fez o resumo de um mês aparecer como **−R$ 54,9 milhões**.
 * Foi exatamente a queixa do playtest — "um valor muito grande que não impacta
 * no dinheiro real que ganho e perco".
 *
 * Lista de permissão e não de exclusão: um sistema novo que passe a registrar
 * dinheiro de NPC fica de fora por omissão, que é o lado seguro de errar.
 */
const PLAYER_SOURCES = new Set([
  'action', // o que o jogador clica
  'player', // salário, contas, comida
  'banking', // parcelas, fatura
  'assets', // aluguéis e manutenção
  'market', // imposto, dividendos, chamada de margem
  'news', // assinaturas
  'politics', // multa de condenação
])

function isTransfer(id: string, source: string): boolean {
  if (source !== 'action') return false
  const kind = id.split('-').slice(3).join('-')
  return (
    kind.includes('Acao') ||
    kind.includes('Descoberto') ||
    kind === 'habilitarMargem' ||
    ['depositar', 'sacar', 'aplicar', 'resgatar'].includes(kind) ||
    kind.includes('Emprestimo') ||
    kind.includes('Ativo') ||
    kind === 'fundarEmpresa'
  )
}

function actionCategory(id: string): string | null {
  const kind = id.split('-').slice(3).join('-')
  if (!kind) return null
  if (kind === 'comer') return 'Comida'
  if (kind === 'matricular') return 'Estudos'
  if (kind.includes('Acao') || kind.includes('Descoberto') || kind === 'habilitarMargem') {
    return 'Bolsa'
  }
  if (['depositar', 'sacar', 'aplicar', 'resgatar'].includes(kind)) return 'Banco'
  if (kind.includes('Emprestimo') || kind === 'contratarCartao' || kind === 'pagarImposto') {
    return 'Banco'
  }
  if (kind.includes('Ativo') || kind === 'mudarResidencia') return 'Bens'
  if (kind === 'doar' || kind === 'fazerLobby' || kind === 'candidatarCargo') return 'Política'
  if (kind.includes('Veiculo') || kind === 'assinarVeiculo' || kind === 'definirPauta') {
    return 'Imprensa'
  }
  return 'Empresa'
}

/**
 * De qual sistema veio, em português de jogador.
 *
 * Separa **ganho de gasto dentro do mesmo sistema**: salário e contas do mês
 * saem os dois de `player`, e somá-los num grupo só devolveria o líquido — que
 * é exatamente o número inútil que este módulo existe para substituir.
 */
function labelFor(entry: LogEntry): string {
  const positive = (entry.amount ?? 0) > 0
  if (entry.source === 'action') {
    return actionCategory(entry.id) ?? (positive ? 'Outras entradas' : 'Outras saídas')
  }
  switch (entry.source) {
    case 'player':
      return positive ? 'Salário' : 'Vida e contas'
    case 'assets':
      return positive ? 'Aluguéis' : 'Manutenção de bens'
    case 'banking':
      return positive ? 'Crédito' : 'Banco e parcelas'
    case 'market':
      return positive ? 'Bolsa' : 'Bolsa e impostos'
    case 'companies':
    case 'ownership':
      return positive ? 'Empresas' : 'Empresas'
    case 'news':
      return 'Imprensa'
    default:
      return positive ? 'Outras entradas' : 'Outras saídas'
  }
}

/**
 * Monta o extrato de um lote de entradas.
 *
 * Ignora entrada sem `amount`: o log tem muita coisa que não é dinheiro
 * (promoção, manchete, evento), e misturá-las faria o extrato parecer errado.
 * Grupos saem ordenados pelo tamanho do movimento — o que mais mexeu no caixa
 * aparece primeiro, que é o que o jogador quer saber.
 */
export function ledgerFor(entries: readonly LogEntry[]): Ledger {
  const byLabel = new Map<string, LedgerGroup>()
  let income = 0
  let spent = 0

  const byTransfer = new Map<string, LedgerGroup>()
  let moved = 0

  for (const entry of entries) {
    const amount = entry.amount
    if (amount === null || amount === 0) continue
    // Dinheiro de NPC não entra no extrato de ninguém.
    if (!PLAYER_SOURCES.has(entry.source)) continue

    const label = labelFor(entry)
    const destino = isTransfer(entry.id, entry.source) ? byTransfer : byLabel
    if (destino === byTransfer) moved += Math.abs(amount)
    else if (amount > 0) income += amount
    else spent += amount

    const group = destino.get(label)
    if (group) {
      group.total += amount
      group.lines.push(entry)
    } else {
      destino.set(label, { label, total: amount, lines: [entry] })
    }
  }

  const porTamanho = (a: LedgerGroup, b: LedgerGroup) => Math.abs(b.total) - Math.abs(a.total)
  return {
    groups: [...byLabel.values()].sort(porTamanho),
    transfers: [...byTransfer.values()].sort(porTamanho),
    income,
    spent,
    moved,
    net: income + spent,
  }
}
