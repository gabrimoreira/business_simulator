/**
 * Teste de arquitetura. É o que dá dentes ao CLAUDE.md: sem ele, a separação
 * engine/UI apodrece silenciosamente em qualquer fase futura.
 *
 * Varre os arquivos de `src/engine/` como texto (comentários removidos) em vez de
 * analisar a AST — o objetivo é ser trivialmente legível e não ter dependência.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..')
const ENGINE_DIR = join(ROOT, 'src', 'engine')

function listFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listFiles(full))
    else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}

/** Remove comentários de bloco e de linha, para o scan não acusar a documentação. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function importsOf(source: string): string[] {
  const specifiers: string[] = []
  const pattern = /(?:from|import)\s+['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    if (match[1]) specifiers.push(match[1])
  }
  return specifiers
}

const engineFiles = listFiles(ENGINE_DIR)

/** Proibições da §3.1 do spec, sem exceção. */
const FORBIDDEN: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bMath\.random\b/, reason: 'Math.random — use src/engine/rng.ts' },
  { pattern: /\bDate\.now\b/, reason: 'Date.now — o tempo entra por worldTick(state, days)' },
  { pattern: /\bnew Date\b/, reason: 'new Date — o calendário é GameDate' },
  { pattern: /\bperformance\.now\b/, reason: 'performance.now' },
  { pattern: /\bfetch\s*\(/, reason: 'fetch — a engine não faz IO' },
  { pattern: /\bwindow\b/, reason: 'window' },
  { pattern: /\bdocument\b/, reason: 'document' },
  { pattern: /\blocalStorage\b/, reason: 'localStorage — persistência é IndexedDB' },
  { pattern: /\bsessionStorage\b/, reason: 'sessionStorage' },
  { pattern: /\bconsole\./, reason: 'console — a engine devolve log, não imprime' },
  { pattern: /\bsetTimeout\b|\bsetInterval\b/, reason: 'timers — o tick é chamado pela UI' },
]

const FORBIDDEN_IMPORTS = ['vue', 'pinia', 'idb', '@vueuse']

/**
 * Únicos pacotes que a engine pode importar. Immer entra porque o CLAUDE.md §2
 * exige `produce` para mutação — é biblioteca de estrutura de dados pura, sem
 * IO, sem DOM e sem relógio.
 */
const ALLOWED_PACKAGES = new Set(['immer'])

describe('arquitetura da engine', () => {
  it('encontrou arquivos para analisar', () => {
    expect(engineFiles.length).toBeGreaterThan(0)
  })

  it.each(engineFiles.map((file) => [relative(ROOT, file), file] as const))(
    '%s não usa API proibida',
    (_name, file) => {
      const source = stripComments(readFileSync(file, 'utf8'))
      const violations = FORBIDDEN.filter(({ pattern }) => pattern.test(source)).map(
        ({ reason }) => reason,
      )
      expect(violations).toEqual([])
    },
  )

  it.each(engineFiles.map((file) => [relative(ROOT, file), file] as const))(
    '%s só importa engine e data',
    (_name, file) => {
      const source = stripComments(readFileSync(file, 'utf8'))
      const bad = importsOf(source).filter((specifier) => {
        if (FORBIDDEN_IMPORTS.some((forbidden) => specifier.startsWith(forbidden))) return true
        if (ALLOWED_PACKAGES.has(specifier)) return false
        const isEngine = specifier.startsWith('./') || /^\.\.\/(?!data\/)/.test(specifier)
        const isData = specifier.startsWith('../data/') || specifier.startsWith('@/data/')
        return !isEngine && !isData
      })
      expect(bad).toEqual([])
    },
  )

  it('src/engine/ai só importa types, perception e companies', () => {
    // Exigência literal do spec §8. É por isso que os arquétipos de
    // src/data/aiProfiles.ts entram no estado via newGame e são lidos de
    // state.ai.profiles — um agente não importa a tabela de dados.
    // Fora de `ai/`, só estes três. Dentro de `ai/`, um módulo pode importar o
    // outro: a restrição do §8 é sobre não alcançar o resto do mundo, não sobre
    // o agente ser um arquivo só.
    const allowed = new Set(['../types', '../perception', '../companies'])
    const isInternal = (specifier: string): boolean => specifier.startsWith('./')
    const aiFiles = engineFiles.filter((file) => file.includes(`${join('engine', 'ai')}`))
    for (const file of aiFiles) {
      const source = stripComments(readFileSync(file, 'utf8'))
      for (const specifier of importsOf(source)) {
        const ok = allowed.has(specifier) || isInternal(specifier)
        expect(ok, `${relative(ROOT, file)} importa ${specifier}`).toBe(true)
      }
    }
  })

  it('src/ui/cues.ts é dado puro: sem Web Audio, sem DOM', () => {
    // O vocabulário sonoro está separado do tocador para poder ser testado em
    // Node sem mock. Se um `AudioContext` vazar para cá, o teste de som deixa
    // de rodar e a escolha da cue volta a ser regra sem cobertura.
    const source = stripComments(readFileSync(join(ROOT, 'src', 'ui', 'cues.ts'), 'utf8'))
    for (const forbidden of ['AudioContext', 'window', 'document', 'navigator', 'localStorage']) {
      expect(source.includes(forbidden), `cues.ts usa ${forbidden}`).toBe(false)
    }
  })

  it('engine/types.ts não importa nada', () => {
    const source = stripComments(readFileSync(join(ENGINE_DIR, 'types.ts'), 'utf8'))
    expect(importsOf(source)).toEqual([])
  })
})
