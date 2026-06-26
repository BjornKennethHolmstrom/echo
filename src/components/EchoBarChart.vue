<script setup>
import { computed } from 'vue';
import { Bar } from 'vue-chartjs';
import { Chart as ChartJS, Title, Tooltip, BarElement, CategoryScale, LinearScale } from 'chart.js';

ChartJS.register(Title, Tooltip, BarElement, CategoryScale, LinearScale);

const props = defineProps({
  labels: { type: Array, required: true },
  values: { type: Array, required: true },
  title: { type: String, default: '' },
  yLabel: { type: String, default: '' },
  // index of a bar to emphasise (e.g. the independence ideal); -1 for none
  highlightIndex: { type: Number, default: -1 },
  // or several indices (e.g. monoculture categories); takes precedence if set
  highlightIndices: { type: Array, default: () => [] },
});

const highlighted = computed(() => {
  if (props.highlightIndices.length) return new Set(props.highlightIndices);
  return new Set(props.highlightIndex >= 0 ? [props.highlightIndex] : []);
});

const data = computed(() => ({
  labels: props.labels,
  datasets: [
    {
      data: props.values,
      backgroundColor: props.labels.map((_, i) => (highlighted.value.has(i) ? '#2563eb' : '#9aa4b2')),
      borderRadius: 4,
      maxBarThickness: 90,
    },
  ],
}));

const options = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    title: { display: !!props.title, text: props.title },
    tooltip: {
      callbacks: {
        label: (ctx) => (Number.isFinite(ctx.parsed.y) ? ctx.parsed.y.toPrecision(4) : '—'),
      },
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      title: { display: !!props.yLabel, text: props.yLabel },
    },
  },
}));
</script>

<template>
  <div class="chart" role="img" :aria-label="title">
    <Bar :data="data" :options="options" />
  </div>
</template>

<style scoped>
.chart {
  height: 260px;
}
</style>
