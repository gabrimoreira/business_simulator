/**
 * A parte do movimento que é decisão, não CSS.
 *
 * Mesma separação de `cues.ts`: aqui não há DOM nem Vue, então a regra roda no
 * vitest em Node. O CSS que executa o efeito mora em `src/style.css`.
 */

/** A classe de pisca de um valor que mudou, ou `null` se não mudou. */
export type FlashClass = 'flash-up' | 'flash-down' | null

/**
 * Compara dois valores e diz como piscar.
 *
 * Duas decisões que parecem detalhe e não são:
 *
 * - **A primeira leitura nunca pisca.** `before === null` é a montagem do
 *   componente, não uma mudança; sem isso a tela inteira acende ao abrir o app,
 *   e o jogador aprende a ignorar o pisca justo no momento em que ele deveria
 *   significar alguma coisa.
 * - **Mudança irrelevante não pisca.** Rendimento de poupança move o caixa em
 *   centavos todo dia; `epsilon` é o que separa "entrou dinheiro" de ruído de
 *   arredondamento.
 */
export function flashFor(before: number | null, after: number, epsilon = 0.005): FlashClass {
  if (before === null) return null
  const delta = after - before
  if (Math.abs(delta) <= epsilon) return null
  return delta > 0 ? 'flash-up' : 'flash-down'
}

/**
 * Fração de 0 a 1 para a barra de um vital, pronta para `scaleX`.
 *
 * Grampeia porque a engine garante [0, 100] mas a UI não deve depender disso
 * para não desenhar uma barra saindo do trilho se um vital novo aparecer.
 */
export function barScale(value: number, max = 100): number {
  if (!Number.isFinite(value) || max <= 0) return 0
  return Math.min(1, Math.max(0, value / max))
}
