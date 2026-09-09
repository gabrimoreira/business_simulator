# GAME_DESIGN.md — Balanceamento e decisões de design

> Documento exigido pelo §10.1 do spec, **antes de qualquer código**.
> Contém: resoluções de conflito do spec, curva de progressão econômica, tabela
> de constantes iniciais, e onde eu acho que isto vai desbalancear.
> Nada aqui é código; tudo aqui vira `src/data/` nas fases seguintes.

**Convenção de valores:** todos os alvos de patrimônio estão em **R$ constantes
do ano 0** (reais, deflacionados). Em valores nominais, com inflação de 4,5% ao
ano ao longo de 47 anos, tudo se multiplica por ~8× — o que faria qualquer meta
nominal mentir. O jogo mostra nominal na tela (é o que o jogador tem no bolso) e
o runner de balanceamento reporta as duas colunas.

---

## 1. Conflitos do spec e como foram resolvidos

O §10.5 manda parar e perguntar em caso de conflito. Estes são todos os que
encontrei na leitura completa. C1 e C2 foram decididos por você; C3 a C13 são
defaults documentados — cada um pode ser revertido antes da Fase 0.

### C1 — Escala de tempo vs partida completa dos 18 aos 65 *(decidido)*

§3.4 fixa 1 dia de jogo = 4 min reais. §5.11 e a Fase 8 pedem partida completa
dos 18 aos 65: 47 anos × 365 dias × 4 min ≈ **1.150 horas reais**.

**Resolução:** mantém 4 min/dia como cadência *idle* (com o teto de 3 dias de
progresso offline do spec) e adiciona ação explícita de **avanço de tempo**
(semana ou mês), que executa os blocos segundo uma **rotina** definida pelo
jogador e devolve log resumido no mesmo formato do modal "Enquanto você esteve
fora". Sessão ativa e idle passam a ser escolha, não obrigação. Partida completa
cai para ~20–40 h de jogo real.

*Consequência de implementação:* a rotina é estado do jogador
(`player.routine: ActionKind[]`) e o avanço de tempo é uma `GameAction` como
qualquer outra — nenhum caminho de código novo, mesmo `worldTick`.

### C2 — 3 blocos/dia vs dez empresas no late game *(decidido)*

§5.1 cobra 1 bloco por empresa gerida; o late game pede dez empresas. O spec só
resolve isso na Fase 6b (nomear CEO), deixando as Fases 5–6 travadas.

**Resolução:** gestão de empresa é **diretriz persistente**. A empresa opera
sozinha com as diretrizes vigentes (preço, orçamento de marketing, % de P&D,
política de contratação, payout). O bloco é cobrado apenas ao **alterar** uma
diretriz ou em jogada pontual (empréstimo, IPO, demissão em massa, M&A).
A nomeação de CEO da Fase 6b passa a significar "quem define as diretrizes no
seu lugar" — o mesmo motor de utilidade da IA operando *a seu favor*.

*Consequência de gameplay:* delegar deixa de ser alívio de tédio e passa a ser
troca real — o CEO nomeado tem `hardRules` próprias e vai recusar jogadas que
você faria.

### C3 — O orçamento diário não fecha se comer e dormir custarem bloco

§5.1 lista dormir e comer entre as ações. Com 3 blocos: trabalhar + comer +
dormir = 3 blocos, e o jogador **nunca estuda** — a progressão de carreira, que
exige diploma, fica inalcançável.

**Resolução:** comer é ação livre (0 blocos, máximo 3 refeições/dia) e dormir é
automático na virada do dia (0 blocos), restaurando energia em função de saúde,
humor, fome e qualidade da moradia. Consomem bloco: trabalhar, estudar,
academia, lazer, socializar, alterar diretriz de empresa, hora extra.
Operar na bolsa é grátis, como o spec manda.

### C4 — A fórmula de demanda do §5.5 é circular

`demandaPotencial` usa `participacaoRelativaVsConcorrentes`, mas a participação
*é* consequência da receita. Não há como avaliar a expressão como escrita.

**Resolução:** participação passa a ser derivada de atratividade relativa.

```
atratividade_i = 0.40*(qualidade_i/100)^0.9
               + 0.35*(marca_i/100)^0.8
               + 0.25*elasticidade_i
   onde elasticidade_i = (precoMedioSetor / preco_i)^1.6

share_i   = atratividade_i / Σ atratividade_setor
demanda_i = tamanhoMercadoSetor * fatorCiclo(macro) * sazonalidade(setor, mês) * share_i
receita_i = min(demanda_i, capacidade_i) * preco_i
```

Demanda não atendida por falta de capacidade é **redistribuída** aos
concorrentes que têm capacidade sobrando, em proporção à atratividade deles.
Isso satisfaz de graça o teste do §8 "participações somam 1 dentro de cada setor,
todo tick", e dá sentido mecânico a expandir capacidade.

### C5 — Custo de `simularTrimestre` vs "usar o mesmo `companies.ts`"

§5.12 exige que a projeção da IA rode a engine real, não uma cópia. Projeção
ingênua: 6 candidatos × 90 dias × 28 empresas. No runner de 3650 dias isso é
ordem de milhões de company-days só de projeção.

**Resolução:** `companies.ts` expõe duas funções sobre a *mesma* regra:
`stepCompanyDay(company, ctx)` (o dia real) e `projectQuarter(company, action,
publicView)`, que chama `stepCompanyDay` com **passo semanal (13 iterações)** e
macro congelado. Mesma regra de negócio, custo 7× menor. Com reavaliação a cada
90 dias e offset `hash(companyId) % 90`, isso dá ~0,31 empresa/dia × 6
candidatos × 13 passos ≈ **24 company-steps/dia** de projeção contra 28 de
simulação real — menos que dobrar o custo do tick.

### C6 — IR de 15% "gera pendência se não houver caixa"

§5.3 não diz o que a pendência faz depois, e o §8 exige teste de "cobrado
exatamente uma vez".

**Resolução:** apuração no último dia do mês sobre lucro realizado do mês, com
isenção para vendas mensais até R$ 20.000 (regra brasileira, e dá textura ao
early game). Sem caixa, vira `TaxDebt` com multa de 2% + 1% ao mês, bloqueia
saque de aplicação enquanto existir, e custa −40 de `creditScore`. O lucro
apurado é marcado como liquidado no mesmo passo em que a pendência é criada — é
isso que torna o "exatamente uma vez" testável.

### C7 — `lastTickAt: number` (epoch ms) vs engine sem `Date.now()`

§3.4 põe um timestamp real dentro do estado; §3.1 proíbe o relógio na engine.

**Resolução:** `lastTickAt` é **escrito** pela camada de UI/persistência e nunca
**lido** pela lógica de simulação. A UI calcula `days` e chama
`worldTick(state, days)`. A engine não sabe que horas são.

### C8 — `rng.normal()` sem `Math.random()`

**Resolução:** mulberry32 dá uniforme; a normal é Box-Muller consumindo **2
draws** do counter. Esse contrato é congelado: mudar o número de draws por
`normal()` desalinha o counter e invalida todo save existente.

### C9 — Dois tipos diferentes de deslistagem

§5.3 diz que na deslistagem "a posição do jogador zera"; §5.6 diz que com ≥90%
o controlador pode fechar o capital. São eventos diferentes.

**Resolução:** *falência/recuperação judicial* zera a posição (a empresa não
vale nada). *Fechamento de capital* é compra compulsória dos minoritários com
prêmio sobre a média dos últimos 60 dias — o jogador minoritário **recebe
dinheiro**, e essa é justamente a jogada que um tycoon rival pode usar para te
expulsar de uma posição que você queria manter.

