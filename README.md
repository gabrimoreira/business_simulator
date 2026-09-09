# Capital

Simulador de vida e negócios. Você começa aos 18 com R$ 600 e nenhuma
qualificação, e joga até os 65: trabalhe, estude, invista, funde empresas, compre
o jornal que conta a história e financie quem escreve as regras.

PWA mobile-first, **sem backend**. Vue 3 + TypeScript strict, Vite, Tailwind v4,
Pinia. Todo o estado vive em IndexedDB no aparelho — não há servidor, conta nem
telemetria.

## Rodar

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # typecheck + build de produção em dist/
npm run preview      # serve o build, que é o que vai para o ar
npx vitest run       # 261 testes, ~3,5 min
```

## O runner headless

O jogo é balanceado por simulação, não a olho. `src/sim/` roda décadas em
segundos porque `src/engine/` é TypeScript puro — sem DOM, sem relógio, sem
`Math.random`.

```bash
npm run sim -- --days 3650 --seed 42 --strategy passive
npm run sim -- --days 17520 --seed 42 --strategy entrepreneur --every 1825
```

`--strategy` aceita `passive`, `investor`, `entrepreneur`, `tycoon`, `pricewar` e
`raider`; `--every` controla de quantos em quantos dias sai uma linha do CSV.

As colunas que mais importam: `realNetWorth` (patrimônio em R$ do ano 0 — o
nominal engana em 47 anos de inflação), `job` e `salary`, `charisma`/`intel`/
`technical` (a carreira trava por skill, não por dinheiro), `empresa` (valuation
das empresas do jogador) e `health`/`mood`.

Uma partida completa dos 18 aos 65 são 17.166 dias e leva de 5 a 8 minutos.

## Onde está escrito o que

- **`CLAUDE.md`** — regras de arquitetura, não negociáveis: pureza da engine,
  ordem dos 11 passos do tick, isolamento da IA, zero número mágico. Tem teste
  de arquitetura que dá dentes a elas.
- **`docs/GAME_DESIGN.md`** — todo o balanceamento: os conflitos do spec e como
  foram resolvidos, as faixas de progressão medidas, a tabela de constantes, e o
  §7 com cada ajuste aplicado e o sintoma que o motivou.
- **`docs/DEPLOY.md`** — como publicar.

## Estado

As nove fases do plano estão fechadas: relógio e rotina, carreira e cursos,
macroeconomia e bancos, bolsa com 28 ativos, eventos e imprensa, empresa própria,
IA operacional com 9 arquétipos, participação e controle (OPA, IPO, fusão), IA
defensiva e tycoons rivais, política, ativos pessoais, ranking e New Game+, som e
animações.

### Cobertura de ações

As 66 ações da união `GameAction` têm implementação no `applyAction`, salvo três
exceções de propósito: `dormir` é automática na virada do dia (resolução C3, zero
blocos), `iniciarPartida` passa pela tela de nova partida e `avancarTempo` é
roteada para `runDays`, por contrato.

Pela interface, falta caminho para **uma**: `encerrarPartida` — desistir da
partida antes da morte ou da aposentadoria. A tela de fim existe e é acionada
pelos dois desfechos naturais; o que não há é o botão de encerrar por vontade
própria.

`tests/verbs.spec.ts` varre a união inteira e falha se qualquer ação cair no
`default` do `applyAction` — com controle negativo, para o próprio teste não
passar por engano.

### Balanceamento em aberto

`tycoon` e `raider`, no runner, ainda são cópias de `entrepreneur` e `investor`:
não adquirem, não compram jornal, não financiam político. Enquanto forem, a faixa
da `tycoon` no `GAME_DESIGN §2.1` mede ruído, e está marcado lá.
