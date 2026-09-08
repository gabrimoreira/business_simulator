import { describe, expect, it } from 'vitest'
import { chance, createRng, floatAt, hashId, nextFloat, nextInt, nextNormal, pick, pickWeighted } from '@/engine/rng'

describe('rng', () => {
  it('é determinístico: mesma seed produz a mesma sequência', () => {
    const a = createRng(42)
    const b = createRng(42)
    const seqA = Array.from({ length: 64 }, () => nextFloat(a))
    const seqB = Array.from({ length: 64 }, () => nextFloat(b))
    expect(seqA).toEqual(seqB)
    expect(a.counter).toBe(64)
  })

  it('seeds diferentes divergem', () => {
    const a = createRng(1)
    const b = createRng(2)
    expect(nextFloat(a)).not.toBe(nextFloat(b))
  })

  it('floatAt é função pura de (seed, counter) e reproduz a sequência', () => {
    const rng = createRng(7)
    for (let counter = 0; counter < 10; counter += 1) {
      expect(nextFloat(rng)).toBe(floatAt(7, counter))
    }
  })

  it('produz valores em [0,1)', () => {
    const rng = createRng(99)
    for (let i = 0; i < 10_000; i += 1) {
      const value = nextFloat(rng)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('nextNormal consome exatamente 2 draws — contrato congelado do save', () => {
    const rng = createRng(3)
    nextNormal(rng)
    expect(rng.counter).toBe(2)
    nextNormal(rng)
    expect(rng.counter).toBe(4)
  })

  it('nextNormal tem média ~0 e desvio ~1', () => {
    const rng = createRng(2024)
    const n = 100_000
    let sum = 0
    let sumSq = 0
    for (let i = 0; i < n; i += 1) {
      const value = nextNormal(rng)
      sum += value
      sumSq += value * value
    }
    const mean = sum / n
    const sd = Math.sqrt(sumSq / n - mean * mean)
    expect(Math.abs(mean)).toBeLessThan(0.02)
    expect(Math.abs(sd - 1)).toBeLessThan(0.02)
  })

  it('nextInt respeita o intervalo e consome 1 draw', () => {
    const rng = createRng(5)
    for (let i = 0; i < 1000; i += 1) {
      const value = nextInt(rng, 3, 7)
      expect(value).toBeGreaterThanOrEqual(3)
      expect(value).toBeLessThan(7)
    }
    expect(rng.counter).toBe(1000)
  })

  it('chance converge para a probabilidade pedida', () => {
    const rng = createRng(11)
    let hits = 0
    for (let i = 0; i < 20_000; i += 1) if (chance(rng, 0.25)) hits += 1
    expect(hits / 20_000).toBeCloseTo(0.25, 2)
  })

  it('pick e pickWeighted respeitam a ordem estável da entrada', () => {
    const items = ['a', 'b', 'c']
    const a = createRng(17)
    const b = createRng(17)
    expect(pick(a, items)).toBe(pick(b, items))

    const heavy = pickWeighted(createRng(1), items, (item) => (item === 'c' ? 1000 : 0))
    expect(heavy).toBe('c')
  })

  it('hashId é estável e não consome o RNG', () => {
    expect(hashId('cmp-tech-01')).toBe(hashId('cmp-tech-01'))
    expect(hashId('cmp-tech-01')).not.toBe(hashId('cmp-tech-02'))
    expect(hashId('cmp-tech-01') % 90).toBeLessThan(90)
  })
})