### C10 — Paridade de ações vs o Padrinho recebendo subsídio

§5.12 Regra 1 proíbe efeito exclusivo de IA; o arquétipo Padrinho "recebe
subsídio, contrato público e proteção tarifária".

**Resolução:** subsídio, contrato e tarifa **só existem como `Policy`** aprovada
pelo sistema de política (§5.7). O Padrinho consegue via doação e lobby, com o
mesmo custo e a mesma incerteza que o jogador. Nada é creditado a NPC fora do
sistema. É isso que faz "a fraqueza dele ser eleitoral, não financeira" ser
verdade mecânica e não texto de sabor.

### C11 — "Nenhum valor negativo inválido" vs empresa com caixa negativo

**Resolução:** o teste do §8 precisa de uma lista explícita.
*Podem ser negativos:* caixa de empresa, lucro, P&L, patrimônio líquido,
`publicReputation` (−100 a 100), `MacroState.inflation`, retorno diário.
*Nunca negativos:* preço de ação e de produto, `sharesOutstanding`, energia,
saúde, humor, fome, skills, `creditScore`, `notoriety`, `credibility`,
`principal` de empréstimo, quantidade de ações em carteira.

### C12 — `PublicView` com `history: Candle[]` copiado todo tick

Copiar 28 × 365 candles por dia é caro e desnecessário.

**Resolução:** o `PublicView` carrega a **mesma referência** (congelada) do array
de candles públicos, nunca uma cópia. Candles passados são imutáveis por
construção — só se adiciona no fim. Determinismo preservado, custo zero.

### C13 — Limiares de participação em empresa privada

A tabela do §5.6 (5/15/25/50/90%) fala de conselho, divulgação e deslistagem —
conceitos de companhia aberta.

**Resolução:** os limiares valem só para `isPublic: true`. Empresa privada usa
`ownership` direto: controle é >50%, e não há divulgação obrigatória (é
exatamente por isso que abrir capital tem custo estratégico — §5.12 Regra 2).

---

## 2. Curva de progressão econômica

As quatro estratégias do runner (§7), com a aritmética que sustenta cada número.
Tudo em **R$ constantes do ano 0**. Jogador começa aos 18 com R$ 0 e sem
qualificação; aposentadoria aos 65 (47 anos de jogo = 17.155 dias).

### 2.1 Alvos

| Estratégia | 1º milhão (real) | 1º milhão (nominal) | Patrimônio aos 65 (real) | Freio principal |
|---|---|---|---|---|
| `passive` — só trabalha | ano 36–42 | ~ano 24 | R$ 1,1–1,8 M | teto salarial sem diploma + eventos de vida |
| `investor` — trabalha, estuda, investe | ano 15–19 | ~ano 11–13 | R$ 20–70 M | IR 15%, corretagem, drawdown de recessão |
| `entrepreneur` — funda e opera | ano 8–11 | ~ano 6–8 | R$ 60–500 M | capital de expansão, moral, guerra de preços da IA |
| `tycoon` — alavanca, adquire, manipula | ano 6–9 | ~ano 5–6 | R$ 1–15 B | antitruste, `notoriety`, tycoons rivais |

### 2.2 De onde vêm esses números

**`passive`.** Sem cursos, a carreira para em *Encarregado de loja*,
R$ 3.400/mês. Excedente real médio de R$ 1.300/mês (R$ 700 no início,
R$ 2.100 no fim), depositado em poupança a ~3,4% real. Somando os três
patamares de renda com juros compostos: **R$ 1,4 M real** aos 65. Cruza
R$ 1 M real por volta do ano 38. Em nominal cruza no ano ~24 — é por isso que o
runner reporta as duas colunas: uma meta nominal mentiria por 14 anos.

**`investor`.** Estuda e chega a Gerente (R$ 26.000/mês). Excedente real médio
de R$ 6.500/mês, aplicado a 7% real (índice) + até 4% de alfa real para quem
opera notícia e rumor bem. Três patamares de aporte compostos a 11% real dão
**R$ 18–25 M real**, cruzando R$ 1 M real no ano ~17.

> **Conclusão de design que sai daí:** investir sozinho é *lento*. Nenhum aporte
> de assalariado vira império. O acelerador é fundar empresa, e é isso que faz o
> jogo do spec ser sobre empreender e não sobre day trade. Se o runner mostrar
> `investor` chegando perto de `entrepreneur`, o alfa está generoso demais.

**`entrepreneur`.** Capital de fundação de R$ 50.000 sai por poupança no ano
4–6, ou por empréstimo no ano 3 (com juros punitivos e score baixo). O freio
real do early game é **capacidade produtiva**, não demanda: o setor tem mercado
de bilhões, mas `receita = min(demanda, capacidade)` e a capacidade inicial é de
um funcionário — teto de ~R$ 25.000/mês de receita. Reinvestindo lucro em
capacidade, a receita compõe 40–70% ao ano até a participação de mercado passar
a morder. Empresa com R$ 1,2 M de receita anual e margem de 11% dá R$ 130 mil de
lucro, que a 8× de múltiplo setorial vale R$ 1,04 M — daí o 1º milhão no ano
8–11. O topo (R$ 60–500 M) depende de IPO e de aquisições.

**`tycoon`.** Mesmo início do `entrepreneur`, mais alavancagem, compra de jornal
e financiamento de político. Chega antes e vai muito mais longe, mas é a única
estratégia com risco de **perda catastrófica**: investigação com condenação
bloqueia bens e custa meses de ações. O topo é limitado por antitruste e por
2–3 tycoons rivais competindo pelos mesmos alvos.

> **Medido na Fase 1** (nominal, sem bolsa nem juros, que só chegam nas Fases 2
> e 3): `passive` termina 10 anos com R$ 229 mil e 30 anos com R$ 1,57 M, preso
> em Encarregado de loja — exatamente o teto sem diploma previsto aqui.
> `investor` fica **atrás** aos 10 anos (R$ 43 mil, porque pagou R$ 30 mil de
> matrícula e só então chegou a Analista júnior) e passa à frente por volta do
> **ano 14**: R$ 1,84 M aos 20 anos e R$ 5,0 M aos 30. A inversão nos primeiros
> 10 anos é esperada enquanto não existe onde compor capital; se persistir
> depois da Fase 3, o critério de reprovação abaixo vale.

### 2.3 Critérios de reprovação do balanceamento

O runner headless reprova a build se qualquer um ocorrer:

- **Patrimônio explosivo:** patrimônio real acima de 20% do valor de mercado
  agregado do jogo. Pelas tabelas do §3.7 o mercado nasce com R$ 186 B de
  receita setorial somada, ~R$ 21 B de lucro líquido agregado e múltiplo médio de
  ~10× — ou seja **~R$ 210 B de valor de mercado**, e teto de patrimônio real em
  R$ 42 B. Reprova também CAGR real acima de 60% sustentado por 5 anos.
- **Jogador travado:** qualquer estratégia terminando com saúde < 20 de forma
  recorrente, fome zerada mais de 30 dias no total, ou patrimônio real negativo
  por mais de 2 anos sem caminho de saída.
- **Estratégia dominada:** `passive` superando `investor`, ou `investor`
  superando `entrepreneur`, ao final de 10 anos. A ordem das quatro curvas é o
  invariante de balanceamento mais importante do jogo.
- **Convergência de setor:** qualquer setor terminando com um único preço
  praticado (desvio-padrão de preço < 3% da média) ou com monopólio permanente
  (share > 70% por mais de 8 trimestres).
