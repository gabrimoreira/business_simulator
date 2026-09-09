/**
 * Liga `flashFor` a um valor reativo: devolve a classe de pisca e a limpa
 * sozinha quando a animação acaba.
 *
 * O timer é da UI, não da engine — é o mesmo limite do `setInterval` do §3.4 do
 * spec: relógio de tela pode existir aqui, nunca como fonte de verdade.
 */
import { onUnmounted, ref, watch, type Ref } from 'vue'
import { flashFor, type FlashClass } from './motion'

/** Precisa cobrir a `--duration-slow` do CSS; abaixo disso a classe sai no meio. */
const FLASH_MS = 340

export function useFlash(source: Ref<number> | (() => number), epsilon?: number): Ref<FlashClass> {
  const flash = ref<FlashClass>(null)
  let previous: number | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  watch(
    source,
    (value) => {
      const next = flashFor(previous, value, epsilon)
      previous = value
      if (!next) return
      // Reinicia a animação quando dois valores mudam em sequência: sem o nulo
      // no meio, o navegador vê a mesma classe e não reanima.
      flash.value = null
      if (timer) clearTimeout(timer)
      requestAnimationFrame(() => {
        flash.value = next
        timer = setTimeout(() => (flash.value = null), FLASH_MS)
      })
    },
    { immediate: true },
  )

  onUnmounted(() => {
    if (timer) clearTimeout(timer)
  })

  return flash
}
