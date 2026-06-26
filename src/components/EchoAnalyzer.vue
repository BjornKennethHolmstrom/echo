<script setup>
import { ref, computed } from 'vue';
import { load } from '@/core/echo/echo-load';
import { analyze } from '@/core/echo/echo-core';
import { interpret } from '@/core/echo/echo-interpret';
import EchoBarChart from './EchoBarChart.vue';
import EchoPortfolio from './EchoPortfolio.vue';
import EchoContext from './EchoContext.vue';
import InfoTip from './InfoTip.vue';

// --- input state ---------------------------------------------------------
const mode = ref('split'); // 'split' | 'single'
const metric = ref('log');

const wide = ref({ text: '', name: '' });
const battery = ref({ text: '', name: '' });
const estimates = ref({ text: '', name: '' });

const report = ref(null);
const loaded = ref(null);
const warnings = ref([]);
const errorMsg = ref('');

const canRun = computed(() =>
  mode.value === 'single' ? !!wide.value.text : !!battery.value.text && !!estimates.value.text
);

// --- file handling -------------------------------------------------------
async function readInto(target, fileList) {
  const file = fileList && fileList[0];
  if (!file) return;
  target.value = { text: await file.text(), name: file.name };
}
const onPick = (target) => (e) => readInto(target, e.target.files);
const onDrop = (target) => (e) => readInto(target, e.dataTransfer.files);

// --- run -----------------------------------------------------------------
function run() {
  errorMsg.value = '';
  report.value = null;
  loaded.value = null;
  warnings.value = [];
  try {
    const input =
      mode.value === 'single'
        ? { wide: wide.value.text }
        : { battery: battery.value.text, estimates: estimates.value.text };
    const parsed = load(input);
    warnings.value = parsed.warnings;
    report.value = analyze(parsed.items, parsed.estimates, {
      observers: parsed.observers,
      metric: metric.value,
    });
    loaded.value = { items: parsed.items, estimates: parsed.estimates, observers: parsed.observers };
  } catch (err) {
    errorMsg.value = err.message;
  }
}

function loadExample() {
  mode.value = 'single';
  wide.value = { name: 'example.csv', text: EXAMPLE };
  run();
}

// Four observers whose errors co-move item to item — on some items everyone is
// high, on others everyone is low — so their errors are ~0.97 correlated and
// averaging the four buys almost nothing. (Verified: reduction ~1.0x of 4x.)
const EXAMPLE = `id,truth,units,m_alpha,m_beta,m_gamma,m_delta
pop_sweden,10.5,millions,9.14,8.87,9.02,8.93
pop_norway,5.5,millions,6.04,5.84,6.25,5.94
pop_denmark,5.9,millions,4.83,5.12,4.99,4.93
pop_finland,5.6,millions,5.87,6.1,5.94,5.98
gdp_sweden,585,billion_usd,526,512,521,512
gdp_norway,485,billion_usd,547,536,547,566
gdp_denmark,400,billion_usd,342,341,330,341
gdp_finland,300,billion_usd,328,333,321,341
area_sweden,450,thousand_km2,381,375,363,384
area_norway,385,thousand_km2,411,445,450,437`;

// --- formatting ----------------------------------------------------------
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '\u2014');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '\u2014');

const allNotes = computed(() => [...warnings.value, ...((report.value && report.value.notes) || [])]);

const levelChart = computed(() => {
  const r = report.value;
  if (!r) return null;
  return {
    labels: ['Single observer', 'Your ensemble', 'Independence ideal'],
    values: [r.rmse.single, r.rmse.ensemble, r.rmse.ideal],
  };
});

const reading = computed(() => (report.value ? interpret(report.value).sentences : []));
</script>