- **Oscilação sustentada:** variação de preço de um NPC alternando de sinal mais
  de 4 vezes em 8 decisões consecutivas.
- **Guerra de preços eterna:** `pricewar` não convergindo em 6 trimestres.

---

## 3. Tabela de constantes iniciais

Conteúdo futuro de `src/data/`. Nenhum destes números aparece na lógica.

### 3.1 Tempo e ação — `config.ts`

| Constante | Valor | Por quê |
|---|---|---|
| `MS_PER_GAME_DAY` | 240.000 (4 min) | vem do spec §3.4 |
| `OFFLINE_CAP_DAYS` | 3 | teto do spec §3.4 |
| `ACTION_BLOCKS_PER_DAY` | 3 | spec §5.1 |
| `FAST_FORWARD_STEPS` | 7 e 30 dias | resolução C1 |
| `RETIREMENT_AGE` | 65 | spec §5.11 |
| `START_AGE` | 18 | spec §5.1 |
| `TICKS_PER_YEAR` | 365 | calendário real, trimestres em mar/jun/set/dez |

### 3.2 Energia, saúde, humor, fome

| Ação | Blocos | Energia | Efeito |
|---|---|---|---|
| Dormir (automático na virada) | 0 | +65 × modificadores | — |
| Comer marmita (R$ 8) | 0 | +2 | fome +30, saúde −1 |
| Comer normal (R$ 20) | 0 | +5 | fome +50 |
| Restaurante (R$ 60) | 0 | +5 | fome +60, humor +8 |
| Trabalhar | 1 | −30 | salário, desempenho |
| Hora extra | 1 | −35 | +60% do salário-dia, humor −4 |
| Estudar | 1 | −20 | progresso no curso |
| Academia | 1 | −25 | fitness +0,4, saúde +0,3 |
| Lazer | 1 | −10 | humor +12 |
| Socializar | 1 | −15 | carisma +0,2, +1 contato |
| Alterar diretriz de empresa | 1 | −15 | ver C2 |
| Operar na bolsa | 0 | 0 | spec §5.1 |

- Decaimento diário: fome −50, humor −2, energia só via ações.
- `energia = 0` bloqueia ações que consomem bloco. `saúde = 0` é fim de jogo.
- `fome = 0` drena 3 de saúde por dia.
- Humor < 30 aplica multiplicador de 0,75 em produtividade e em qualidade de
  decisão de gestão; humor < 10, multiplicador 0,5.
- Recuperação do sono: `+65 × (0,6 + 0,4·saúdeNorm) × (0,8 + 0,2·humorNorm) ×
  fatorMoradia`, menos 20 se `fome < 30`.

> Três blocos "caros" por dia custam ~75 de energia contra 65 de recuperação:
> o déficit de 10/dia força um dia leve a cada 4–5 dias. Essa é a tensão do
> early game, e é ela que faz academia e lazer valerem bloco.

### 3.3 Carreira — `jobs.ts`

Salários mensais em R$ do ano 0, reajustados pela inflação. Promoção exige
tempo mínimo no cargo + skill + desempenho acumulado.

| # | Cargo | Salário | Requisitos | Desgaste |
|---|---|---|---|---|
| 0 | Atendente de balcão | 1.800 | — | alto |
| 1 | Auxiliar administrativo | 2.400 | int 20 | médio |
| 2 | Encarregado de loja | 3.400 | car 30, 2 anos | alto |
| 3 | Técnico de suporte | 4.800 | tec 35, curso técnico | médio |
| 4 | Analista júnior | 7.000 | int 45, graduação | médio |
| 5 | Desenvolvedor | 11.000 | tec 55, graduação | médio |
| 6 | Especialista sênior | 16.000 | int 65, 2 anos no cargo 4 ou 5 | baixo |
| 7 | Gerente | 26.000 | car 60, int 60, 2 anos | alto |
| 8 | Diretor | 55.000 | car 75, int 70, MBA | alto |
| 9 | C-level | 120.000 | car 85, int 80, MBA, 3 anos como diretor | alto |

Cargos 0–2 não exigem diploma — é o teto do `passive`.

### 3.4 Cursos — `courses.ts`

| Curso | Duração | Custo | Concede |
|---|---|---|---|
| Curso técnico | 240 dias de estudo | R$ 2.400 | tec +15 |
| Graduação | 1.100 dias | R$ 28.000 | int +20, tec +8 |
| Pós / especialização | 500 dias | R$ 18.000 | int +12 |
| MBA | 700 dias | R$ 90.000 | car +18, int +10 |
| Oratória | 90 dias | R$ 1.500 | car +8 |
| Mercado financeiro | 150 dias | R$ 3.500 | int +6, −20% corretagem |

### 3.5 Custo de vida

| Item | Valor/mês (R$ do ano 0) |
|---|---|
| Quarto compartilhado (moradia inicial) | 550 |
| Apartamento alugado | 1.800 |
| Transporte | 260 |
| Alimentação (1 refeição normal/dia) | 600 |
| Saúde e imprevistos | 180 |
| **Eventos de vida** (doença, conserto, família) | ~15% do excedente, estocástico |

### 3.6 Macroeconomia — `config.ts`

| Constante | Valor |
|---|---|
| Selic inicial | 10,75% a.a. (piso 2%, teto 30%) |
| Inflação inicial | 4,2% a.a. |
| Meta de inflação | 4,5% (banda ±1,5 pp) |
| Reunião do banco central | a cada 45 dias |
| Regra de reação | `selicAlvo = inflação + 0,03 + 1,5·(inflação − meta) − 0,8·outputGap`; suavização `selic += (alvo − selic)·0,08` |
| Desemprego base | 8% (+6 pp em recessão, −3 pp em pico) |
| Índice inicial | 100 pontos, volatilidade diária alvo 1,1% |

Duração de cada fase do ciclo (dias, sorteada no intervalo):

| Fase | Duração | Confiança-alvo | Fator de demanda |
|---|---|---|---|
| expansão | 540–1.460 | 70 | 1,10 |
| pico | 90–270 | 85 | 1,18 |
| recessão | 180–540 | 30 | 0,80 |
| recuperação | 270–730 | 55 | 0,95 |

Total de 2 a 7 anos por ciclo completo, como o spec pede. Confiança move 0,5/dia
rumo ao alvo, mais choques de evento.

### 3.7 Bolsa — `config.ts` + `industries.ts`

```
multiploSetorial = multiploBase[setor] * (0.10 / max(0.04, selic))^0.6
                   clamp [0.35 × base, 2.2 × base]
```

O piso de 0,35× é deliberado: sem ele, um choque de Selic derruba o valuation de
28 empresas ao mesmo tempo e o mercado inteiro vira alvo de aquisição por
centavos (risco 3 do §4).

| Setor | Múltiplo base | Volatilidade diária | Margem base | Alíquota | Sens. a juros | Mercado anual |
|---|---|---|---|---|---|---|
| Tecnologia | 22 | 2,8% | 22% | 34% | 0,7 | R$ 18 B |
| Saúde | 18 | 1,6% | 14% | 34% | 0,3 | R$ 22 B |
| Varejo | 12 | 2,0% | 7% | 34% | 0,8 | R$ 45 B |
| Mídia | 11 | 2,4% | 10% | 25% | 0,6 | R$ 6 B |
| Energia | 9 | 1,9% | 18% | 30% | 0,4 | R$ 30 B |
| Bancos | 8 | 1,8% | 28% | 34% | 0,9 | R$ 40 B |
| Mineração | 7 | 2,6% | 20% | 34% | 0,5 | R$ 25 B |

