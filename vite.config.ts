import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon-180.png',
        'splash-1170x2532.png',
        'splash-1284x2778.png',
        'splash-750x1334.png',
      ],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
      manifest: {
        id: '/',
        name: 'Capital — Simulador de Vida e Negócios',
        short_name: 'Capital',
        description:
          'Simulador de vida e negócios: trabalhe, invista, funde empresas, compre jornais e financie políticos.',
        lang: 'pt-BR',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0a0a0b',
        theme_color: '#10b981',
        categories: ['games', 'finance'],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    // Os testes de sanidade simulam 10 anos de jogo com a bolsa rodando; o
    // default de 5s não cabe uma década.
    testTimeout: 300_000,
    // Os `beforeAll` que simulam anos caem aqui, não no `testTimeout`: o
    // default de 10s derruba o arquivo inteiro antes do primeiro `it`.
    hookTimeout: 300_000,
    // Um teste de dez anos é um laço de CPU puro: enquanto ele roda, o worker
    // não processa a resposta do `onTaskUpdate` que já mandou ao reporter, e o
    // timer de 5s do birpc dispara antes da mensagem ser lida. Resultado: 241
    // testes verdes e `exit 1`. Metade dos núcleos reduziu de 6 erros para 3 —
    // não resolve, porque o timeout do birpc não é exposto na config. A cura é
    // nenhum corpo de teste bloquear por minutos; está anotado no §7 da Fase 8.
    maxWorkers: 4,
    include: ['tests/**/*.spec.ts'],
    setupFiles: ['tests/setup.ts'],
  },
})
