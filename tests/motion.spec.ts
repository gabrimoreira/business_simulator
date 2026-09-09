/**
 * O que é testável em animação: a **decisão** de animar, e as regras que a
 * folha de estilo tem de continuar respeitando.
 *
 * O resto — se ficou bonito, se ficou fluido — não cabe em asserção e foi
 * verificado no navegador.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { barScale, flashFor } from '@/ui/motion'

const CSS = readFileSync(resolve(__dirname, '..', 'src', 'style.css'), 'utf8')

/**
 * O CSS sem o bloco de `prefers-reduced-motion`.
 *
 * Aquele bloco existe justamente para escrever `1ms` na mão em tudo — é a
 * exceção que anula o resto, e varrê-lo junto faria a regra reprovar a própria
 * correção que ela quer garantir.
 */
const CSS_SEM_EXCECAO = CSS.replace(
  /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/g,
  '',
)

describe('pisca de valor', () => {
  it('a primeira leitura não pisca: montar não é mudar', () => {
    expect(flashFor(null, 1000)).toBe(null)
  })

  it('sobe e desce ganham classes diferentes', () => {
    expect(flashFor(100, 140)).toBe('flash-up')
    expect(flashFor(140, 100)).toBe('flash-down')
  })

  it('centavo de rendimento não pisca', () => {
    // Sem isto o caixa acende todo dia por causa do juro da poupança, e o
    // jogador para de ver o pisca que significa alguma coisa.
    expect(flashFor(1000, 1000.004)).toBe(null)
    expect(flashFor(1000, 1000.5)).toBe('flash-up')
  })

  it('valor igual não pisca', () => {
    expect(flashFor(1000, 1000)).toBe(null)
  })
})

describe('barra de vital', () => {
  it('mapeia 0–100 para 0–1', () => {
    expect(barScale(0)).toBe(0)
    expect(barScale(50)).toBe(0.5)
    expect(barScale(100)).toBe(1)
  })

  it('grampeia fora do intervalo e sobrevive a lixo', () => {
    expect(barScale(-20)).toBe(0)
    expect(barScale(180)).toBe(1)
    expect(barScale(Number.NaN)).toBe(0)
    expect(barScale(50, 0)).toBe(0)
  })
})

describe('regras da folha de estilo', () => {
  it('respeita prefers-reduced-motion', () => {
    // Quem pede menos movimento recebe menos movimento. Se este bloco sumir, a
    // tela volta a deslizar a cada toque para quem não pode com isso.
    expect(CSS).toContain('prefers-reduced-motion: reduce')
  })

  it('nenhuma transição anima largura, altura ou posição', () => {
    // Só `transform` e `opacity` rodam no compositor; as outras forçam layout a
    // cada quadro e derrubam quadro em lista longa no celular.
    const propriedades = [...CSS.matchAll(/transition:\s*([^;]+);/g)].flatMap((match) =>
      match[1]!
        .split(',')
        .map((part) => part.trim().split(/\s+/)[0]!)
        .filter(Boolean),
    )
    expect(propriedades.length).toBeGreaterThan(0)
    const permitidas = new Set(['transform', 'opacity', 'color', 'background-color', 'none'])
    expect(propriedades.filter((name) => !permitidas.has(name))).toEqual([])
  })

  it('as durações vivem em token, não espalhadas na regra', () => {
    // Duração escrita à mão numa regra é o começo de seis velocidades
    // diferentes na mesma tela.
    for (const token of ['--duration-quick', '--duration-base', '--duration-slow']) {
      expect(CSS).toContain(token)
    }
    const cruas = [...CSS_SEM_EXCECAO.matchAll(/(?:transition|animation)[^;]*?\b(\d+)ms/g)].map(
      (m) => m[1],
    )
    expect(cruas).toEqual([])
  })
})
