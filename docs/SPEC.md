# SPEC — Simulador de Vida e Negócios (PWA mobile)

> Documento mestre. Cole no Claude Code como contexto inicial e salve como
> `docs/SPEC.md` no repositório. A implementação é **faseada** — as instruções
> de execução estão no final.

---

## 1. Visão

Jogo single-player de simulação de vida e negócios, inspirado em Business
Simulator 3, rodando 100% no navegador como PWA mobile-first, sem backend.

O jogador começa sem dinheiro e sem qualificação. Trabalha, estuda, sobe de
carreira, investe na bolsa, funda empresas, abre capital, adquire concorrentes,
compra jornais para manipular a narrativa e financia políticos para mudar as
regras do jogo. O objetivo final é acumular patrimônio e poder até a
aposentadoria.

**Princípio de design central:** todo sistema deve afetar pelo menos dois
outros. Nada de tela isolada.

---

## 2. Stack obrigatória

- **Vue 3** (Composition API, `<script setup>`) + **TypeScript strict**
- **Vite**
- **Pinia** — apenas orquestração de UI
- **Tailwind CSS**
- **Immer** — mutações imutáveis legíveis no estado grande
- **lightweight-charts** (TradingView) — gráficos de candle, ~45kb, ótimo em touch
- **idb** — persistência em IndexedDB (NUNCA localStorage)
- **vite-plugin-pwa** — service worker offline-first
- **Vitest** — testes da engine
- Deploy: estático (Vercel ou GitHub Pages). Zero backend, zero custo.

Sem dependências de UI kit. Sem backend nesta versão. Cloud save via Supabase
fica fora de escopo (mas o formato de save deve ser serializável em JSON puro
para permitir isso depois).

---

## 3. Arquitetura obrigatória

### 3.1 Separação engine / UI

`src/engine/` é **TypeScript puro**. Nenhum import de Vue, Pinia, DOM,
`Date.now()`, `Math.random()` ou `fetch`. Essa regra não tem exceção — ela é o
que permite simular 10 anos de jogo em segundos para balancear.

```
src/
  engine/
    types.ts            # GameState e todos os tipos de domínio
    rng.ts              # mulberry32; seed e counter vivem DENTRO do GameState
    clock.ts            # calendário: dia/mês/ano, trimestres, feriados
    macro.ts            # ciclo econômico, Selic, inflação, confiança
    market.ts           # precificação de ações, ordens, carteira
    companies.ts        # operação de empresas (própria e de terceiros)
    ownership.ts        # participação acionária, controle, M&A, IPO
    banking.ts          # contas, crédito, empréstimos, score
    news.ts             # geração de manchetes, veículos, credibilidade
    politics.ts         # reputação, doações, lobby, eleições, políticas
    player.ts           # stats, energia, carreira, educação
    events.ts           # eventos aleatórios e catálogo de efeitos
    perception.ts       # PublicView — snapshot de informação pública p/ agentes
    ai/
      profiles.ts       # arquétipos de comportamento
      utility.ts        # função de utilidade e projeção de ações
      companyAgent.ts   # decisão operacional e defensiva das empresas NPC
      tycoonAgent.ts    # rivais que investem, adquirem e disputam política
      institutions.ts   # pressão agregada de fundos sobre os preços
    tick.ts             # worldTick — orquestra tudo em ordem determinística
    actions.ts          # applyAction(state, action) => { state, log }
    selectors.ts        # derivações: patrimônio, renda, P/L, exposição
  data/                 # tabelas de balanceamento (ver §4)
  persistence/          # save versionado + migrations
  stores/               # Pinia
  components/
  views/
  sim/                  # runner headless de balanceamento
```

### 3.2 Contratos da engine

```ts
applyAction(state: GameState, action: GameAction): { state: GameState; log: LogEntry[] }
worldTick(state: GameState, days: number): { state: GameState; log: DayLog[] }
```

Ambas puras e determinísticas. Mesma seed + mesma sequência de ações = mesmo
resultado, sempre. Isso deve ter teste.

### 3.3 Ordem do tick (crítica — não alterar)

`worldTick` executa **um dia por vez**, nesta ordem fixa:

1. `clock` — avança data, dispara marcos (fim de trimestre, eleição, vencimento)
2. `macro` — atualiza ciclo, Selic, inflação, índice de confiança
3. `events` — sorteia eventos do mundo, empilha `WorldEvent[]`
4. `ai` — agentes NPC decidem, lendo **o `PublicView` congelado ontem** (§5.12)
5. `companies` — receita, custos, lucro, caixa, moral, P&D de todas as empresas
6. `market` — recalcula preços a partir de macro + fundamentos + eventos + ruído
7. `banking` — juros de aplicações e dívidas, parcelas, margin call
8. `politics` — aprovação, tramitação de políticas, apuração de eleição
9. `news` — converte `WorldEvent[]` da rodada em manchetes por veículo
10. `player` — energia, saúde, humor, fome, salário, envelhecimento
11. `perception` — congela o `PublicView` do dia, que os agentes usarão amanhã

Notícia é **sempre a última etapa** antes da percepção: ela reporta o que já
aconteceu. Um evento que "vaza antes" é modelado como rumor gerado no passo 3,
não como inversão de ordem.

O passo 11 existe para garantir que nenhum agente leia o estado do mesmo dia em
que decide. Isso elimina dependência circular (A reage a B que reage a A no
mesmo tick) e cria o atraso de informação que torna manipulação de mídia viável.

