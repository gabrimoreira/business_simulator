# Deploy

Vercel, estático, sem backend e sem variável de ambiente. O jogo inteiro roda no
aparelho e guarda tudo em IndexedDB — não há o que configurar do lado do
servidor.

## Antes de publicar

```bash
npx vitest run     # 261 testes
npm run build      # falha se houver erro de tipo: o script roda vue-tsc -b antes do vite build
npm run preview    # serve o build; é ele que vai para o ar, não o dev server
```

Abrir o `preview` no navegador em 390×844 e fazer o caminho crítico: criar
partida, gastar um bloco, avançar tempo, **recarregar a página** e conferir que o
save voltou. Service worker e precache se comportam diferente do `dev`, então
testar só no dev server não vale.

## Criar o repositório e importar

```bash
git remote add origin git@github.com:<usuario>/capital.git
git push -u origin main
```

Na Vercel: **Add New → Project → Import** o repositório. Ela detecta Vite
sozinha; confira que ficou assim e não mexa em mais nada:

| Campo | Valor |
|---|---|
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |
| Environment Variables | nenhuma |

O Node vem do `.nvmrc` (22) e do `engines` no `package.json`, para o build do
servidor ser o mesmo que passa aqui.

## O que o `vercel.json` faz, e por quê

**`rewrites`** manda tudo para `/index.html`. É o que faz o history mode do
vue-router funcionar: sem isso, abrir `/mercado` direto ou apertar voltar no
Android em PWA standalone dá 404. A Vercel serve arquivo estático antes de
aplicar rewrite, então `sw.js` e `manifest.webmanifest` continuam sendo servidos
de verdade.

**`headers`** resolve o problema clássico de PWA:

- `sw.js`, `registerSW.js` e `manifest.webmanifest` vão com
  `max-age=0, must-revalidate`. O `vite-plugin-pwa` está em
  `registerType: 'autoUpdate'`, e a atualização só dispara se o navegador
  revalidar o service worker. Com cache longo, quem instalou o PWA fica preso
  numa versão antiga **sem ter como sair** a não ser desinstalando.
- `/assets/*` vai com `max-age=31536000, immutable`. O Vite põe hash no nome de
  cada arquivo, então o conteúdo nunca muda sob a mesma URL.

## Depois de no ar

1. Abrir no celular e instalar ("Adicionar à tela de início"). Conferir o ícone,
   o nome (`Capital`) e que abre em tela cheia, sem barra do navegador.
2. Pôr em modo avião e abrir de novo: tem de carregar e a partida tem de estar
   lá.
3. **Publicar uma segunda vez** e reabrir o app instalado. Ele tem de atualizar
   sozinho. Se não atualizar, o problema está nos cabeçalhos acima — não no
   código.

## O que não existe de propósito

Sem analytics, sem Sentry, sem conta de usuário, sem cloud save. O save é JSON
puro e versionado justamente para que cloud save seja possível depois sem migrar
nada, mas hoje não há para onde enviá-lo — e não haver servidor é o que faz o
jogo funcionar offline e não custar nada para rodar.
