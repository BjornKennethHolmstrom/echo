<script setup>
import { computed } from 'vue';
import { analyzeByCategory } from '@/core/echo/echo-context';
import EchoBarChart from './EchoBarChart.vue';

const props = defineProps({
  items: { type: Array, required: true },
  estimates: { type: Array, required: true },
  observers: { type: Array, required: true },
  metric: { type: String, default: 'log' },
});

const rows = computed(() =>
  analyzeByCategory(props.items, props.estimates, { observers: props.observers, metric: props.metric })
);
const analysable = computed(() => rows.value.filter((r) => r.report));
const hasCategories = computed(
  () => !(rows.value.length === 1 && rows.value[0].category === 'uncategorized')
);

const chart = computed(() => {
  const rs = analysable.value;
  return {
    labels: rs.map((r) => `${r.category} (n=${r.n})`),
    values: rs.map((r) => r.rho),
    highlightIndices: rs.map((r, i) => (r.monoculture ? i : -1)).filter((i) => i >= 0),
  };
});

const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '—');
</script>

<template>
  <section class="panel">
    <h2>Correlation by domain</h2>

    <p v-if="!hasCategories" class="hint">
      Add a <code>category</code> column to your battery (e.g. demographics, economics, geography) to see
      where your panel keeps its variety and where it collapses into a monoculture.
    </p>

    <template v-else>
      <p class="lead">
        Where the panel is independent and where it is an echo. Bars above 0.9 (blue) are observation
        monocultures — domains where consulting more observers buys nothing.
      </p>

      <EchoBarChart
        v-if="chart.labels.length"
        :labels="chart.labels"
        :values="chart.values"
        :highlight-indices="chart.highlightIndices"
        title="ρ by category (lower is healthier)"
        y-label="ρ (error correlation)"
      />

      <table class="cats">
        <thead>
          <tr><th>Category</th><th>n</th><th>ρ</th><th>reduction</th><th>N_eff</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.category">
            <td>{{ r.category }}</td>
            <td>{{ r.n }}</td>
            <td>{{ f3(r.rho) }}</td>
            <td>{{ f2(r.reduction) }}×</td>
            <td>{{ f2(r.nEff) }}</td>
            <td>{{ r.report ? (r.monoculture ? 'monoculture' : '') : 'too few items' }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.panel { margin-top: 1.75rem; padding-top: 1.25rem; border-top: 1px solid #e2e2e2; }
.panel h2 { margin: 0 0 0.25rem; font-size: 1.15rem; }
.lead { margin: 0 0 1rem; color: #555; font-size: 0.9rem; }
.hint { color: #555; font-size: 0.9rem; background: #f6f8ff; padding: 0.6rem 0.8rem; border-radius: 6px; }
.cats { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin-top: 1rem; }
.cats th, .cats td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid #eee; }
.cats td:not(:first-child), .cats th:not(:first-child) { text-align: right; }
.cats td:last-child, .cats th:last-child { color: #7a5a00; }
</style>