### 3.4 Tempo real vs tempo de jogo

- 1 tick = 1 dia de jogo.
- `state.lastTickAt: number` (epoch ms). Ao montar o app, calcula dias
  decorridos usando `MS_PER_GAME_DAY` de `data/config.ts` (default: 4 minutos
  reais = 1 dia).
- Progresso offline com **teto de 3 dias**. Ao voltar, modal "Enquanto você
  esteve fora" com o log resumido.
- `setInterval` só existe na UI, e apenas para chamar o mesmo caminho de
  catch-up. Nunca é fonte de verdade.

### 3.5 Persistência

- Save versionado (`saveVersion: number`) com pipeline de migrations.
- Dois object stores: `save` (estado) e `history` (séries de preço).
- Histórico de preço com janela deslizante de 365 dias por ativo; agrega em
  candles semanais o que for mais antigo.
- Autosave com debounce de 500ms após cada ação, e sempre no `visibilitychange`.
- Export/import de save em JSON (botão no menu) — útil pra debug e pra você.

---

## 4. Balanceamento em dados

Nenhum número mágico na lógica. Tudo em `src/data/`:

- `config.ts` — constantes globais, velocidade do tempo, tetos
- `jobs.ts` — empregos, requisitos, salário, desgaste
- `courses.ts` — cursos, duração, custo, skills concedidas
- `industries.ts` — setores: margem base, sensibilidade a juros, sazonalidade
- `companies.seed.ts` — ~28 empresas fictícias iniciais
- `newsOutlets.ts` — veículos de imprensa
- `politicians.ts` — políticos, partidos, pautas
- `policies.ts` — políticas públicas e seus efeitos em parâmetros macro
- `events.ts` — catálogo de eventos com pré-condições, pesos e efeitos
- `assets.ts` — imóveis, veículos, itens de luxo
- `aiProfiles.ts` — arquétipos de comportamento e pesos da função de utilidade
- `tycoons.ts` — rivais nomeados, patrimônio inicial, ambição e setor de origem

---

## 5. Sistemas

### 5.1 Jogador

```ts
interface Player {
  name: string
  age: number                  // começa em 18
  money: number
  energy: number               // 0-100
  health: number               // 0-100
  mood: number                 // 0-100
  hunger: number               // 0-100
  skills: { intelligence: number; charisma: number; technical: number; fitness: number } // 0-100
  education: string[]          // ids de cursos concluídos
  currentJobId: string | null
  creditScore: number          // 0-1000
  publicReputation: number     // -100 a 100
  notoriety: number            // 0-100, atenção da mídia e do fisco
}
```

**Blocos de ação:** 3 por dia. Cada ação consome blocos e energia.
Trabalhar, dormir, comer, academia, lazer, estudar, socializar (ganha
contatos), operar na bolsa (grátis, não consome bloco), gerir empresa
(1 bloco por empresa gerida).

**Consequências:** energia 0 bloqueia ações. Saúde 0 = fim de jogo. Fome 0
drena saúde. Humor baixo aplica penalidade multiplicativa em produtividade e
em decisões de gestão.

**Carreira:** progressão de ~10 empregos com requisitos de skill e diploma.
Salário reajustado pela inflação. Promoção exige tempo + skill + desempenho.

### 5.2 Macroeconomia

```ts
interface MacroState {
  cyclePhase: 'expansao' | 'pico' | 'recessao' | 'recuperacao'
  cycleDayCounter: number
  selic: number            // taxa básica anual, ex 0.1075
  inflation: number        // anual
  confidence: number       // 0-100
  marketIndex: number      // índice geral da bolsa
  unemployment: number
}
```

- Ciclo com duração variável (2 a 7 anos), transições probabilísticas.
- Banco central reage: inflação acima da meta → sobe Selic; recessão → corta.
- Selic é o parâmetro mais importante do jogo. Ela define: rendimento de renda
  fixa, custo de empréstimo, desconto no valuation das ações, custo de dívida
  das empresas.
- Políticas aprovadas (§5.7) deslocam meta de inflação, impostos e subsídios.

### 5.3 Bolsa de valores

~28 empresas listadas em 7 setores (tecnologia, bancos, energia, varejo,
mineração, saúde, mídia).

```ts
interface Stock {
  companyId: string
  price: number
  sharesOutstanding: number
  beta: number                 // sensibilidade ao índice
  volatility: number
  dividendYieldTarget: number
  history: Candle[]
}
```

**Precificação diária** (implementar exatamente assim, ajustando constantes em
`config.ts`):

```
fundamentalValue = (lucroAnualizado * multiploSetorial) / sharesOutstanding
  onde multiploSetorial cai quando a Selic sobe

drift        = clamp((fundamentalValue - price) / price, -0.05, 0.05) * meanReversionRate
marketMove   = beta * variacaoDiariaDoIndice
eventShock   = soma dos choques de eventos/notícias aplicáveis hoje
noise        = rng.normal() * volatility

retornoDia   = drift + marketMove + eventShock + noise
price        = max(0.01, price * (1 + retornoDia))
```

Empresa com caixa negativo por N trimestres seguidos vai a recuperação
judicial; ação despenca e pode ser deslistada (posição do jogador zera).

**Ordens:** mercado e limite. Corretagem fixa + percentual. Ordem limite fica
em livro e executa no tick em que o preço cruzar. Sem book de ofertas real —
liquidez é modelada como volume diário máximo negociável por ativo (ordens
grandes têm *slippage* proporcional ao volume).