| Constante de preço | Valor |
|---|---|
| `meanReversionRate` | 0,06 (gap clampado a ±5% → drift máx ±0,3%/dia) |
| `beta` por empresa | 0,7 – 1,6 |
| Teto de `eventShock` diário por ativo | ±12% |
| `NEWS_PRICE_COEF` | 0,004 × Σ(sentimento × alcance × credibilidade) |
| Volume diário máximo | 0,4% das `sharesOutstanding` |
| Slippage | `(ordem/volumeDiário)^1,3 × 0,08`, teto 25% |
| Corretagem | R$ 4,90 fixo + 0,15% |
| IR sobre lucro realizado | 15%, isenção mensal até R$ 20.000 de vendas |
| Recuperação judicial | caixa < 0 por 3 trimestres consecutivos |
| Deslistagem por falência | 2 trimestres em RJ sem recuperação |
| Fechamento de capital | prêmio sobre média de 60 dias, a partir de 90% |

### 3.8 Bancos — `banks.ts`

| Banco | Poupança (× Selic) | Score mín. | Spread do empréstimo | Limite |
|---|---|---|---|---|
| Cooperativa Raiz | 0,75 | 200 | Selic + 26 pp | 1,5× renda mensal |
| Banco do Povo | 0,70 | 300 | Selic + 18 pp | 3× renda |
| Banco Meridiano | 0,80 | 500 | Selic + 12 pp | 8× renda |
| Aurora Investimentos | 0,92 (CDB, carência 90 d) | 650 | Selic + 8 pp | 20× renda |

- Rotativo do cartão: 14% ao mês.
- Financiamento imobiliário: Selic + 4 pp, 360 meses, entrada de 20%.
- Capital de giro (empresa): Selic + 6 a 16 pp conforme alavancagem.
- Score: +2 por parcela em dia, −60 por atraso acima de 30 dias, −150 por
  falência, −1 por cada 0,1 de alavancagem acima de 4× a renda; +1/dia sem
  pendência.

> Poupança rende no máximo 0,92 × 10,75% = 9,9% nominal ≈ **5,2% real**, contra
> 7% real do índice. A margem é fina de propósito: renda fixa precisa ser opção
> defensiva de verdade nas recessões, sem nunca dominar o jogo (risco 1 do §4).

### 3.9 IA — `aiProfiles.ts` + guardrails

Guardrails globais (§5.12), iguais para todos e **nunca suspensos**:

| Guardrail | Valor |
|---|---|
| Histerese | ganho projetado > 3% |
| Rate limit de preço | ±15% por decisão |
| Cooldown por ação | preço 45 d, marketing 30 d, contratação 30 d, P&D 90 d, M&A 180 d |
| Piso duro de preço | `custoUnitário × (1 + minMargin)` |
| Cadência estratégica | 90 dias, offset `hash(companyId) % 90` |
| Cooldown de gatilho | 15 dias |
| Amortecimento | magnitude × `(1 − imitation × 0,5)` |
| `warFatigue` | +1 por trimestre com margem < `minMargin`; recuo em ≥ 3; −1 por trimestre saudável |
| Decaimento de `grudge` | 0,5%/dia (meia-vida ≈ 1,5 trimestre) |

Por arquétipo (os pesos de utilidade são os da tabela do spec §5.12):

| Arquétipo | `conviction` | `imitation` | `vindictiveness` | `cashReserveTarget` | `minMargin` |
|---|---|---|---|---|---|
| Bandeirante | 0,70 | 0,15 | 0,45 | 5% | 1% |
| Fortaleza | 0,80 | 0,10 | 0,20 | 25% | 12% |
| Oficina | 0,75 | 0,05 | 0,25 | 15% | 10% |
| Abutre | 0,60 | 0,20 | 0,80 | 40% | 8% |
| Espelho | 0,30 | 0,90 | 0,30 | 12% | 4% |
| Vitrine | 0,35 | 0,35 | 0,55 | 8% | 3% |
| Padrinho | 0,65 | 0,25 | 0,60 | 18% | 6% |
| Herdeiro | 0,85 | 0,15 | 0,70 | 30% | 9% |
| Sobrevivente | 0,20 | 0,50 | 0,15 | 3% | 2% |

`stress`: +0,08 por trimestre de prejuízo, +0,05 por perda de share acima de
2 pp, +0,04 por queda de 20% na ação no trimestre; −0,03 por trimestre saudável.
Quebra de personagem em `stress ≥ conviction`, dura 4 trimestres, e ao voltar
`stress` reseta para `0,3 × conviction`. Sucessão de CEO após 6 trimestres ruins.

### 3.10 Política — `politicians.ts` + `policies.ts`

| Constante | Valor |
|---|---|
| Eleição federal | a cada 4 anos, outubro |
| Eleição local | a cada 4 anos, deslocada 2 anos |
| Resultado | `0,45·aprovação + 0,15·doações + 0,20·mídia + 0,20·economia + ruído(σ 0,06)` |
| `DONATION_UNIT` | R$ 100.000 → `loyalty += min(25, (doação/unidade)^0,7)`, decai 0,05/dia |
| `LOBBY_UNIT` | R$ 500.000 move 1 pp de `supportPct`, com retorno decrescente e **líquido do contra-lobby** |
| `notoriety` | +3 doação rastreável, +5 manipulação de manchete, +8 demissão em massa, +12 política sob medida; decai 0,02/dia |
| Investigação | dispara em `notoriety ≥ 60`, prazo 180 dias, `P(condenação) = provas/(provas+8)` |
| Antitruste | gatilho em share setorial > 45% |

### 3.11 Mídia — `newsOutlets.ts`

| Veículo | Credibilidade | Alcance | Lag | Precisão do rumor |
|---|---|---|---|---|
| Tabloide popular | 35 | alto | 0 dia | 60% |
| Portal de notícias | 55 | muito alto | 1 dia | 75% |
| Jornal de referência | 90 | médio | 2 dias | 95% |
| Revista de negócios | 80 | baixo | 3 dias | 92% |
| Boletim de mercado (premium) | 85 | baixo | 0 dia | 90% |

Manipulação editorial: cada matéria plantada custa −2 de `credibility` do veículo
(recupera 0,05/dia) e +5 de `notoriety` do dono. Como `eventShock` é proporcional
à credibilidade, o veículo se desgasta ao ser usado — é esse o freio do risco 2
do §4.

### 3.12 Orçamento de performance

| Alvo | Limite |
|---|---|
| `worldTick` de 1 dia | ≤ 1,5 ms |
| Runner de 3.650 dias | ≤ 6 s |
| Projeção da IA | ~24 company-steps/dia (ver C5) |
| Histórico por ativo | 365 dias diários + candles semanais agregados antes disso |
| Save serializado | ≤ 2 MB |

---

## 4. Onde eu acho que isto vai desbalancear

Nove pontos, cada um com o sintoma observável no runner headless e a alavanca de
correção. Estes são os lugares onde eu esperaria gastar tempo de ajuste.

