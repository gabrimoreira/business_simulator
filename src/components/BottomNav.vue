<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'

/** Alvos de ≥ 44px e nenhum estado de :hover (spec §6). */
const tabs = [
  { to: '/', label: 'Início', icon: 'feed' },
  { to: '/mercado', label: 'Mercado', icon: 'chart' },
  { to: '/negocios', label: 'Negócios', icon: 'building' },
  { to: '/mundo', label: 'Mundo', icon: 'globe' },
  { to: '/perfil', label: 'Perfil', icon: 'user' },
] as const

const route = useRoute()
const isActive = (to: string): boolean => route.path === to
</script>

<template>
  <nav
    class="border-t border-line bg-surface/95 backdrop-blur-sm"
    style="padding-bottom: env(safe-area-inset-bottom, 0px)"
  >
    <ul class="flex items-stretch">
      <li v-for="tab in tabs" :key="tab.to" class="flex-1">
        <RouterLink
          :to="tab.to"
          class="flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2 transition-colors"
          :class="isActive(tab.to) ? 'text-accent' : 'text-muted'"
          :aria-current="isActive(tab.to) ? 'page' : undefined"
        >
          <svg
            class="h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <template v-if="tab.icon === 'feed'">
              <path d="M4 5h11a1 1 0 0 1 1 1v13H5a1 1 0 0 1-1-1V5Z" />
              <path d="M16 8h3a1 1 0 0 1 1 1v8a2 2 0 0 1-2 2h-2" />
              <path d="M7 9h6M7 12.5h6M7 16h3" />
            </template>
            <template v-else-if="tab.icon === 'chart'">
              <path d="M4 19V5M4 19h16" />
              <path d="M8 15v-3M12 15V8M16 15v-5M20 15v-2" />
            </template>
            <template v-else-if="tab.icon === 'building'">
              <path d="M4 20V6a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v14" />
              <path d="M14 10h5a1 1 0 0 1 1 1v9" />
              <path d="M7 8.5h4M7 12h4M7 15.5h4M17 13.5v3" />
              <path d="M3 20h18" />
            </template>
            <template v-else-if="tab.icon === 'globe'">
              <circle cx="12" cy="12" r="8" />
              <path d="M4 12h16M12 4c2.5 2.2 2.5 13.8 0 16M12 4c-2.5 2.2-2.5 13.8 0 16" />
            </template>
            <template v-else>
              <circle cx="12" cy="8.5" r="3.5" />
              <path d="M5 20c1.2-3.4 3.8-5 7-5s5.8 1.6 7 5" />
            </template>
          </svg>
          <span class="text-[11px] leading-none tracking-tight">{{ tab.label }}</span>
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
