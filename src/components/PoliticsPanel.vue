<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGameStore } from '@/stores/game'
import { formatPercent } from '@/lib/format'
import { netLobby } from '@/engine/politics'
import { POLITICS } from '@/data/config'

const game = useGameStore()
const amount = ref<number | null>(null)

const debating = computed(() => {
  const state = game.state
  if (!state) return []
  return state.politics.policyOrder
    .map((id) => state.politics.policies[id])
    .filter((policy) => policy?.status === 'tramitando')
    .map((policy) => ({
      policy: policy!,
      // O saldo do leilão: seu dinheiro menos o de quem está do outro lado.
      net: netLobby(state, policy!.id),
      daysLeft: (policy!.voteDayIndex ?? 0) - state.date.dayIndex,
      sponsor: state.politics.politicians[policy!.sponsorId]?.name ?? '—',
    }))
})

const approved = computed(() => {
  const state = game.state
  if (!state) return []
  return state.politics.policyOrder
    .map((id) => state.politics.policies[id])
    .filter((policy) => policy?.status === 'aprovada')
    .map((policy) => policy!)
})

const politicians = computed(() => {
  const state = game.state
  if (!state) return []
  return state.politics.politicianOrder.map((id) => state.politics.politicians[id]!)
})

const investigation = computed(
  () =>
    game.state?.politics.investigations.find(
      (item) => item.targetId === 'player' && item.status === 'aberta',
    ) ?? null,
)

function lobby(policyId: string, direction: 1 | -1): void {
  if (!amount.value || amount.value <= 0) return
  game.dispatch({ kind: 'fazerLobby', policyId, amount: amount.value, direction })
  amount.value = null
}

function donate(politicianId: string): void {
  if (!amount.value || amount.value <= 0) return
  game.dispatch({ kind: 'doar', politicianId, amount: amount.value, fromCompanyId: null })
  amount.value = null
}

function defend(): void {
  if (!investigation.value || !amount.value) return
  game.dispatch({
    kind: 'contratarAdvogado',
    investigationId: investigation.value.id,
    spend: amount.value,
  })
  amount.value = null
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <input
      v-model.number="amount"
      class="selectable min-h-[44px] w-full rounded-xl border border-line bg-surface-2 px-3 text-base outline-none focus:border-accent"
      type="number"
      inputmode="decimal"
      min="0"
      placeholder="Valor para doar ou aplicar em lobby"
    />

    <div
      v-if="investigation"
      class="rounded-2xl border border-down/50 bg-surface p-4"
    >
      <p class="text-sm font-semibold text-down">Investigação em curso</p>
      <p class="tnum text-xs text-muted">
        {{ investigation.evidence.toFixed(1) }} de prova acumulada ·
        {{ investigation.deadlineDayIndex - (game.state?.date.dayIndex ?? 0) }} dias para o
        desfecho
      </p>
      <p class="pt-1 text-[11px] text-muted">
        Chance de condenação hoje:
        {{ formatPercent(investigation.evidence / (investigation.evidence + POLITICS.evidenceDivisor), 0) }}
      </p>
      <button
        class="mt-2 min-h-[40px] w-full rounded-lg border border-line text-sm disabled:opacity-30"
        :disabled="!amount"
        @click="defend"
      >
        Contratar advogado
      </button>
    </div>

    <div v-if="debating.length" class="rounded-2xl border border-line bg-surface p-4">
      <p class="pb-2 text-sm font-medium">Em tramitação</p>
      <div v-for="item in debating" :key="item.policy.id" class="border-t border-line py-3 first:border-t-0 first:pt-0">
        <p class="text-sm">{{ item.policy.name }}</p>
        <p class="text-[11px] text-muted">
          {{ item.sponsor }} · votação em {{ item.daysLeft }} dias
        </p>
        <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            class="h-full rounded-full"
            :class="item.policy.supportPct + item.net >= 0.5 ? 'bg-up' : 'bg-down'"
            :style="{ width: `${Math.max(0, Math.min(100, (item.policy.supportPct + item.net) * 100))}%` }"
          />
        </div>
        <p class="tnum pt-1 text-[11px] text-muted">
          apoio {{ formatPercent(item.policy.supportPct, 0) }}
          <span v-if="item.net !== 0" :class="item.net > 0 ? 'text-up' : 'text-down'">
            · lobby {{ item.net > 0 ? '+' : '' }}{{ (item.net * 100).toFixed(1) }} pp
          </span>
        </p>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <button
            class="min-h-[36px] rounded-lg border border-line text-xs disabled:opacity-30"
            :disabled="!amount"
            @click="lobby(item.policy.id, 1)"
          >
            Lobby a favor
          </button>
          <button
            class="min-h-[36px] rounded-lg border border-line text-xs disabled:opacity-30"
            :disabled="!amount"
            @click="lobby(item.policy.id, -1)"
          >
            Lobby contra
          </button>
        </div>
      </div>
    </div>

    <div class="rounded-2xl border border-line bg-surface p-4">
      <p class="pb-2 text-sm font-medium">Congresso</p>
      <div
        v-for="politician in politicians"
        :key="politician.id"
        class="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0 first:pt-0"
      >
        <div class="min-w-0">
          <p class="truncate text-sm">
            {{ politician.name }}
            <span class="text-[11px] text-muted">{{ politician.party }}</span>
          </p>
          <p class="tnum text-[11px] text-muted">
            aprovação {{ Math.round(politician.approval) }}
            <span v-if="politician.office">· {{ politician.office }}</span>
            <span v-if="politician.loyaltyToPlayer > 1" class="text-accent">
              · lealdade {{ Math.round(politician.loyaltyToPlayer) }}
            </span>
          </p>
        </div>
        <button
          class="min-h-[36px] shrink-0 rounded-lg border border-line px-3 text-xs disabled:opacity-30"
          :disabled="!amount"
          @click="donate(politician.id)"
        >
          Doar
        </button>
      </div>
    </div>

    <div v-if="approved.length" class="rounded-2xl border border-line bg-surface p-4">
      <p class="pb-1 text-sm font-medium">Em vigor</p>
      <p v-for="policy in approved" :key="policy.id" class="text-[11px] text-muted">
        · {{ policy.name }}
      </p>
    </div>

    <p class="px-1 text-[11px] text-muted">
      Doação de empresa é rastreável; doação pessoal, menos. Prova é o que condena
      numa investigação — chamar atenção, sozinho, não.
    </p>
  </div>
</template>