**1. Renda fixa sem risco.** Poupança rendendo Selic diária e composta, sem
volatilidade e sem imposto modelado, torna "não jogar" uma estratégia viável.
*Sintoma:* `passive` empatando ou batendo `investor` em 10 anos.
*Alavanca:* fator de poupança (0,70–0,92 × Selic), carência do CDB, e IR
regressivo sobre renda fixa se ainda faltar freio.
*Medido na Fase 2:* aos 65 anos, `passive` termina com **R$ 1,14 M reais**
(dentro da faixa de R$ 1,1–1,8 M do §2.1) e `investor` com **R$ 5,9 M reais**.
A ordem está certa, mas o `investor` fica abaixo da sua faixa (R$ 20–70 M)
porque a poupança rende 2–3% reais e a faixa pressupõe os 7–11% da bolsa, que
só chega na Fase 3. **`passive` ainda supera `investor` aos 10 anos** — a
mensalidade é paga antes de o salário maior chegar. Se isso sobreviver à
Fase 3, o critério do §2.3 vale.

**2. Jornal como impressora de dinheiro.** Comprar veículo, publicar matéria
positiva sobre empresa própria, vender na alta, publicar negativa, recomprar.
*Sintoma:* patrimônio em escada regular e previsível após a compra do primeiro
veículo; `credibility` do veículo irrelevante para o resultado.
*Alavanca:* decaimento de `credibility` por matéria plantada (e `eventShock`
proporcional a ela), cooldown editorial, teto diário de `eventShock` por ativo
(±12%), `notoriety` → investigação. **É o risco mais provável do projeto**,
porque o spec faz da mídia o vetor central de causalidade.

**3. Espiral de falência em massa.** Selic alta derruba o múltiplo setorial *e*
encarece a dívida ao mesmo tempo, nas 28 empresas simultaneamente.
*Sintoma:* mais de 5 recuperações judiciais em um mesmo trimestre; índice caindo
abaixo de 40 pontos e não voltando.
*Alavanca:* piso de 0,35× no múltiplo setorial, vencimentos de dívida
escalonados na seed, e `Sobrevivente` conseguindo refinanciar (é o arquétipo que
existe para absorver esse choque).

**4. Distinguibilidade dos arquétipos.** Os pesos do spec deixam Fortaleza e
Abutre próximos demais (caixa 0,90 vs 0,80; lucro 0,70 vs 0,60; a diferença real
é `risco` 1,00 vs 0,25). O que os separa de fato são as `hardRules`.
*Sintoma:* o teste do §8 falhando — sobreposição acima de 60%.
*Métrica:* a sobreposição é medida sobre a **distribuição de `ActionKind`
efetivamente executadas** em 10 anos (histograma normalizado, distância de
variação total), não sobre os pesos.
*Alavanca:* exagerar pesos (o spec já autoriza: "os pesos estão tímidos demais")
e endurecer `hardRules`, que são o que produz recusa a jogada obviamente boa.

**5. Ruído vs reversão à média na bolsa.** `meanReversionRate` alto deixa o
gráfico chato e o rumor sem efeito; baixo deixa o preço descolar do fundamento
para sempre e a análise fundamentalista morre.
*Sintoma:* razão preço/valor-fundamental saindo da faixa 0,6–1,7 em regime, ou
gráfico com autocorrelação diária acima de 0,3.
*Alavanca:* `meanReversionRate` na faixa 0,04–0,09 e `volatility` por setor.

**6. Bolsa não consome bloco de ação (§5.1).** Operar é grátis em custo de
oportunidade, o que convida a micro-operação infinita.
*Sintoma:* `investor` com centenas de ordens por ano e retorno acima de 15%
real.
*Alavanca:* corretagem fixa (dói em ordem pequena) + percentual + slippage + IR
mensal. Se não bastar, limite de ordens por dia.

**7. `grudge` + `vindictiveness` em retaliação perpétua.** Dois NPCs rancorosos
podem se trancar em ciclo de retaliação, violando o critério de "não mais de 4
inversões de sinal em 8 decisões".
*Sintoma:* exatamente esse contador disparando no runner.
*Alavanca:* decaimento de `grudge` (0,5%/dia), `warFatigue`, e histerese.

**8. Loop de morte no early game.** Se o orçamento de subsistência não fechar, o
jogador morre ou fica preso sem nunca conseguir estudar (é por isso que C3 tirou
comer e dormir dos blocos).
*Sintoma:* `passive` com saúde média abaixo de 50 no primeiro ano, ou zero
cursos concluídos em 10 anos.
*Medido na Fase 1 (e corrigido):* a primeira versão matava o jogador no **dia
34**, e depois no dia 49. Quatro causas somadas: começar com R$ 0 (não dá para
comer no primeiro dia); cobrar aluguel no dia 10 do primeiro mês, antes do
primeiro salário; marmita tirando saúde, o que fazia da única comida acessível
uma morte lenta; e **nada no jogo devolvendo saúde**, o que transformava um
episódio de fome em sentença. Ajustes no §7. Com eles o primeiro ano fecha em
**+R$ 1.700** e a saúde média fica em 99,3.

**9. Capacidade produtiva como único freio da empresa nova.** Como o mercado
setorial é da ordem de bilhões e `receita = min(demanda, capacidade)`, a curva
inteira do `entrepreneur` é definida pelo **custo de expandir capacidade**.
*Sintoma:* empresa fundada no ano 4 valendo mais que o mercado inteiro no ano
12; ou o oposto, empresa que nunca sai de R$ 300 mil de receita.
*Alavanca:* custo por unidade de capacidade, produtividade por funcionário, e
tempo de rampa de `brandAwareness` — nenhum dos três está fixado neste
documento, porque só o runner da Fase 5 vai dizer o valor certo. **Este é o
número que eu mais espero errar na primeira tentativa.**

---

## 5. Determinismo — regras que a Fase 0 já precisa respeitar

Estas não são preferências; são pré-condições dos testes do §8.

- `seed` e `counter` do RNG vivem **dentro** do `GameState`. Nenhum RNG de
  módulo.
- `rng.normal()` consome exatamente 2 draws (Box-Muller). Contrato congelado.
- Nunca iterar coleção sem ordem estável por id — a ordem de iteração determina
  o consumo do RNG.
- Nenhum `Date.now()` na engine (ver C7). Nenhum ponto flutuante dependente de
  ordem de soma em agregados grandes: somar sempre na ordem ordenada por id.
- Toda mutação via Immer `produce`; o `state` de entrada nunca é tocado.
- `PublicView` é congelado no passo 11 e **compartilha referência** de arrays
  imutáveis (ver C12).

---

## 6. O que eu preciso de você antes da Fase 0

1. **Aprovar ou corrigir os alvos do §2.1.** A ordem `passive < investor <
   entrepreneur < tycoon` é o invariante; os números são discutíveis.
2. **Confirmar as resoluções C3 a C13 do §1.** Qualquer uma pode ser revertida
   agora a custo zero; depois da Fase 5 sai caro.
3. **Dizer se algum número do §3 já parece errado pra você.** Especialmente o
   custo de vida do §3.5 e os múltiplos setoriais do §3.7 — são os que puxam
   todo o resto.

Aprovado isto, a Fase 0 entrega: scaffolding Vite + Vue 3 + TS strict + Tailwind,
`types.ts` com o `GameState` **final completo** (todos os sistemas, mesmo os das
fases 6–8), save vazio versionado em IndexedDB, e shell PWA com bottom nav de 5
abas instalável e funcionando offline.


---

## 7. Ajustes de balanceamento aplicados na Fase 1

Registrados aqui porque contrariam números que este documento propunha antes de
existir engine para medi-los. Todos vieram do runner headless.

