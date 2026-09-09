/**
 * O som é enfeite; a **escolha** do som é regra. Estes testes cobrem a regra.
 *
 * Nada aqui toca Web Audio: `cues.ts` é dado puro justamente para poder ser
 * testado em Node sem mock de `AudioContext`.
 */
import { describe, expect, it } from 'vitest'
import { CUES, cueFor, type CueId } from '@/ui/cues'
import type { LogEntry, LogSeverity } from '@/engine/types'
import { applyAction } from '@/engine/actions'
import { fresh, funded } from './helpers'

function entry(severity: LogSeverity): LogEntry {
  return { id: 'x', dayIndex: 0, severity, source: 'teste', text: '', amount: null }
}

describe('escolha da cue', () => {
  it('cada severidade tem um som próprio', () => {
    const ids = (['info', 'bom', 'ruim', 'critico'] as const).map((s) => cueFor([entry(s)]).id)
    expect(new Set(ids).size).toBe(4)
  })

  it('o lote soa pela entrada mais grave, não pela primeira', () => {
    expect(cueFor([entry('bom'), entry('critico'), entry('info')]).id).toBe('alerta')
    expect(cueFor([entry('info'), entry('ruim')]).id).toBe('perda')
  })

  it('log vazio é o toque comum: a ação passou e não teve o que relatar', () => {
    expect(cueFor([]).id).toBe('toque')
  })
})

describe('ação recusada soa como recusa', () => {
  // A razão de o retorno morar na store e não nos botões: antes disso a UI
  // vibrava igual para compra fechada e para compra negada.
  it('comprar sem dinheiro devolve `perda`, comprar com dinheiro não', () => {
    const poor = fresh()
    const negada = applyAction(poor, {
      kind: 'comprarAcao',
      companyId: poor.companyOrder[0]!,
      shares: 10_000,
      limitPrice: null,
    })
    expect(negada.state).toEqual(poor)
    expect(cueFor(negada.log).id).toBe('perda')

    const rico = funded(fresh(), 10_000_000)
    const aceita = applyAction(rico, {
      kind: 'comprarAcao',
      companyId: rico.companyOrder[0]!,
      shares: 10,
      limitPrice: null,
    })
    expect(cueFor(aceita.log).id).not.toBe('perda')
  })
})

describe('as cues são tocáveis', () => {
  const ids = Object.keys(CUES) as CueId[]

  it('toda cue tem nota, e nenhuma nota nasce antes do início', () => {
    for (const id of ids) {
      const cue = CUES[id]
      expect(cue.notes.length).toBeGreaterThan(0)
      for (const note of cue.notes) {
        expect(note.at).toBeGreaterThanOrEqual(0)
        expect(note.seconds).toBeGreaterThan(0)
        // Fora da banda audível de um alto-falante de celular não adianta pedir.
        expect(note.hz).toBeGreaterThan(150)
        expect(note.hz).toBeLessThan(6000)
      }
    }
  })

  // Dois orçamentos, porque são duas coisas. Cue de ação responde a um toque e
  // some antes do próximo; o arpejo de fecho toca uma vez, sobre uma tela
  // cheia, e não compete com gesto nenhum.
  it('cue de ação cabe no gesto: até 400ms', () => {
    for (const id of ids) {
      if (id === 'fim') continue
      const cue = CUES[id]
      const end = Math.max(...cue.notes.map((note) => note.at + note.seconds))
      expect(end).toBeLessThanOrEqual(0.4)
    }
  })

  it('o fecho pode respirar, mas não virar trilha: até 1,2s', () => {
    const cue = CUES.fim
    const end = Math.max(...cue.notes.map((note) => note.at + note.seconds))
    expect(end).toBeLessThanOrEqual(1.2)
  })

  it('o pico do envelope nunca chega a 1: satura e estala', () => {
    for (const id of ids) {
      expect(CUES[id].peak).toBeGreaterThan(0)
      expect(CUES[id].peak).toBeLessThan(0.5)
    }
  })

  it('o id da cue bate com a chave da tabela', () => {
    for (const id of ids) expect(CUES[id].id).toBe(id)
  })
})
