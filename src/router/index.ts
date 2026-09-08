import { createRouter, createWebHistory } from 'vue-router'

/**
 * As 5 abas do spec §6. History mode (não hash) porque em PWA standalone o botão
 * voltar do Android precisa navegar entre abas em vez de fechar o app — o
 * rewrite de SPA está em `vercel.json`.
 */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'inicio', component: () => import('@/views/HomeView.vue') },
    { path: '/mercado', name: 'mercado', component: () => import('@/views/MarketView.vue') },
    { path: '/negocios', name: 'negocios', component: () => import('@/views/BusinessView.vue') },
    { path: '/mundo', name: 'mundo', component: () => import('@/views/WorldView.vue') },
    { path: '/perfil', name: 'perfil', component: () => import('@/views/ProfileView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

export default router
