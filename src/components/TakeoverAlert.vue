<script setup lang="ts">
/**
 * "Estão te comprando" — e o que fazer a respeito.
 *
 * Existe porque a parte mais grave da lacuna não era a falta de botão, era a
 * falta de **aviso**. Os tycoons rivais lançam oferta hostil desde a Fase 6b, e
 * a única pista na interface era abrir a folha daquele papel específico e
 * reparar num aviso. Quem não abrisse, apanhava sem saber.
 *
 * Fica no topo do Início, acima de tudo: uma oferta hostil tem prazo, e prazo
 * que passa é decisão tomada por omissão.
 */
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { formatMoneyCompact } from '@/lib/format'
import { stakeOf, totalShares } from '@/engine/ownership'
import { DEFENSE } from '@/data/config'

const game = useGameStore()

/** Ofertas abertas sobre empresa em que o jogador tem pele em jogo. */
const threats = computed(() => {
  const state = game.state
  if (!state) return []
  return state.tenders
    .filter((tender) => tender.status === 'aberta' && !tender.playerAnswered)
    .flatMap((tender) => {
      const company = state.companies[tender.companyId]
      if (!company) return []
      const stake = stakeOf(company, 'player')
      if (stake <= 0) return []
      return [
        {
          tender,
          company,
          stake,
          held: Math.round(stake * totalShares(company)),
          value: stake * totalShares(company) * tender.pricePerShare,
          daysLeft: tender.expiresDayIndex - state.date.dayIndex,
          // Defender só faz sentido para quem dirige a empresa.
          canDefend: company.managedBy === 'player',
        },
      ]
    })
})

function answer(tenderId: string, accept: boolean): void {
  game.dispatch({ kind: 'responderOpa', tenderId, accept })
}

function poisonPill(companyId: string): void {
  game.dispatch({ kind: 'pilulaDeVeneno', companyId })
}

function whiteKnight(companyId: string): void {
  // O aliado é criado na hora, como faz a IA em `agents.ts`.
  game.dispatch({ kind: 'cavaleiroBranco', companyId, allyId: `aliado@${companyId}` })
}
</script>

<template>
  <section v-if="threats.length" class="px-4 pt-3">
    <div
      v-for="threat in threats"
      :key="threat.tender.id"
      class="rounded-2xl border border-down/50 bg-down/10 p-4"
    >
      <div class="flex items-baseline justify-between gap-2">
        <p class="text-sm font-semibold text-down">
          Oferta {{ threat.tender.hostile ? 'hostil' : 'pública' }} por
          {{ threat.company.name }}
        </p>
        <p class="shrink-0 text-[11px] text-muted">
          {{ threat.daysLeft > 0 ? `${threat.daysLeft} dias` : 'vence hoje' }}
        </p>
      </div>

      <p class="pt-1 text-[11px] text-muted">
        Prêmio de {{ Math.round(threat.tender.premium * 100) }}% ·
        suas {{ threat.held.toLocaleString('pt-BR') }} ações valem
        {{ formatMoneyCompact(threat.value) }} na oferta
      </p>

      <div class="flex gap-2 pt-3">
        <button
          class="min-h-[44px] flex-1 rounded-lg bg-accent text-xs font-semibold text-bg"
          @click="answer(threat.tender.id, true)"
        >
          Vender
        </button>
        <button
          class="min-h-[44px] flex-1 rounded-lg border border-line text-xs font-medium"
          @click="answer(threat.tender.id, false)"
        >
          Recusar
        </button>
      </div>

      <div v-if="threat.canDefend" class="pt-2">
        <p class="pb-1 text-[11px] uppercase tracking-wide text-muted">Defesa do conselho</p>
        <div class="flex gap-2">
          <button
            class="min-h-[44px] flex-1 rounded-lg border border-line px-2 text-[11px] leading-tight"
            @click="poisonPill(threat.company.id)"
          >
            Pílula de veneno
            <span class="block text-muted">
              emite {{ Math.round(DEFENSE.poisonPillIssue * 100) }}% e dilui
            </span>
          </button>
          <button
            class="min-h-[44px] flex-1 rounded-lg border border-line px-2 text-[11px] leading-tight"
            @click="whiteKnight(threat.company.id)"
          >
            Cavaleiro branco
            <span class="block text-muted">aliado leva o float</span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
