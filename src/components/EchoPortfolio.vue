<script setup>
import { ref, computed } from 'vue';
import { optimizeObservers } from '@/core/echo/echo-portfolio';
import EchoBarChart from './EchoBarChart.vue';
import InfoTip from './InfoTip.vue';

const props = defineProps({
  items: { type: Array, required: true },
  estimates: { type: Array, required: true },
  observers: { type: Array, required: true },
  metric: { type: String, default: 'log' },
});

const nonNegative = ref(true);
const biasPenalty = ref(0);

const result = computed(() => {
  try {
    return {
      ok: true,
      data: optimizeObservers(props.items, props.estimates, {
        observers: props.observers,
        metric: props.metric,
        nonNegative: nonNegative.value,
        biasPenalty: Number(biasPenalty.value),
      }),
    };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '—');
</script>

<template>
  <section class="panel">
    <h2>Observer portfolio</h2>
    <p class="lead">
      The lowest-error weighting of these observers. Under the non-negative constraint, observers at
      zero are redundant — their error is already carried by the others, so you could stop querying them.
    </p>

    <div class="controls">
      <label><input type="checkbox" v-model="nonNegative" /> Non-negative weights (allow dropping)</label>
      <label class="slider">
        Bias penalty (λ): {{ f2(biasPenalty) }}
        <input type="range" min="0" max="10" step="0.5" v-model.number="biasPenalty" />
      </label>
    </div>

    <p v-if="!result.ok" class="error">{{ result.message }}</p>

    <template v-else>
      <EchoBarChart
        :labels="result.data.weights.map((w) => w.observer)"
        :values="result.data.weights.map((w) => w.weight)"
        title="Recommended weights"
        y-label="weight"
      />

      <div class="readout">
        <div><span class="k">Ensemble variance</span><span class="v">{{ f3(result.data.ensembleVariance) }}</span></div>
        <div><span class="k">vs equal-weight</span><span class="v">{{ f3(result.data.equalWeightVariance) }}</span></div>
        <div><span class="k">Variance reduction</span><span class="v">{{ f2(result.data.varianceReduction) }}×</span></div>
        <div><span class="k">Effective observers</span><span class="v">{{ f2(result.data.effectiveObservers) }} of {{ result.data.weights.length }}</span><InfoTip label="Effective observers">How many observers are really doing the work, given the weights. If the optimiser leans on a few and zeroes the rest, this drops well below the total.</InfoTip></div>
      </div>

      <p v-if="result.data.dropped.length" class="dropped">
        Redundant (weight ≈ 0): {{ result.data.dropped.map((d) => d.observer).join(', ') }}
      </p>
    </template>
  </section>
</template>

<style scoped>
.panel { margin-top: 1.75rem; padding-top: 1.25rem; border-top: 1px solid #e2e2e2; }
.panel h2 { margin: 0 0 0.25rem; font-size: 1.15rem; }
.lead { margin: 0 0 1rem; color: #555; font-size: 0.9rem; }
.controls { display: flex; flex-wrap: wrap; gap: 1.25rem; align-items: center; margin-bottom: 1rem; font-size: 0.9rem; }
.controls .slider { display: flex; flex-direction: column; gap: 0.2rem; }
.readout { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem 1.5rem; margin-top: 1rem; font-size: 0.9rem; }
.readout .k { color: #555; margin-right: 0.6rem; }
.readout .v { font-weight: 600; }
.dropped { margin-top: 0.75rem; color: #7a5a00; background: #fff8e6; padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.85rem; }
.error { color: #b00020; background: #fde7ea; padding: 0.6rem 0.8rem; border-radius: 6px; }
</style>