<template>
  <section class="echo">
    <header class="head">
      <h1>ECHO</h1>
      <p class="sub">How much does averaging your observers actually reduce error &mdash; and how far is that from independence?</p>
    </header>

    <!-- mode -->
    <div class="modes">
      <button :class="{ on: mode === 'split' }" @click="mode = 'split'">Battery + estimates</button>
      <button :class="{ on: mode === 'single' }" @click="mode = 'single'">Single sheet</button>
      <button class="ghost" @click="loadExample">Try example</button>
    </div>

    <!-- inputs -->
    <div class="zones">
      <template v-if="mode === 'split'">
        <label class="zone" @dragover.prevent @drop.prevent="onDrop(battery)">
          <span class="zone-title">Battery</span>
          <span class="zone-hint">columns: id, truth, optional units / source / as_of</span>
          <span class="zone-file">{{ battery.name || 'drop a CSV or click to choose' }}</span>
          <input type="file" accept=".csv,text/csv" @change="onPick(battery)" />
        </label>
        <label class="zone" @dragover.prevent @drop.prevent="onDrop(estimates)">
          <span class="zone-title">Estimates</span>
          <span class="zone-hint">columns: id, then one column per observer</span>
          <span class="zone-file">{{ estimates.name || 'drop a CSV or click to choose' }}</span>
          <input type="file" accept=".csv,text/csv" @change="onPick(estimates)" />
        </label>
      </template>

      <template v-else>
        <label class="zone wide" @dragover.prevent @drop.prevent="onDrop(wide)">
          <span class="zone-title">Single sheet</span>
          <span class="zone-hint">columns: id, truth, optional meta, then one column per observer</span>
          <span class="zone-file">{{ wide.name || 'drop a CSV or click to choose' }}</span>
          <input type="file" accept=".csv,text/csv" @change="onPick(wide)" />
        </label>
      </template>
    </div>

    <div class="controls">
      <label class="metric">
        Error metric
        <select v-model="metric">
          <option value="log">log (magnitudes spanning orders)</option>
          <option value="relative">relative</option>
          <option value="raw">raw</option>
        </select>
      </label>
      <button class="run" :disabled="!canRun" @click="run">Run analysis</button>
    </div>

    <p v-if="errorMsg" class="error">{{ errorMsg }}</p>

    <!-- results -->
    <div v-if="report" class="results">
      <details class="explainer">
        <summary>What am I looking at?</summary>
        <div class="explainer-body">
          <p>
            You gave several <strong>observers</strong> the same questions, each with a known true answer.
            ECHO checks whether combining them actually helps. If the observers were truly independent,
            averaging N of them would shrink the error roughly N-fold. If they make the same mistakes,
            averaging barely helps — they're an echo, not a panel.
          </p>
          <p>
            The big number is how much averaging <em>actually</em> cut the error, versus what independence
            would have given. <strong>ρ</strong> is how alike their mistakes are (0 = independent, 1 = identical).
            <strong>Effective observers</strong> translates that into plain terms: how many genuinely independent
            views your panel amounts to. The two panels below tell you which observers are redundant, and whether
            the panel holds up better on some kinds of questions than others.
          </p>
        </div>
      </details>

      <div class="headline">
        <div class="big">
          {{ f2(report.reduction.realized) }}&times;
          <span class="vs">vs {{ report.reduction.ideal }}&times; if independent</span>
        </div>
        <p class="read">
          {{ report.N }} observers over {{ report.nItems }} items. Averaging them cut error variance
          {{ f2(report.reduction.realized) }}-fold; independent observers would have cut it
          {{ report.reduction.ideal }}-fold. In effect, your {{ report.N }} observers are doing the work of
          about <strong>{{ f2(report.nEff) }}</strong> independent one{{ f2(report.nEff) === '1.00' ? '' : 's' }}.
        </p>
      </div>

      <div v-if="reading.length" class="reading">
        <p v-for="(line, i) in reading" :key="i">{{ line }}</p>
      </div>

      <EchoBarChart
        v-if="levelChart"
        :labels="levelChart.labels"
        :values="levelChart.values"
        title="Error by configuration (lower is better)"
        y-label="RMS error"
        :highlight-index="2"
      />

      <table class="levels">
        <thead>
          <tr>
            <th>
              Error level (RMS)
              <InfoTip label="About the error levels">
                Three reference points. <strong>Single observer</strong>: the typical error of one observer.
                <strong>Your ensemble</strong>: the error you actually get by averaging them all.
                <strong>Independence ideal</strong>: the error you'd get if their mistakes were independent
                (single ÷ √N). The closer "your ensemble" sits to "single" rather than to the ideal, the more
                they echo each other.
              </InfoTip>
            </th>
            <th>value</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Single observer</td><td>{{ f3(report.rmse.single) }}</td></tr>
          <tr><td>Your ensemble (measured)</td><td>{{ f3(report.rmse.ensemble) }}</td></tr>
          <tr><td>Independence ideal</td><td>{{ f3(report.rmse.ideal) }}</td></tr>
        </tbody>
      </table>

      <div class="rho">
        <div>
          <span class="k">&rho; (mean pairwise)</span>
          <InfoTip label="About rho">
            The average correlation between any two observers' errors, after removing each observer's own
            constant bias. 0 means independent mistakes; 1 means identical mistakes. The 95% CI shows how
            firmly your battery pins it down — a small battery leaves it loose.
          </InfoTip>
          <span class="v">{{ f3(report.rho.meanPairwise) }}</span>
          <span class="ci">95% CI [{{ f3(report.rho.ci95[0]) }}, {{ f3(report.rho.ci95[1]) }}]</span>
        </div>
        <div>
          <span class="k">&rho; (variance-implied)</span>
          <InfoTip label="About variance-implied rho">
            The correlation that would explain the error reduction you actually got. With clean data it
            matches the mean-pairwise figure; a large gap hints at shared bias or uneven observers.
          </InfoTip>
          <span class="v">{{ f3(report.rho.varianceImplied) }}</span>
        </div>
        <div v-if="report.tail">
          <span class="k">tail vs centre</span>
          <InfoTip label="About the tail check">
            Whether observers agree even more on the extreme items than the ordinary ones. A positive
            difference means correlation is worse in the tails. Reported either way — a null here is a real
            (and useful) result.
          </InfoTip>
          <span class="v">{{ f3(report.tail.rhoTail) }} / {{ f3(report.tail.rhoCentral) }}</span>
          <span class="ci">diff {{ f3(report.tail.difference) }} ({{ report.tail.difference > 0 ? 'stronger in tails' : 'not stronger in tails' }})</span>
        </div>
      </div>

      <table class="observers">
        <thead>
          <tr>
            <th>Observer</th>
            <th>n</th>
            <th>
              bias
              <InfoTip label="Bias vs variance">
                <strong>Bias</strong> is an observer's average error — a steady lean high or low.
                <strong>Variance</strong> is how much its error jumps around that lean. A shared bias can be
                calibrated away; co-moving variance is the real echo. ρ above looks at the variance part,
                with bias removed.
              </InfoTip>
            </th>
            <th>variance</th>
            <th>RMSE vs truth</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in report.perObserver" :key="o.observer">
            <td>{{ o.observer }}</td>
            <td>{{ o.n }}</td>
            <td>{{ f3(o.bias) }}</td>
            <td>{{ f3(o.variance) }}</td>
            <td>{{ f3(o.rmseAroundTruth) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <EchoContext
      v-if="report && loaded"
      :items="loaded.items"
      :estimates="loaded.estimates"
      :observers="loaded.observers"
      :metric="metric"
    />

    <EchoPortfolio
      v-if="report && loaded"
      :items="loaded.items"
      :estimates="loaded.estimates"
      :observers="loaded.observers"
      :metric="metric"
    />

    <div v-if="allNotes.length" class="notes">
      <h3>Notes ({{ allNotes.length }})</h3>
      <ul>
        <li v-for="(n, i) in allNotes" :key="i">{{ n }}</li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.echo { max-width: 760px; margin: 0 auto; padding: 1.5rem; font-family: system-ui, sans-serif; color: #1c1c1c; }
.head h1 { margin: 0; letter-spacing: 0.04em; }
.sub { margin: 0.25rem 0 1.25rem; color: #555; }

.modes { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.modes button { padding: 0.4rem 0.8rem; border: 1px solid #ccc; background: #fff; border-radius: 6px; cursor: pointer; }
.modes button.on { border-color: #1c1c1c; background: #1c1c1c; color: #fff; }
.modes button.ghost { margin-left: auto; color: #555; }

.zones { display: grid; gap: 0.75rem; grid-template-columns: 1fr 1fr; }
.zone.wide { grid-column: 1 / -1; }
.zone { display: flex; flex-direction: column; gap: 0.2rem; padding: 1rem; border: 1.5px dashed #bbb; border-radius: 8px; cursor: pointer; background: #fafafa; }
.zone:hover { border-color: #888; }
.zone-title { font-weight: 600; }
.zone-hint { font-size: 0.8rem; color: #777; }
.zone-file { font-size: 0.85rem; color: #333; margin-top: 0.3rem; }
.zone input { display: none; }

.controls { display: flex; align-items: end; gap: 1rem; margin: 1rem 0; }
.metric { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; color: #555; }
.metric select { padding: 0.35rem; }
.run { margin-left: auto; padding: 0.5rem 1.1rem; border: none; border-radius: 6px; background: #1c1c1c; color: #fff; cursor: pointer; }
.run:disabled { background: #bbb; cursor: not-allowed; }

.error { color: #b00020; background: #fde7ea; padding: 0.6rem 0.8rem; border-radius: 6px; }

.results { margin-top: 1.5rem; display: grid; gap: 1.25rem; }
.explainer { border: 1px solid #e2e2e2; border-radius: 10px; padding: 0.5rem 0.9rem; background: #fbfbfb; }
.explainer summary { cursor: pointer; font-weight: 600; font-size: 0.92rem; color: #333; }
.explainer-body { margin-top: 0.5rem; }
.explainer-body p { margin: 0 0 0.6rem; font-size: 0.88rem; line-height: 1.5; color: #444; }
.explainer-body p:last-child { margin-bottom: 0; }
.reading { border-left: 3px solid #2563eb; padding: 0.1rem 0 0.1rem 0.9rem; }
.reading p { margin: 0.45rem 0; color: #333; font-size: 0.92rem; line-height: 1.5; }
.headline { padding: 1rem 1.25rem; border: 1px solid #e2e2e2; border-radius: 10px; background: #f6f8ff; }
.big { font-size: 2rem; font-weight: 700; }
.big .vs { font-size: 0.95rem; font-weight: 400; color: #555; margin-left: 0.5rem; }
.read { margin: 0.4rem 0 0; color: #444; }

table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
th, td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid #eee; }
td:last-child, th:last-child { text-align: right; }
.observers td:not(:first-child), .observers th:not(:first-child) { text-align: right; }

.rho { display: grid; gap: 0.4rem; }
.rho .k { display: inline-block; width: 12rem; color: #555; }
.rho .v { font-weight: 600; }
.rho .ci { margin-left: 0.6rem; color: #777; font-size: 0.85rem; }

.notes { margin-top: 1.25rem; padding: 0.75rem 1rem; background: #fff8e6; border: 1px solid #f0e0b0; border-radius: 8px; }
.notes h3 { margin: 0 0 0.4rem; font-size: 0.95rem; }
.notes li { font-size: 0.85rem; color: #5a4a1a; }
</style>
