<script setup lang="ts">
import EmptyState from '@/components/EmptyState.vue'
import ScreenTitle from '@/components/ScreenTitle.vue'
</script>

<template>
  <div class="pb-6">
    <ScreenTitle title="Negócios" subtitle="Suas empresas, participações e concorrência" />

    <section class="px-4 pt-3">
      <EmptyState
        title="Você não tem empresas"
        description="Fundar, definir preço, marketing e P&D, contratar e demitir, expandir capacidade — e vender, quebrar ou abrir capital."
        phase="Fase 5"
      />
    </section>

    <section class="px-4 pt-4">
      <h2 class="pb-2 text-sm font-medium text-muted">Concorrência</h2>
      <EmptyState
        title="Nenhum concorrente mapeado"
        description="Participação por setor, preço médio praticado e as últimas jogadas conhecidas de cada rival — com o rótulo de quão desatualizada está a informação."
        phase="Fase 5b"
      />
    </section>
  </div>
</template>