**Carteira:** preço médio, P&L realizado e não realizado, dividendos
trimestrais creditados em caixa, imposto de 15% sobre lucro realizado
(recolhido no fim do mês, gera pendência se não houver caixa).

**Fase tardia:** venda a descoberto e conta margem, com margin call automático
quando a garantia cai abaixo do mínimo.

### 5.4 Bancos

```ts
interface BankAccount { bankId: string; checking: number; savings: number; savingsRate: number }
interface Loan { id: string; principal: number; rate: number; termDays: number; remaining: number; collateral?: AssetRef }
```

- 4 bancos com perfis diferentes (taxa, exigência de score, limite).
- Poupança/CDB rende `selic * fator do banco`, creditado diariamente.
- Empréstimo pessoal, capital de giro (para empresas), financiamento
  imobiliário e cartão de crédito com rotativo punitivo.
- **Score de crédito** (0-1000) sobe com pagamento em dia e renda estável, cai
  com atraso, alta alavancagem e falência. Define taxa e limite ofertados.
- Inadimplência → cobrança → tomada de garantia → queda de reputação pública.
- Bancos são também empresas listadas: crise de crédito afeta o setor inteiro.

### 5.5 Empresas (tipo unificado)

```ts
interface Company {
  id: string
  name: string
  industryId: string
  isPublic: boolean
  founded: GameDate
  cash: number
  debt: number
  revenue: number; costs: number; lastQuarterProfit: number
  employees: Employee[]
  productQuality: number      // 0-100
  brandAwareness: number      // 0-100
  rndLevel: number
  price: number               // preço do produto
  marketingSpend: number
  ownership: OwnershipEntry[] // { holderId: 'player' | npcId | 'float', shares: number }
  stock?: Stock               // presente se isPublic
  reputation: number
}
```

Empresa fundada pelo jogador nasce `isPublic: false` com `ownership` 100% dele.
Empresa da bolsa nasce `isPublic: true` com float e blocos de acionistas NPC.
**Mesma engine de operação para as duas.**

**Modelo operacional diário:**

```
demandaPotencial = tamanhoMercadoSetor
                 * fatorCiclo(macro)
                 * (0.4*qualidadeNorm + 0.35*marcaNorm + 0.25*elasticidadePreco)
                 * participacaoRelativaVsConcorrentes

receita   = min(demandaPotencial, capacidadeProdutiva) * preco
custos    = folha + insumos*(1+inflacao) + marketing + P&D + jurosDaDivida
lucro     = receita - custos - impostos(aliquotaSetorial ajustada por políticas)
caixa    += lucro
```

- **Funcionários:** cada um tem cargo, salário, produtividade e moral. Moral cai
  com excesso de carga e salário abaixo do mercado; produtividade agregada
  define capacidade. Demissão em massa: economia imediata, queda de moral e
  reputação, e manchete negativa.
- **Ações do gestor:** ajustar preço, orçamento de marketing, investir em P&D,
  contratar/demitir, expandir capacidade, tomar empréstimo, distribuir
  dividendos, recomprar ações, abrir capital (IPO).
- **Venda:** vender empresa privada inteira por valuation calculado
  (`múltiplo do setor × lucro anualizado`, com desconto por dívida e por
  reputação ruim) ou vender participação de empresa listada no mercado.

### 5.6 Participação, controle e M&A

Limiares de participação que desbloqueiam poder:

| Participação | Status | Desbloqueia |
|---|---|---|
| ≥ 5% | Acionista relevante | Divulgação obrigatória (vira notícia), acesso a relatórios detalhados |
| ≥ 15% | Assento no conselho | Voto em decisões estratégicas, veto parcial |
| ≥ 25% | Bloqueio | Pode barrar fusões e mudanças estatutárias |
| ≥ 50% + 1 | Controle | Painel de gestão completo, define diretoria e dividendos |
| ≥ 90% | Fechamento de capital | Pode deslistar e tornar privada |

- Comprar grandes blocos empurra o preço para cima (slippage) e gera manchete
  ("Investidor misterioso acumula posição em X") a partir de 5%.
- **OPA hostil:** oferta pública por prêmio sobre o preço de mercado; acionistas
  NPC aceitam com probabilidade função do prêmio, da confiança no management
  atual e do sentimento da imprensa. Aqui o jornal vira arma real.
- **IPO da sua empresa:** exige receita e lucro mínimos por 4 trimestres, um
  banco coordenador (custo), e define preço de abertura + percentual vendido.
  Entra caixa, você dilui participação e passa a sofrer pressão do mercado por
  resultado trimestral.
- **Fusão:** combina receita, caixa e dívida, com sinergia percentual e risco de
  choque de cultura (queda de moral).
- **Antitruste:** acima de X% de participação de mercado no setor, gatilho de
  investigação regulatória — mitigável via lobby (§5.7).

### 5.7 Política

```ts
interface Politician { id: string; name: string; party: string; stance: Record<string,number>; approval: number; office: string | null; loyaltyToPlayer: number }
interface Policy { id: string; name: string; effects: MacroDelta; sponsorId: string; status: 'proposta'|'tramitando'|'aprovada'|'rejeitada'; supportPct: number }
```