| Constante | Antes | Depois | Por quê |
|---|---|---|---|
| Salário do cargo 0 | R$ 1.600 | R$ 1.800 | com 1.600 o excedente mensal era negativo comendo refeição normal |
| Aluguel inicial | R$ 700 | R$ 550 | quarto compartilhado; era o maior item do orçamento de quem ganha o piso |
| Dinheiro inicial | R$ 0 | R$ 600 | com zero o jogador não come no primeiro dia e morre antes do primeiro salário |
| Primeira conta | dia 10 do mês 1 | carência de 30 dias | contratado no dia 3, só recebe no dia 5 do mês seguinte: o buraco era intransponível |
| Marmita | −1 de saúde | −1 de humor | a comida de quem está quebrado não pode ser veneno |
| Decaimento de humor | 2/dia | 3/dia | com 2 e lazer diário o humor ficava colado em 100 |
| Lazer | +12 de humor | +8 | idem |
| Trabalhar | sem efeito de humor | −1,5 de humor | sem custo, o trabalho não competia com nada |
| Recuperação de saúde | não existia | +0,3/dia alimentado e descansado | sem ela, um episódio de fome era irreversível |

### Ajustes da Fase 2

| Constante | Antes | Depois | Por quê |
|---|---|---|---|
| Índice de preços | não existia | `macro.priceLevel`, composto pela inflação diária | toda constante de `src/data/` está em R$ do ano 0; sem índice, 30 anos de inflação transformam o aluguel em troco e o jogador fica rico por acidente |
| Recuperação de score | sem teto | teto de 700 | quem nunca tomou crédito chegava a 1000 no ano 8; acima de 700 só com histórico real |
| Carência do CDB | renovada a cada aporte | contada do primeiro aporte | aplicar todo mês prendia o dinheiro **para sempre**, e nada na tela avisava — o `investor` terminou 47 anos sem um único diploma por causa disso |

### Ajustes da Fase 3

| Constante | Antes | Depois | Por quê |
|---|---|---|---|
| Compactação de candles | 1 diário → 1 semanal por dia | 7 diários → 1 semanal, uma vez por semana | converter um por dia não encolhe nada, e reconstruir o array diariamente dentro do draft do Immer custava segundos por ano simulado |
| Teto de candles semanais | não existia | 156 (3 anos) | o histórico crescia para sempre; em 47 anos seriam 2.400 semanais por ativo |
| Passo `perception` | dentro do `produce` | sobre o estado já finalizado | dentro do draft, a referência ao histórico é um proxy que o Immer finaliza copiando — o oposto do que a C12 pede |
| Valor justo de empresa no prejuízo | zero | múltiplo de receita | com zero, um trimestre ruim derrubava o preço por um degrau em vez de por uma ladeira |
| Dívida de 3 empresas na seed | 0,48–0,62 da receita | 0,26–0,30 | nasciam insolventes: os juros comiam a margem antes do primeiro dia |

**Custo do tick.** Medido em 2,2 ms/dia com 196 candles por ativo e 6,3 ms/dia
com 460 — o custo é proporcional ao total de candles guardado no estado, porque
o Immer percorre os arrays modificados a cada `produce`. Com a janela do spec
(365 diários + 156 semanais) o runner de 10 anos leva ~24 s, acima do orçamento
de 6 s do §3.12. **Débito registrado:** se a Fase 5b apertar, o caminho é tirar o
histórico de preço do estado produzido pelo Immer e guardá-lo à parte, que é
para isso que o object store `history` existe.

### Ajustes da Fase 4

| Constante | Antes | Depois | Por quê |
|---|---|---|---|
| Cooldown de evento | por definição, global | por **definição + alvo** | greve numa empresa bloqueava greve em todas por um ano; medido no navegador, o feed ficava com a manchete mais recente com 19 dias de idade |
| `rumorAccuracy` | chance de o veículo publicar o rumor | chance de publicar **dado que é verdadeiro** (e o complemento, se falso) | do jeito antigo o jornal sério publicava *mais* boato que o tabloide, o inverso da tabela do §3.11 |
| Decaimento do choque | não existia | 50% ao dia | sem ele uma sequência de más notícias empilha choque no teto e o preço passa a andar só por manchete |

**Densidade do feed, medida em 2 anos de jogo:** 120 manchetes, 126 pares
(evento, alvo) disparados, 30 delas rumor, das quais 12 falsos. A manchete mais
recente é sempre do dia — o feed não morre com o tempo, que era o defeito da
primeira versão.

### Ajustes da Fase 5

A fase trocou o resultado exógeno pela disputa de participação (C4). Sete
correções, quase todas achadas rodando dez anos e olhando quem morreu:

| O que estava errado | Sintoma | Correção |
|---|---|---|
| Moral entrava na capacidade **e** na produtividade | laço moral → capacidade → sobrecarga → moral; 26 de 28 empresas mortas em 10 anos | capacidade só olha produtividade |
| Penalidade de sobrecarga sem teto | empresa nova, sempre com mais demanda que capacidade, ficava com moral zero para sempre | satura em 1× a capacidade |
| Salário nominal congelado | mercado sobe com a inflação, empresa não reajusta, equipe some em uma década | dissídio automático pela inflação |
| Marca e qualidade com decaimento absoluto | todo mundo saturava em 100 e a diferenciação sumia | depreciação proporcional: o nível de equilíbrio vira função da intensidade do gasto |
| Marca medida contra o setor | startup nunca saía de zero: comprar alcance nacional é impossível para quem fatura 200 mil | marca também cresce por **utilização da própria capacidade** |
| Qualidade medida contra o setor | oficina pequena não conseguia ser boa | qualidade é **intensidade** de P&D sobre a própria receita |
| Atratividade aditiva | o termo de preço dava piso a quem ninguém conhece: empresa de 1 funcionário levava 13% do setor e a venda sumia | atratividade **multiplicativa na marca** |
| Participação alocada, não realizada | mesma empresa "ganhava" 16% de um setor de bilhões vendendo 274 mil | participação passa a ser a realizada, e a demanda não atendida vai para quem tem capacidade |
| Sem capital instalado | contratar rendia quase infinito: R$ 120 mil viravam R$ 8,6 bi de receita em 5 anos | `capitalStock` limita a capacidade junto com o quadro; giro do ativo por setor |

**A curva do empreendedor, medida:** o `entrepreneur` funda por volta do **ano
25** e fecha os 47 anos com **R$ 590 mil reais**, contra R$ 1,19 M do `passive`.
Isso reprova o §2.1 duas vezes: a fundação era prevista para o ano 4–6 e o
patrimônio final para a faixa de R$ 60–500 M.

O diagnóstico é claro e não é do motor: **um atendente não junta R$ 60 mil
reais**. O excedente dele é de ~R$ 220/mês, e a inflação come o caixa parado. A
estratégia do runner só consegue fundar depois de terminar a graduação e virar
analista — vinte e cinco anos depois. O caminho que falta é o que o próprio spec
já tem e a Fase 5 não conectou: **fundar com empréstimo**. O limite de crédito de
8× a renda mensal no Meridiano dá exatamente a ordem de grandeza do capital
mínimo. É a primeira coisa a fazer antes de mexer em qualquer constante.

### Ajustes da Fase 5b

| O que estava errado | Sintoma | Correção |
|---|---|---|
| Histerese comparada contra **deltas** | nenhum candidato passava de 0,03 e os 28 agentes ficaram cinco anos sem mudar um preço sequer | a utilidade pontua o **estado projetado**, e o limiar é relativo: `U(candidato) > U(statusQuo) × 1,03`, como o §5.12 escreve |
| Demanda do setor cega ao **nível** de preço | com só o preço relativo importando, todo mundo subia junto sem perder volume: o setor inteiro cobrava 2× em cinco anos | elasticidade de mercado de 1,5 sobre o preço médio |
| Expoente de preço na atratividade em 0,6 | elasticidade relativa efetiva de ~1,0: prêmio de 10% custava 9% de fatia e dobrava a margem, então subir preço sempre vencia | expoente 1,4, elasticidade efetiva 2,2 |
| Fadiga de guerra sem teto | contador chegava a 20 e o agente nunca mais brigava: a guerra de preços deixava de ser episódio e virava estado | teto em `warFatigueLimit + 2` |

