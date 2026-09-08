<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'
import ScreenTitle from '@/components/ScreenTitle.vue'
</script>

<template>
  <div class="pb-6">
    <ScreenTitle title="Mundo" subtitle="Bancos, política e imóveis" />

    <section class="px-4 pt-3">
      <h2 class="pb-2 text-sm font-medium text-muted">Bancos</h2>
      <EmptyState
        title="Nenhuma conta aberta"
        description="Quatro bancos com perfis diferentes: poupança e CDB rendendo fração da Selic, empréstimo, cartão com rotativo punitivo e score de crédito."
        phase="Fase 2"
      />
    </section>

    <section class="px-4 pt-4">
      <h2 class="pb-2 text-sm font-medium text-muted">Política</h2>
      <EmptyState
        title="Sem eleição no horizonte"
        description="Doações, lobby, eleições a cada quatro anos e políticas que mudam imposto, subsídio e regra de crédito — inclusive contra você."
        phase="Fase 7"
      />
    </section>
  </div>
</template>