- **Eleições a cada 4 anos** (federal) e 4 anos deslocados (local).
- Resultado = aprovação base + peso das doações recebidas + cobertura de mídia
  favorável (§5.8) + estado da economia (desemprego e inflação punem o
  incumbente) + ruído.
- **Doação de campanha:** dinheiro (seu ou da empresa) → `loyaltyToPlayer`.
  Político leal propõe políticas alinhadas ao seu setor e engaveta
  investigações contra você.
- **Lobby:** gasto direcionado a uma política em tramitação, move `supportPct`.
- **Políticas** alteram parâmetros globais: alíquota de imposto por setor,
  subsídios, regulação ambiental, taxa de importação, salário mínimo, meta de
  inflação, regras de crédito.
- **Carreira política do jogador (opcional):** vereador → deputado → senador →
  presidente. Requer carisma, reputação pública e capital de campanha. Ocupar
  cargo dá poder direto sobre políticas, mas gera conflito de interesse: cada
  política aprovada que beneficia empresa sua aumenta `notoriety`.
- **Risco:** `notoriety` alta aciona investigação. Investigação tem prazo e
  probabilidade de condenação função das provas acumuladas (doações
  rastreáveis, demissões em massa, manipulação de mídia). Condenação = multa
  pesada, bloqueio de bens, possível prisão (perde N meses de ações e todos os
  cargos de gestão). Mitigável com advogados caros e imprensa amiga.

### 5.8 Jornais e mídia

Não é decoração — é a camada de informação e o vetor de causalidade.

```ts
interface NewsOutlet { id: string; name: string; credibility: number; bias: Record<string,number>; reach: number; ownerId: string | null }
interface Headline { id: string; outletId: string; date: GameDate; text: string; subject: EntityRef; sentiment: number; isRumor: boolean; accuracy: number }
```

- Cada `WorldEvent` gera manchetes em veículos diferentes, com viés e precisão
  distintos. Tabloide publica rumor com 60% de acerto; jornal sério publica
  tarde mas com 95%.
- **Rumores** são notícias sobre eventos que *podem* acontecer. Agir com base
  neles é a aposta central do jogo de bolsa.
- **Assinatura premium** de um veículo: acesso antecipado a dados de resultado,
  filtro por setor, alerta de eventos.
- **Comprar um jornal** (é uma `Company` do setor mídia): permite definir a
  pauta editorial. Publicar matéria positiva sobre empresa sua ou negativa
  sobre alvo de aquisição desloca `sentiment`, que entra em `eventShock` no
  preço da ação e na aprovação de políticos. Manipulação repetida derruba
  `credibility` do veículo (o efeito diminui) e aumenta `notoriety` do jogador.
- Feed de notícias é a tela inicial do app. É por ali que o jogador descobre
  que o mundo se moveu.

### 5.9 Eventos

Catálogo em `data/events.ts`, cada um com: pré-condições, peso, escopo
(global / setor / empresa / jogador), efeitos e template de manchete.

Exemplos: escândalo contábil, greve, recall de produto, descoberta de jazida,
ciberataque, mudança regulatória, boom setorial, pandemia, quebra de banco,
morte de CEO, processo trabalhista, herança inesperada, assalto, doença.

### 5.10 Ativos pessoais

Imóveis (valorizam com inflação, geram aluguel, servem de garantia), veículos
(depreciam, melhoram humor e reduzem tempo de deslocamento), itens de luxo
(humor e reputação, mas aumentam `notoriety` se a renda declarada não bater).

### 5.11 Fim de jogo

Aposentadoria aos 65 anos, ou morte por saúde 0, ou falência total.
Tela final com patrimônio líquido, cargos ocupados, empresas fundadas,
manchete de encerramento gerada pelo veículo de maior alcance, e ranking
salvo localmente. **New Game+:** desbloqueia arquétipos iniciais (herdeiro,
gênio, filho de político) com trade-offs.

---

### 5.12 Agentes NPC — IA reativa (sistema transversal)

Empresas concorrentes, investidores e rivais **não seguem curva estatística**.
São agentes que observam o mundo, decidem e reagem às jogadas do jogador.

#### Regra 1 — paridade de ações

Um NPC só pode executar ações do mesmo conjunto `CompanyAction` / `MarketAction`
disponível ao jogador. Nenhum efeito exclusivo de IA, nenhum dinheiro que
aparece do nada, nenhum conhecimento privilegiado gratuito. Se o NPC pode
fazer, o jogador pode; e vice-versa. Isso torna o jogo justo, depurável e
balanceável por um sistema só.

#### Regra 2 — informação imperfeita

Agentes **nunca leem `GameState`**. Leem `PublicView`, congelado no fim do tick
anterior:

```ts
interface PublicView {
  date: GameDate
  macro: PublishedMacro          // dados oficiais, com lag de divulgação
  stocks: Record<string, { price: number; volume: number; history: Candle[] }>
  companies: Record<string, PublishedFinancials>  // só o ÚLTIMO trimestre divulgado
  headlines: Headline[]          // inclui rumores, inclusive falsos
  disclosures: OwnershipDisclosure[]  // participações acima de 5%
}
```

Consequências diretas:
- O concorrente reage aos seus números com até um trimestre de atraso.
- Rumor falso publicado num veículo de alta credibilidade faz o NPC reagir a
  algo que **não aconteceu**. Comprar jornal deixa de ser cosmético.
- Se você é empresa privada, o concorrente enxerga muito pouco de você. Abrir
  capital (§5.6) tem um custo estratégico real: você fica legível.