**Decisão registrada — projeção com concorrentes congelados.** O §5.12 exige que
`simularTrimestre` rode o mesmo `companies.ts`. Desde a Fase 5 a receita depende
da alocação do setor inteiro, então projetar uma decisão exigiria simular as
rivais junto — quatro vezes o orçamento da C5. A projeção usa as **mesmas
funções** (`allocateSector` + `stepCompanyDay`) mantendo as rivais paradas no que
o `PublicView` mostra. Não duplica regra nenhuma; assume que ninguém reage dentro
do trimestre, que é o que a informação imperfeita da Regra 2 permite saber.

**Comportamento observado em cinco anos** (mesmo seed, sem intervenção):
o Bandeirante corta preço para 0,86 e aceita margem negativa por fatia; a Oficina
segura P&D em 25% e margem de 9%; o Espelho fica com P&D zerado; a Vitrine com
marketing em 15%; o Padrinho compra fatia com marketing e chega a 37% do setor.
Um conselho já trocou o CEO de uma Vitrine por uma Fortaleza depois de seis
trimestres ruins.

### Ajustes da Fase 6

| O que estava errado | Sintoma | Correção |
|---|---|---|
| Bloco de controle único (`bloco-<id>`) | não havia de quem comprar participação relevante, e a OPA ficava sem contraparte | capital fora do float repartido em quatro blocos nomeados, cada um com lealdade própria |
| Divulgação a cada variação de 1% | uma acumulação de um ano gerava 56 comunicados e 40 manchetes idênticas | divulga ao **cruzar** faixa (5, 10, 15, 20, 25, 30, 40, 50, 75, 90%) |
| Variável local chamada `window` em `ownership.ts` | o teste de arquitetura acusou uso de API de navegador na engine | renomeada — o falso positivo apontou um nome que sombreava um global |

**Custo de tomar uma empresa, medido.** Acumular o float de uma empresa de mídia
pequena leva ~260 pregões comprando no teto de volume diário (0,4% do capital),
e ao final dá 72% e o controle. A OPA pelo resto, com prêmio de 60%, só arranca
2,8% a mais: a família fundadora (lealdade 0,75) recusa. Os fundos e os
minoritários organizados aceitam. É o desenho pretendido — o bloco leal é o que
faz o Herdeiro do §5.12 ser intocável sem uma crise de sucessão.

### Ajustes da Fase 6b

| O que estava errado | Sintoma | Correção |
|---|---|---|
| `return null` onde devia ser `continue` em `pickTarget` | um papel sem valor justo abortava a busca inteira e os rivais ficavam parados | `continue` |
| Rival comprava só na reavaliação trimestral, com teto de volume **diário** | formar 20% levaria 25 anos | acumulação diária; a reavaliação decide o alvo e a hora de atacar |
| Rival elegia o alvo mais barato, esgotava o float e insistia nele | comprava zero todo dia para sempre | `pickTarget` pula quem não tem float |
| Dividendo só era creditado ao jogador | o rival torrava a fortuna comprando e nunca mais tinha caixa | tycoons recebem dividendo do que possuem |
| Rival pulverizava o caixa em oito nomes | nunca chegava a base para atacar | a posição já formada puxa o alvo (persistência) |
| Alvo reescolhido todo dia | varredura de todas as listadas por rival por tick; os testes de dez anos estouraram 180s | alvo guardado, reescolhido a cada 30 dias |
| `ownershipDisclosures` crescia sem fim | varredura de ameaça O(n) por empresa por dia | janela de 200 divulgações |

**A armadilha que me pegou pela quinta vez.** Passei um bom tempo caçando um bug
inexistente nos tycoons: eles pareciam congelados em 8% por 2.600 dias. A causa
era o **probe**, não o motor — com R$ 1.000 no bolso o jogador morre de fome, o
`worldTick` para de avançar, e o helper `advance()` devolvia, calado, um estado
parado no dia da morte. O mesmo engano já tinha custado tempo nas Fases 1, 2 e 4.

Agora `advance()` **lança exceção** quando a partida encerra no meio. Na primeira
execução ele derrubou dois testes que diziam simular 200 e 300 dias e mediam 56 e
57 — e que passavam havia três fases.

**Consequência de gameplay que os testes flagraram:** com as defesas ativas,
comprar todo o float **não basta** mais para tomar o controle. O conselho tira
papel do mercado (cavaleiro branco), dilui (pílula) ou encarece (recompra), e
fechar o controle passa a exigir a oferta pública. É o comportamento pretendido —
e o teste que antes afirmava "comprar o float dá o controle" agora afirma o
contrário, junto com o caminho que funciona.

### Ajustes da Fase 7

**Decisão registrada — como a política chega no imposto.** O efeito de uma
política aprovada é **recalculado a partir do conjunto de aprovadas**, não somado
incrementalmente ao estado. Somar delta a cada aprovação parece mais barato, mas
acumula erro: revogar não desfaz e um save carregado reaplica. Recalcular custa
uma varredura por votação — não por tick. Tem teste: reaplicar não acumula, e
revogar devolve a alíquota ao valor de tabela.

**Notoriedade, revisada como eu tinha prometido.** Ela agora **decai** 0,04 ao
dia, e a investigação separa duas coisas que estavam misturadas: o que chama
atenção e o que condena. Aquisição hostil sobe notoriedade e abre inquérito, mas
não é crime — a condenação sai de `provas / (provas + 8)`, e prova é doação
rastreável, matéria plantada e demissão em massa. Um jogador que só faz M&A é
investigado e absolvido; quem financia político com dinheiro de empresa, não.

| O que estava errado | Sintoma | Correção |
|---|---|---|
| Cooldown de defesa global | o conselho respondia ao maior acionista e o segundo atacante entrava de graça | cooldown **por atacante**, e a ameaça escolhida é a maior ainda não respondida |
| Defesa escolhida sem alternativa | sem float não há cavaleiro branco: o conselho gastava o rancor, não fazia nada e não registrava | tenta as quatro defesas em ordem de preferência do arquétipo |
| Tycoon divulgava a cada compra | 109 comunicados sobre a mesma empresa afogavam o feed | divulga ao cruzar faixa, como o jogador |
| Congresso esgotava o catálogo | nove projetos em cinco anos e quatro décadas de silêncio | projeto rejeitado volta depois de dois anos |

**Consequência de gameplay:** com defesas e rivais ativos, tomar uma listada
ficou **caro**. Comprar o float não basta, e fechar o controle exigiu, no teste,
seis rodadas de oferta a 140% de prêmio com caixa de bilhões. O critério de
aceite da Fase 6 continua verdadeiro, mas o preço subiu — é o antagonismo
funcionando.

### Ajustes da Fase 8

**Decisão registrada — ordem de débito: conta corrente primeiro, caixa depois.**
Era o inverso, e o inverso tem um efeito que só aparece em década simulada:
no dia 10 as contas do mês esvaziavam o caixa, e no dia 11 o jogador não tinha
com que comprar marmita **tendo saldo no banco**. O `pricewar` atravessou dez
anos com saúde média 6,8 e humor 0,8 por causa disso — vivo, mas em coma
permanente. Ninguém paga o aluguel com o dinheiro do almoço. Com a ordem
trocada: saúde média 99,9, humor 96,8.

