# CLAUDE.md — Regras de arquitetura (não negociáveis)

Simulador de Vida e Negócios — PWA mobile, Vue 3 + TS strict, zero backend.
Spec completo em `docs/SPEC.md`. Decisões de balanceamento em `docs/GAME_DESIGN.md`.

Este arquivo existe para que sessões futuras **não violem a separação engine/UI**.
Se algo aqui conflitar com um pedido, pare e pergunte.

---

## 1. Pureza da engine

`src/engine/` é TypeScript puro. Proibido, sem exceção:

- `import` de `vue`, `pinia`, `@vueuse/*` ou qualquer coisa de UI
- qualquer API de DOM/BOM (`window`, `document`, `navigator`, `localStorage`)
- `Date.now()`, `new Date()`, `performance.now()`
- `Math.random()`
- `fetch`, `idb`, IO de qualquer tipo
- `console.*` (a engine devolve `log`, não imprime)

O motivo é concreto: sem isso não é possível simular 3650 dias em segundos no
runner headless (`src/sim/`), e sem o runner não há como balancear.

**Aleatoriedade:** só via `src/engine/rng.ts` (mulberry32). `seed` e `counter`
vivem **dentro** do `GameState`. Nenhum RNG de módulo, nenhum estado global.
`rng.normal()` é Box-Muller e consome 2 draws do counter — mudar isso quebra
todo save existente.

**Tempo:** a engine nunca lê o relógio. A UI calcula os dias decorridos a partir
de `state.lastTickAt` e passa `days` para `worldTick`. `lastTickAt` é escrito
pela camada de persistência/UI e nunca lido pela lógica de simulação.

## 2. Contratos

```ts
applyAction(state: GameState, action: GameAction): { state: GameState; log: LogEntry[] }
worldTick(state: GameState, days: number): { state: GameState; log: DayLog[] }
```

Puras e determinísticas: mesma seed + mesma sequência de ações = estado
deep-equal, sempre. Mutação via Immer (`produce`), nunca in-place no argumento.

**Iteração estável:** nunca itere `Object.keys` / `Map` sem ordenar por id.
Ordem de iteração afeta consumo do RNG e, portanto, o determinismo.

## 3. Ordem do tick — 11 passos, imutável

`worldTick` roda **um dia por vez**, nesta ordem:

`clock → macro → events → ai → companies → market → banking → politics → news → player → perception`

- **Notícia é sempre a penúltima etapa**: ela reporta o que já aconteceu. Um
  evento que "vaza antes" é um rumor gerado no passo `events`, não uma inversão
  de ordem.
- **O passo `perception` existe para congelar o `PublicView` do dia**, que os
  agentes usarão *amanhã*. Nenhum agente lê o estado do dia em que decide. Isso
  elimina dependência circular (A reage a B que reage a A no mesmo tick) e cria
  o atraso de informação que torna manipulação de mídia viável.

Reordenar qualquer passo invalida os testes de determinismo e o balanceamento.

## 4. Isolamento da IA

`src/engine/ai/` só pode importar `types`, `perception` e `companies`.
Existe teste de arquitetura para isso.

- Agentes **nunca** leem `GameState`. Leem `PublicView` (congelado ontem).
- **Paridade de ações:** um NPC só executa ações do mesmo conjunto
  `CompanyAction` / `MarketAction` disponível ao jogador. Nenhum efeito
  exclusivo de IA, nenhum dinheiro do nada, nenhum conhecimento privilegiado
  gratuito.
- `simularTrimestre` **não duplica regra de negócio**: chama o mesmo
  `companies.ts` em modo hipotético (`projectQuarter` → `stepCompanyDay`).
- Precedência em conflito: `hardRules` do arquétipo > guardrails globais >
  utilidade. A quebra de personagem suspende `hardRules` temporariamente e
  **nunca** os guardrails globais.

## 5. Zero número mágico

Toda constante de balanceamento mora em `src/data/`. Se você digitou um número
na lógica, ele está no lugar errado. Módulos de dados: `config`, `jobs`,
`courses`, `industries`, `companies.seed`, `newsOutlets`, `politicians`,
`policies`, `events`, `assets`, `aiProfiles`, `tycoons`.

## 6. Persistência

- Só IndexedDB, via `idb`. **`localStorage` é proibido** (exceto preferências de
  UI puramente cosméticas, se surgir necessidade — nunca estado de jogo).
- Save versionado (`saveVersion`) com pipeline de migrations; migration de N-1
  para N tem teste.
- Object stores: `save` (estado) e `history` (séries de preço).
- O save é **JSON puro serializável** — sem `Date`, `Map`, `Set`, `class`,
  `undefined` em campo obrigatório. Isso é o que permite cloud save depois.
- Autosave com debounce de 500ms após cada ação e sempre em `visibilitychange`.

## 7. UI

- Vue 3 Composition API, `<script setup>`, TS strict. Sem UI kit.
- Pinia **só orquestra UI** — nenhuma regra de jogo em store.
- Tailwind. Modo escuro por padrão.
- `setInterval` existe só na UI e apenas para chamar o mesmo caminho de
  catch-up. Nunca é fonte de verdade.
- Mobile: safe-area insets, `100dvh`, alvos de toque ≥ 44px, nada dependente de
  `:hover`, pull-to-refresh e double-tap zoom bloqueados.
- Valores monetários sempre em BRL, formatados (`1,2 mi` / `3,4 bi`).
- Deploy: Vercel, `base: '/'`.

## 8. Disciplina de projeto

- **Não crie abstração sem dois usos concretos hoje.**
- Implemente na ordem: tipos → engine do sistema → testes da engine →
  persistência → UI → integração com os sistemas já existentes.
- Se um requisito do spec conflitar com outro, **pare e pergunte**. Conflitos já
  resolvidos estão registrados em `docs/GAME_DESIGN.md §1` — consulte antes de
  decidir de novo.

## 9. Checklist de fim de fase

Nenhuma fase termina sem os quatro:

```
npx vitest run
npm run build
npm run sim -- --days 3650 --seed 42 --strategy passive
npm run sim -- --days 3650 --seed 42 --strategy pricewar
```

E o relato: o que ficou faltando e o que deve dar problema na fase seguinte.
Um commit por fase.