#### Regra 3 — cadência escalonada

- Reavaliação estratégica a cada **90 dias**, com offset `hash(companyId) % 90`,
  distribuindo o custo pelos ticks.
- Gatilhos de reavaliação imediata (fora do ciclo, com cooldown de 15 dias):
  queda de participação acima de 3pp, divulgação de participação ≥5% no próprio
  capital, OPA recebida, manchete de sentimento forte sobre si, mudança de Selic
  acima de 1pp, entrada de novo concorrente no setor.

#### Perfis de comportamento

```ts
interface AIProfile {
  id: string
  weights: {                 // ver tabela abaixo, 0-1
    lucro: number; share: number; caixa: number; acao: number
    qualidade: number; influencia: number; risco: number
  }
  hardRules: HardRule[]      // filtram o leque de ações ANTES da utilidade
  signatureMove: ActionKind  // jogada que só este arquétipo faz com frequência
  conviction: number         // 0-1 quanto tempo insiste antes de quebrar (§conviccao)
  imitation: number          // 0-1 tendência a copiar o líder do setor
  vindictiveness: number     // 0-1 retaliação direcionada a quem atacou
  cashReserveTarget: number  // % da receita anual
  minMargin: number          // piso de margem — define o piso de preço
  headlineVoice: string      // tom das manchetes geradas por suas decisões
}

type HardRule =
  | { kind: 'forbid', action: ActionKind }             // nunca executa
  | { kind: 'floor', field: string, value: number }    // nunca abaixo de
  | { kind: 'ceiling', field: string, value: number }  // nunca acima de
  | { kind: 'always', action: ActionKind, min: number } // sempre gasta ao menos
```

**`hardRules` são invioláveis e aplicadas antes do cálculo de utilidade.** Elas
não são penalidade: a ação nem entra na lista de candidatos. É o que faz o
arquétipo ser reconhecível, porque produz recusa a jogadas obviamente boas.
Só a quebra de personagem (§abaixo) as suspende.

#### Tabela de pesos

| Arquétipo | lucro | share | caixa | ação | qualid. | influên. | risco |
|---|---|---|---|---|---|---|---|
| Bandeirante *(expansionista)* | 0.15 | **1.00** | 0.05 | 0.25 | 0.10 | 0.10 | 0.05 |
| Fortaleza *(conservador)* | 0.70 | 0.05 | **0.90** | 0.35 | 0.10 | 0.05 | **1.00** |
| Oficina *(inovador)* | 0.15 | 0.30 | 0.25 | 0.10 | **1.00** | 0.05 | 0.30 |
| Abutre *(predador)* | 0.60 | 0.40 | 0.80 | 0.20 | 0.00 | 0.20 | 0.25 |
| Espelho *(imitador)* | 0.40 | 0.50 | 0.30 | 0.15 | 0.05 | 0.05 | 0.60 |
| Vitrine *(showman)* | 0.05 | 0.30 | 0.10 | **1.00** | 0.20 | 0.15 | 0.10 |
| Padrinho *(apadrinhado)* | 0.30 | 0.25 | 0.30 | 0.10 | 0.00 | **1.00** | 0.20 |
| Herdeiro *(familiar)* | 0.50 | 0.10 | 0.60 | 0.05 | 0.30 | 0.15 | 0.85 |
| Sobrevivente *(zumbi)* | 0.20 | 0.05 | **1.00** | 0.10 | 0.00 | 0.10 | 0.95 |

#### Arquétipos

**Bandeirante** — participação de mercado acima de tudo. Aceita prejuízo por até
8 trimestres seguidos para tomar share. Toma dívida com folga.
*Regras duras:* nunca paga dividendo; nunca reduz capacidade; teto de preço no
menor preço do setor. *Jogada assinatura:* entrada num setor novo.
*Como morre:* alavancagem alta encontra um choque de Selic.

**Fortaleza** — o dividendo é sagrado. Prefere perder mercado a brigar por
preço. *Regras duras:* nunca corta dividendo (mantém pagando até o caixa
acabar); alavancagem ≤ 0.3×; **proibido cortar preço em resposta a concorrente**.
*Jogada assinatura:* recompra de ações quando a própria ação cai.
*Como morre:* definha lentamente até virar alvo barato de aquisição.

**Oficina** — reinveste em P&D mesmo no vermelho. *Regras duras:* P&D ≥ 25% da
receita, sempre; proibido competir por preço — se atacada, **sobe** preço e
qualidade. *Jogada assinatura:* salto descontínuo de qualidade a cada N
trimestres de P&D acumulado (breakthrough), que reposiciona o setor inteiro.
*Como morre:* queima o caixa antes do breakthrough chegar.

**Abutre** — não compete, compra. Acumula caixa em silêncio por anos e ataca
quem tiver P/L baixo. *Regras duras:* **proibido cortar preço**; proibido gastar
em marketing acima de 3% da receita; caixa mínimo de 40% da receita anual.
*Jogada assinatura:* OPA hostil. *Como morre:* indigestão — dívida de aquisição
somada a choque de cultura pós-fusão.

**Espelho** — copia o líder do setor com 1 a 2 trimestres de atraso, sem nunca
inovar. Opera com margem fina porque não gasta em P&D. *Regras duras:* P&D = 0;
proibido ser o primeiro a mover preço no setor. *Jogada assinatura:* clone
descarado de produto, com manchete satírica. *Como morre:* copia uma jogada
ruim do líder. **Se você virar o líder, ele copia você e corrói sua margem.**