**Decisão registrada — a manchete de fecho é escrita em `finishRun`, não no
passo `news`.** O tick para de avançar assim que `meta.ending` é marcado, então
uma manchete agendada para o passo seguinte nunca seria publicada. `finishRun`
escolhe o veículo de maior alcance e publica ali mesmo, antes de congelar.

**Decisão registrada — o que sobrevive ao `clearSave()`.** O ranking local e os
arquétipos destravados vivem em um object store `meta` separado (DB_VERSION 2),
fora do save. É isso que faz o New Game+ existir sem servidor: apagar a partida
não apaga a carreira.

| O que estava errado | Sintoma | Correção |
|---|---|---|
| `debit()` pagava do caixa antes da conta | dez anos de saúde 6,8 no `pricewar` | conta corrente primeiro, caixa depois |
| `filhoDePolítico` só tinha vantagem | arquétipo dominante sem custo — teste de trade-off reprovou | ganha `notoriety: 35` inicial |
| `advance()` devolvia estado congelado quando a partida acabava | cinco vezes em quatro fases eu persegui bug de simulação que era jogador morto | `advance()` **lança** se o `dayIndex` não avançou |

**Sobre o `advance()` que lança.** Vale registrar porque foi o erro mais caro do
projeto inteiro: um `worldTick` sobre partida encerrada devolve o estado intacto,
sem erro, e o helper de teste devolvia isso como se fosse o dia 3.650. Testes que
afirmavam medir 200 e 300 dias mediam 56 e 57. A correção é estrutural, não de
balanceamento: o helper agora falha alto e manda financiar o jogador.

### O que a Fase 8 mediu

**Critério de aceite da fase — partida completa dos 18 aos 65.** Uma corrida de
17.166 dias (`--strategy investor --seed 42`) chega aos 65 anos, dispara o
desfecho `aposentadoria`, publica a manchete de fecho no veículo de maior
alcance e congela o tick. Saúde média 100,0, humor 96,9, quatro diplomas, cargo
`especialista`, patrimônio nominal R$ 42,5 mi.

| Estratégia | 10 anos (real) | 47 anos (real) | Faixa do §2.1 |
|---|---|---|---|
| `passive` | R$ 183,6 k | — | R$ 1,1–1,8 M aos 65 |
| `investor` | — | R$ 6,11 M | R$ 20–70 M — **ainda 3× abaixo** |
| `pricewar` | R$ 75,2 k, empresa de R$ 358 k | — | — |

O `investor` subiu de R$ 1,9–2,2 M (medição da Fase 3) para R$ 6,11 M, o que
fecha dois terços da distância mas não a fecha. O que falta continua sendo o
mesmo diagnóstico do §7 da Fase 5: o caminho de patrimônio grande é **empresa**,
e o `investor` não funda nenhuma.

**O `pricewar` era o `passive` disfarçado.** As duas fechavam dez anos no mesmo
centavo — R$ 270.063,21 —, porque `pricewar` tinha `buildsCompany: null` e só
diferia na ordem da rotina. Metade do checklist de fim de fase media a mesma vida
duas vezes, em todas as fases desde a 5. Agora ela funda em varejo e pratica 85%
do preço médio do setor.

**Para fundar foi preciso crédito, e isso era o buraco documentado.** Nenhuma
medição anterior exercitou a fundação alavancada, que é o único caminho de quem
começa como atendente: R$ 50 mil reais de capital mínimo é mais do que um cargo
de entrada acumula antes de a inflação comer a poupança. Com
`leverageToFound`, a estratégia resgata a aplicação, completa com empréstimo de
dez anos no banco de maior múltiplo de renda e funda no ano 4. A dívida amortiza
de R$ 43,2 k para R$ 20,5 k até o ano 10, o score cai de 700 para 462 e a
empresa vale R$ 358 k — é o trade-off funcionando.

**A C3 continua verdadeira, e agora tem número.** Tentei dar à `pricewar` a
rotina `trabalhar + socializar + estudar`, para ter carisma e diploma. Dez anos
depois: saúde média **4,8**, humor **0,2**, e o curso nunca terminou. Três blocos
pesados não cabem no orçamento diário — o descanso não é opcional, é o que paga
os outros dois. Carisma **ou** diploma; não os dois.

**Defeito aberto no harness, não no jogo: `npx vitest run` sai com código 1.**
Os 241 testes passam (13/13 arquivos), mas o processo termina vermelho por
`[vitest-worker]: Timeout calling "onTaskUpdate"`. A causa é o formato dos
testes: quatro deles bloqueiam o worker por mais de dois minutos num laço de CPU
puro (`macro percorre as quatro fases` 178s, `Selic dentro dos limites` 146s,
`mundo listado continua vivo` 139s, `quem apura melhor publica rumor` 133s).
Enquanto o laço roda, o worker não lê a resposta do reporter, e o timer de 5s do
birpc dispara primeiro. Baixar `maxWorkers` para 4 levou de 6 erros para 3;
não elimina, porque esse timeout não é configurável. A correção real é fatiar
esses quatro testes em janelas menores — o que muda o que eles afirmam, então
não fiz na véspera do commit. **Não use `dangerouslyIgnoreUnhandledErrors`
aqui**: mascararia erro de verdade junto.

### O que a Fase 3 mediu, e o que ficou em aberto

Aos 65 anos, em três seeds:

| Estratégia | Patrimônio real | Faixa do §2.1 |
|---|---|---|
| `passive` | R$ 1,03–1,19 M | R$ 1,1–1,8 M — dentro, tangenciando o piso |
| `investor` | R$ 1,94–2,18 M | R$ 20–70 M — **dez vezes abaixo** |

O índice compõe a ~6% reais ao ano em 47 anos, que é a ordem certa. O problema
está na **estratégia de compra do runner**, não obviamente no motor: na Fase 2,
com o dinheiro só na poupança, o mesmo `investor` terminava com R$ 5,9 M reais —
ou seja, comprar ação está rendendo **menos** que a renda fixa, o que é o
oposto do desenho.

Um experimento controlado (mesmo seed, só mudando a regra de compra) mostrou que
comprar o índice inteiro rende 38% mais que comprar os três papéis mais
descontados em relação ao valor justo: a peneira de valor está pegando armadilha.
Isso explica parte da diferença, não toda. As duas hipóteses restantes, na ordem
em que pretendo testá-las na Fase 4:

1. **Ordem das decisões no runner.** A estratégia aplica no banco no dia 5 e
   compra ação no dia 10, então o salário vai quase todo para a renda fixa antes
   de sobrar para a bolsa. A comparação Fase 2 × Fase 3 pode estar medindo isso,
   e não o mercado.
2. **Arrasto de volatilidade.** Com desvio diário de 1,6% a 2,8%, o retorno
   geométrico de um papel isolado perde σ²/2 por ano — até 12% ao ano em
   mineração. A reversão à média compensa parte, mas concentrar em poucos nomes
   paga o arrasto cheio.

**Consequência de design que apareceu na medição:** como o salário é mensal,
trabalhar dois blocos no mesmo dia não rende nada além de desempenho para
promoção. O terceiro bloco vale mais em socializar (carisma → Encarregado) ou
estudar. Isso é temático — o jogo é sobre capital, não sobre esforço — mas
significa que `horaExtra` é hoje a **única** forma de converter bloco em
dinheiro. Se a Fase 2 mostrar que ninguém usa os três blocos, o caminho é dar
efeito de renda ao desempenho, não encarecer o descanso.
