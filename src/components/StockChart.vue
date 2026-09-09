<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ColorType,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { Candle } from '@/engine/types'
import { START_DAY, START_MONTH, START_YEAR } from '@/data/config'

const props = defineProps<{ candles: Candle[] }>()

const container = ref<HTMLDivElement | null>(null)
let chart: IChartApi | null = null
let series: ISeriesApi<'Candlestick'> | null = null

/** `dayIndex` vira data real só aqui, na UI: a engine não conhece calendário. */
const EPOCH = Date.UTC(START_YEAR, START_MONTH - 1, START_DAY) / 1000

function toSeries(candles: Candle[]): CandlestickData<UTCTimestamp>[] {
  return candles.map((candle) => ({
    time: (EPOCH + candle.dayIndex * 86_400) as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }))
}

onMounted(() => {
  if (!container.value) return
  chart = createChart(container.value, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: '#8b8b96',
      fontSize: 11,
    },
    grid: {
      vertLines: { color: 'rgba(38,38,47,0.4)' },
      horzLines: { color: 'rgba(38,38,47,0.4)' },
    },
    rightPriceScale: { borderColor: '#26262f' },
    timeScale: { borderColor: '#26262f', timeVisible: false },
    crosshair: { mode: 0 },
    // Pan e zoom por gesto, que é o que o §6 pede em touch.
    handleScroll: true,
    handleScale: true,
  })
  series = chart.addCandlestickSeries({
    upColor: '#10b981',
    downColor: '#f43f5e',
    borderUpColor: '#10b981',
    borderDownColor: '#f43f5e',
    wickUpColor: '#10b981',
    wickDownColor: '#f43f5e',
  })
  series.setData(toSeries(props.candles))
  chart.timeScale().fitContent()
})

watch(
  () => props.candles,
  (candles) => {
    series?.setData(toSeries(candles))
  },
)

onBeforeUnmount(() => {
  chart?.remove()
  chart = null
  series = null
})
</script>

<template>
  <div ref="container" class="h-56 w-full" />
</template>