**Vitrine** — otimiza percepção, não resultado. Gasta absurdamente em marketing
e mídia; a ação descola do fundamento. *Regras duras:* marketing ≥ 15% da
receita; **proibido admitir fracasso** — reage a matéria negativa com anúncio
ainda maior; proibido cortar guidance. *Jogada assinatura:* anúncio grandioso de
produto futuro que move a ação hoje. *Como morre:* o resultado divulgado
encontra a expectativa e a ação colapsa em um trimestre.

**Padrinho** — sobrevive de política, não de eficiência. Gasta em doação e lobby
o que os outros gastam em P&D. Recebe subsídio, contrato público e proteção
tarifária. *Regras duras:* **nunca demite** (custo político); doação ≥ 5% do
lucro; proibido entrar em setor sem proteção regulatória. *Jogada assinatura:*
política pública aprovada sob medida para si. *Como morre:* o político dele
perde a eleição. **A fraqueza dele é eleitoral, não financeira** — para
derrubá-lo você precisa do sistema de política, não do de mercado.

**Herdeiro** — controle familiar, decisão emocional. *Regras duras:* **recusa
qualquer OPA, com qualquer prêmio**, enquanto a família mantiver o controle;
proibido diluir participação familiar; nepotismo impõe teto de produtividade.
*Jogada assinatura:* recusa pública e ofendida de uma oferta generosa.
*Como morre:* sucessão familiar mal resolvida ou briga entre herdeiros — e é
nesse momento, e só nele, que a empresa fica comprável.

**Sobrevivente** — endividado, refinancia eternamente, só age sob ameaça
existencial. *Regras duras:* proibido investir em qualquer coisa; proibido pagar
dividendo; toda decisão é corte de custo ou venda de ativo. *Jogada assinatura:*
venda de divisão inteira a preço de banana. *Como morre:* recuperação judicial —
mas às vezes carrega um ativo escondido que vale mais que a empresa toda.

#### Convicção e quebra de personagem

Cada agente acumula `stress` quando os resultados contradizem a estratégia
(trimestres de prejuízo, share perdido, ação em queda). Enquanto
`stress < conviction`, o agente **insiste**, mesmo com a utilidade dizendo o
contrário — é isso que produz teimosia legível em vez de otimização fria.

Quando `stress ≥ conviction`, ocorre a **quebra**: as `hardRules` são suspensas
por 4 trimestres e o agente age puramente por utilidade. Isso gera os melhores
momentos do jogo: a Fortaleza finalmente corta o dividendo, a Oficina engaveta
o P&D, o Herdeiro aceita vender. Cada quebra é manchete de primeira página.

#### Sucessão de comando

Após 6 trimestres ruins, o conselho troca o CEO — e o **arquétipo muda**. A
escolha do novo perfil depende da composição acionária: acionistas
institucionais tendem a instalar uma Fortaleza; um Abutre no bloco de controle
instala outro Abutre.

Duas consequências de gameplay: você pode **pressionar uma empresa até ela
trocar de personalidade** (matar a Oficina que te incomoda instalando corte de
custos nela), e ao controlar várias empresas você **escolhe o arquétipo do CEO
que nomeia**. Isso resolve o gargalo de blocos de ação no late game: você não
microgerencia dez empresas, você nomeia dez personalidades e vive com o que elas
fazem.

#### Rancor

`grudge: Record<EntityId, number>` por agente. Quem foi atacado (preço, mídia,
tentativa de aquisição) marca o agressor e, ponderado por `vindictiveness`,
direciona retaliação **a ele especificamente**, mesmo quando existe alvo mais
lucrativo. O Abutre lembra de quem o superou num leilão de aquisição por anos.

#### Motor de decisão — utilidade, não árvore de comportamento

```
candidatos = gerarAcoesViaveis(company, publicView)   // caixa, rate limits E regras duras do arquétipo
para cada candidato:
    projecao = simularTrimestre(company, candidato, publicView)
    U =  w.lucro      * Δlucro
       + w.share      * Δparticipacao
       + w.caixa      * Δcaixa
       + w.acao       * ΔprecoDaAcao
       + w.qualidade  * Δ(qualidade + marca)
       + w.influencia * ΔinfluenciaPolitica
       - w.risco      * risco(alavancagem, volatilidade, exposição regulatória)
escolhe argmax(U), mas SOMENTE se U > utilidadeStatusQuo * (1 + histerese)
```

Os dois últimos termos positivos existem para que nem todo agente esteja
maximizando lucro. O Inovador aceita conscientemente margem pior por qualidade;
o Apadrinhado aceita ineficiência por proteção política. Sem isso, todos os
arquétipos convergem para o mesmo comportamento com sotaques diferentes.

`simularTrimestre` chama o **mesmo `companies.ts`** usado pela simulação real —
a IA não duplica regra de negócio, ela roda a engine em modo hipotético. Custo:
~6 candidatos × 28 empresas, distribuídos ao longo de 90 dias.

#### Reações ao jogador

| Gatilho | Reação possível |
|---|---|
| Você corta preço e ganha participação | Agressivos igualam ou baixam mais; inovadores reposicionam em qualidade em vez de brigar |
| Você escala marketing | Escalada de orçamento até o teto de % da receita |
| Sua empresa paga acima do mercado e tem moral alta | Assédio de talentos: oferta salarial maior e você perde funcionários produtivos |
| Você cruza 5% do capital de uma listada | Conselho acorda: recompra de ações (encarece o alvo), pílula de veneno (emissão diluidora), busca de cavaleiro branco |
| Você lança OPA hostil | Board recomenda recusa, contrata banco de defesa, aciona antitruste via lobby |
| Você publica matéria negativa sobre alguém | Contra-PR, compra de espaço em veículo rival, ou aquisição de um jornal próprio |
| Você faz lobby por uma política | Concorrente contra-doa: o lobby vira leilão, e quem gastou mais move o `supportPct` |
| Sua empresa listada fica barata (P/L baixo, caixa alto) | Tycoon rival acumula posição **em você** e tenta o controle |

#### Tycoons rivais

2 a 3 agentes que jogam o mesmo jogo que o jogador: têm patrimônio, carteira,
empresas controladas, influência política e ambição. Competem pelos mesmos
alvos de aquisição, financiam os mesmos políticos e, no late game, tentam tomar
suas empresas. São o antagonista que impede o fim de jogo de virar um vazio
onde só se acumula dinheiro. Aparecem nas manchetes pelo nome.

#### Investidores institucionais

Modelo **agregado**, não um agente por fundo: a pressão diária de compra/venda
por ativo é função de `(sentimento das manchetes × alcance do veículo)` +
desvio do valor fundamental + momentum. Alimenta `eventShock` e o volume
negociado. Apenas 3-4 fundos nomeados existem como agentes reais, para dar
rosto às notícias ("Fundo Aurora amplia posição em X").

#### Guardrails de estabilidade (obrigatórios)

Reação em cadeia é o modo de falha padrão deste sistema. Sem estes limites, o
preço espirala para zero, o marketing escala ao infinito e duas empresas ficam
alternando decisão a cada trimestre para sempre.

- **Histerese:** só muda se o ganho projetado superar 3%
- **Rate limit:** variação máxima de ±15% no preço por decisão; cooldown por
  tipo de ação
- **Piso duro:** `preço ≥ custoUnitário × (1 + minMargin)`
- **Teto de marketing:** percentual fixo da receita
- **Restrição de caixa:** nenhuma ação que derrube o caixa abaixo de
  `cashReserveTarget`
- **Fadiga de guerra:** cada trimestre com margem abaixo do mínimo incrementa
  `warFatigue`; acima do limiar o agente recua independentemente da utilidade
- **Amortecimento:** magnitude da reação multiplicada por `(1 - imitation*0.5)`,
  para o setor não convergir para um preço único

Precedência, quando houver conflito: `hardRules` do arquétipo > guardrails
globais > utilidade. A única exceção é a quebra de personagem, que suspende as
`hardRules` temporariamente mas **nunca** os guardrails globais.

#### Distinguibilidade (critério de aceite)

Um jogador deve conseguir identificar o arquétipo de uma empresa depois de uns
2 anos de jogo, sem que o jogo diga qual é. Teste objetivo no runner headless:
para qualquer par de arquétipos, a sobreposição da distribuição de ações
tomadas em 10 anos simulados deve ser **inferior a 60%**. Acima disso, os pesos
estão tímidos demais — exagere mais.

#### Visibilidade

Toda decisão de NPC emite um `WorldEvent` com prioridade; as relevantes viram
manchete. **Se o jogador não lê "Concorrente Y anuncia corte agressivo de
preços", toda essa IA é trabalho invisível.** A aba Negócios ganha uma sub-aba
**Concorrência**: participação por setor, preço médio praticado e as últimas
jogadas conhecidas de cada rival, com o rótulo de quão desatualizada está a
informação.

---

## 6. UI mobile

**Bottom nav, 5 abas:**
1. **Início** — feed de notícias, stats do jogador, ações do dia
2. **Mercado** — índice, lista de ativos, gráfico, ordens, carteira
3. **Negócios** — suas empresas, participações, painel de gestão
4. **Mundo** — bancos, política, eleições, imóveis
5. **Perfil** — carreira, educação, skills, save, configurações

**Requisitos:**
- Safe-area insets (notch e barra inferior), `100dvh`
- Alvos de toque ≥ 44px; nada depende de `:hover`
- Bloquear pull-to-refresh, double-tap zoom e seleção acidental de texto
- Gráfico de candle com pan/zoom por gesto (lightweight-charts já entrega)
- Números grandes formatados (1,2 mi / 3,4 bi), sempre em BRL
- Modo escuro por padrão
- Manifest completo, `display: standalone`, ícones maskable, splash screens
- 100% funcional offline após o primeiro carregamento
- Feedback tátil (`navigator.vibrate`) em confirmação de ordem e eventos críticos

---

## 7. Ferramenta de balanceamento (obrigatória)

`npm run sim -- --days 3650 --seed 42 --strategy passive`

Runner headless em `src/sim/` que roda a engine sem UI e imprime CSV com:
patrimônio, índice, Selic, inflação, lucro médio das empresas, participação de
mercado por setor e distribuição de preços. Estratégias simuladas: `passive`
(só trabalha), `investor`, `entrepreneur`, `tycoon`, `pricewar` (força uma
guerra de preços para testar a IA), `raider` (acumula participação para testar
as defesas).

Critérios de aprovação:
- Nenhuma estratégia gera patrimônio infinito nem trava o jogador em 10 anos
- Nenhum setor converge para preço único ou para monopólio permanente
- Nenhuma oscilação sustentada: a variação de preço de um NPC não pode alternar
  de sinal mais de 4 vezes em 8 decisões consecutivas
- Toda guerra de preços iniciada em `pricewar` termina em no máximo 6 trimestres
  (fadiga de guerra funcionando)

Isso só é possível porque a engine é pura e a IA usa a mesma engine.

---

## 8. Testes obrigatórios (Vitest)

- Determinismo: mesma seed + mesmas ações = estado idêntico (deep equal)
- 3650 dias simulados sem `NaN`, `Infinity` ou valores negativos inválidos
- Save/load round-trip preserva estado exato
- Migrations: save da versão N-1 carrega na versão N
- Limiares de controle acionam os poderes certos (5/15/25/50/90%)
- Margin call dispara quando a garantia cai abaixo do mínimo
- Ordem limite executa apenas quando o preço cruza
- Imposto sobre lucro realizado é cobrado exatamente uma vez

Específicos da IA:
- Determinismo se mantém com todos os agentes ativos
- Nenhum NPC pratica preço abaixo do piso de margem, em 3650 dias
- Participações de mercado somam 1 dentro de cada setor, todo tick
- Nenhum agente lê `GameState` — teste de arquitetura: `ai/` não importa nada
  além de `types`, `perception` e `companies`
- Um rumor **falso** de alta credibilidade altera a decisão do NPC (prova de que
  a informação imperfeita está de fato sendo usada)
- Acumular 5% em uma listada dispara reação defensiva dentro de 15 dias
- Guerra de preços forçada converge (fadiga) e não espirala
- Nenhum agente executa uma ação proibida pela `hardRule` do seu arquétipo,
  exceto durante janela de quebra de personagem
- Sobreposição de comportamento entre quaisquer dois arquétipos < 60% em 10 anos
- Fortaleza mantém dividendo mesmo com 4 trimestres de prejuízo
- Herdeiro recusa OPA com prêmio de 100%
- Padrinho perde subsídio e entra em colapso quando seu político é derrotado
- Quebra de personagem dispara quando `stress ≥ conviction` e reverte após 4
  trimestres
- Sucessão de CEO altera o arquétipo e o comportamento observável muda

---

## 9. Plano de execução (fases)

**Não implemente tudo de uma vez.** Cada fase termina jogável, testada e com
build passando. Só avance após minha aprovação explícita.

| Fase | Escopo | Aceite |
|---|---|---|
| 0 | Scaffolding, `CLAUDE.md`, tipos completos do `GameState` final, save vazio, shell PWA com bottom nav | App instala no celular e abre offline |
| 1 | Clock, jogador, energia/stats, empregos, cursos, persistência, catch-up offline | Dá pra viver 1 ano de jogo trabalhando e estudando |
| 2 | Macro (ciclo, Selic, inflação) + bancos (conta, poupança, empréstimo, score) | Selic visível muda rendimento e custo de crédito |
| 3 | Bolsa: ativos, precificação, ordens, carteira, dividendos, gráfico | Dá pra investir e a carteira reage ao ciclo macro |
| 4 | Eventos + jornais + feed de notícias + rumores + `PublicView`/`perception` | Notícia move preço de ação de forma rastreável |
| 5 | Empresa própria: fundar, operar, funcionários, vender | Empresa dá lucro, quebra ou é vendida |
| 5b | **IA operacional dos concorrentes**: 9 arquétipos com regras duras, motor de utilidade, preço, marketing, contratação, assédio de talentos, guardrails | Dá pra identificar o arquétipo de uma empresa só olhando o que ela faz |
| 6 | Participação, controle, painel de gestão de terceiros, OPA, IPO, fusão | Dá pra assumir o controle de uma listada e geri-la |
| 6b | **IA defensiva e tycoons rivais**: recompra, pílula de veneno, cavaleiro branco, rancor, quebra de personagem, sucessão de CEO e nomeação de CEO pelo jogador | Comprar 5% gera manchete e defesa; um rival tenta te comprar; você delega empresas nomeando arquétipos |
| 7 | Política: doações, lobby, eleições, políticas, investigação; carreira política; **contra-lobby dos NPCs** | Política aprovada altera imposto e isso aparece no lucro; lobby vira leilão |
| 8 | Ativos pessoais, endgame, ranking, New Game+, polimento, som, animações | Partida completa dos 18 aos 65 |

---

## 10. Como quero que você trabalhe

1. **Antes de qualquer código**, gere `docs/GAME_DESIGN.md` com: a curva de
   progressão econômica proposta (quanto tempo até o primeiro milhão em cada
   estratégia), a tabela de constantes de balanceamento inicial e os pontos onde
   você acha que este spec vai desbalancear. Apresente para aprovação.
2. Gere `CLAUDE.md` com as regras de arquitetura da §3, para que sessões
   futuras não violem a separação engine/UI.
3. Implemente na ordem: tipos → engine do sistema → testes da engine →
   persistência → UI → integração com os sistemas já existentes.
4. Ao final de cada fase: rode `vitest`, rode o build, rode o simulador headless
   e me mostre o resultado. Diga o que ficou faltando e o que você acha que vai
   dar problema na fase seguinte.
5. Se um requisito deste spec conflitar com outro, **pare e pergunte** em vez de
   escolher sozinho.
6. Não crie abstração que não tenha dois usos concretos hoje.
