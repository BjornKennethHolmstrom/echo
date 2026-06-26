/**
 * ECHO — observer-correlation instrument, statistics core.
 *
 * The question this answers: when several observers (AI models, human
 * estimators, or a mix) each estimate the same set of quantities with known
 * ground truth, how much does averaging them actually reduce error — and how
 * far is that from the reduction you would get if their errors were
 * independent?
 *
 * The governing relation (equicorrelation model, Paper X): the error variance
 * of an equal-weight ensemble of N observers, each with error variance sigma^2
 * and pairwise error correlation rho, is
 *
 *     Var_ensemble = sigma^2 * ( (1 - rho) / N + rho )
 *
 *   rho = 0  ->  sigma^2 / N      (independence ideal: error falls as 1/N)
 *   rho = 1  ->  sigma^2          (no benefit: N observers behave as one)
 *
 * The three headline error levels (single / actual ensemble / independence
 * ideal) are MEASURED and assumption-free. rho is reported as the structural
 * summary that explains the gap between them.
 *
 * Pure, framework-agnostic ES module. No Vue, no DOM, no external deps.
 *
 * Data shapes
 * -----------
 *   items:     [{ id, truth }, ...]                 one row per quantity
 *   estimates: number[itemIndex][observerIndex]     one column per observer
 *   observers: string[]  (optional)                 observer labels
 *
 * Missing or invalid estimates are represented as null / NaN and handled by
 * pairwise-complete computation rather than dropping whole items.
 */

// --------------------------------------------------------------------------
// Seeded RNG (mulberry32) — makes bootstrap CIs exactly reproducible.
// --------------------------------------------------------------------------

/** @returns {() => number} a deterministic generator of floats in [0, 1). */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --------------------------------------------------------------------------
// Error metrics. Each maps (estimate, truth) -> a scale-comparable error.
// --------------------------------------------------------------------------

export const METRICS = {
  // Signed difference. Only meaningful when all items share a scale.
  raw: (estimate, truth) => estimate - truth,
  // Dimensionless; comparable across items of different magnitude.
  relative: (estimate, truth) => (estimate - truth) / truth,
  // Symmetric in ratio terms; the right default for positive magnitudes
  // (populations, budgets) that span orders of magnitude.
  log: (estimate, truth) => Math.log(estimate) - Math.log(truth),
};

export function isNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Build the [item][observer] error matrix under a chosen metric.
 * Entries that cannot be computed (missing values, or domain violations such
 * as log of a non-positive number) become NaN.
 */
export function computeErrorMatrix(items, estimates, metric = 'log') {
  const fn = METRICS[metric];
  if (!fn) throw new Error(`Unknown metric "${metric}". Use one of: ${Object.keys(METRICS).join(', ')}.`);
  return items.map((item, i) => {
    const truth = item.truth;
    const row = estimates[i] || [];
    return row.map((est) => {
      if (!isNum(est) || !isNum(truth)) return NaN;
      if (metric === 'log' && (est <= 0 || truth <= 0)) return NaN;
      if (metric === 'relative' && truth === 0) return NaN;
      const e = fn(est, truth);
      return Number.isFinite(e) ? e : NaN;
    });
  });
}

// --------------------------------------------------------------------------
// Low-level statistics.
// --------------------------------------------------------------------------

export function mean(xs) {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

/** Sample covariance over pairwise-complete observations of two columns. */
export function pairCovariance(xs, ys) {
  const px = [];
  const py = [];
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      px.push(xs[i]);
      py.push(ys[i]);
    }
  }
  const n = px.length;
  if (n < 2) return { cov: NaN, n };
  const mx = mean(px);
  const my = mean(py);
  let s = 0;
  for (let i = 0; i < n; i++) s += (px[i] - mx) * (py[i] - my);
  return { cov: s / (n - 1), n };
}

function column(E, j) {
  return E.map((row) => row[j]);
}

/**
 * Error covariance matrix across observers (N x N), pairwise-complete.
 * Pairs with fewer than `minOverlap` shared items yield NaN.
 */
export function errorCovarianceMatrix(E, minOverlap = 3) {
  const N = E[0] ? E[0].length : 0;
  const cols = Array.from({ length: N }, (_, j) => column(E, j));
  const cov = Array.from({ length: N }, () => new Array(N).fill(NaN));
  const counts = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let j = 0; j < N; j++) {
    for (let k = j; k < N; k++) {
      const { cov: c, n } = pairCovariance(cols[j], cols[k]);
      const val = n >= minOverlap ? c : NaN;
      cov[j][k] = val;
      cov[k][j] = val;
      counts[j][k] = n;
      counts[k][j] = n;
    }
  }
  return { cov, counts, N };
}

export function correlationMatrix(cov) {
  const N = cov.length;
  const corr = Array.from({ length: N }, () => new Array(N).fill(NaN));
  for (let j = 0; j < N; j++) {
    for (let k = 0; k < N; k++) {
      const denom = Math.sqrt(cov[j][j] * cov[k][k]);
      corr[j][k] = denom > 0 ? cov[j][k] / denom : NaN;
    }
  }
  return corr;
}

/** Mean of the strict upper triangle (the distinct off-diagonal pairs). */
export function meanOffDiagonal(M) {
  const N = M.length;
  let s = 0;
  let c = 0;
  for (let j = 0; j < N; j++) {
    for (let k = j + 1; k < N; k++) {
      if (Number.isFinite(M[j][k])) {
        s += M[j][k];
        c++;
      }
    }
  }
  return c > 0 ? s / c : NaN;
}

/** Per-item realized ensemble error: the mean of the finite errors on that item. */
export function ensembleMeanErrors(E) {
  return E.map((row) => {
    const vals = row.filter(Number.isFinite);
    return vals.length ? mean(vals) : NaN;
  });
}

function finite(xs) {
  return xs.filter(Number.isFinite);
}

function variance(xs) {
  const f = finite(xs);
  if (f.length < 2) return NaN;
  const m = mean(f);
  let s = 0;
  for (let i = 0; i < f.length; i++) s += (f[i] - m) * (f[i] - m);
  return s / (f.length - 1);
}

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// --------------------------------------------------------------------------
// Per-observer summary (bias, spread, error around truth).
// --------------------------------------------------------------------------

function perObserverStats(E, observers) {
  const N = E[0] ? E[0].length : 0;
  return Array.from({ length: N }, (_, j) => {
    const col = finite(column(E, j));
    const bias = col.length ? mean(col) : NaN; // mean signed error: systematic over/under-estimation
    const varc = variance(col); // spread of error around the observer's own bias
    const mse = col.length ? mean(col.map((e) => e * e)) : NaN; // squared error around truth (includes bias)
    return {
      observer: observers ? observers[j] : j,
      n: col.length,
      bias,
      variance: varc,
      rmseAroundTruth: Number.isFinite(mse) ? Math.sqrt(mse) : NaN,
    };
  });
}

// --------------------------------------------------------------------------
// rho estimators.
// --------------------------------------------------------------------------

/** Mean pairwise error correlation — the descriptive structural number. */
function rhoMeanPairwise(E) {
  const { cov } = errorCovarianceMatrix(E);
  return meanOffDiagonal(correlationMatrix(cov));
}

/**
 * Variance-implied rho: the equicorrelation rho that reproduces the realized
 * ensemble error reduction. Solve Var_ens = sigma^2 * ((1-rho)/N + rho):
 *   rho = (N * Var_ens / sigma^2 - 1) / (N - 1)
 */
function rhoVarianceImplied(sigma2, ensembleVar, N) {
  if (!isNum(sigma2) || sigma2 === 0 || N < 2) return NaN;
  return (N * (ensembleVar / sigma2) - 1) / (N - 1);
}

// --------------------------------------------------------------------------
// Bootstrap over items (the sampling unit). Reproducible given a seed.
// --------------------------------------------------------------------------

export function bootstrapRho(items, estimates, options = {}) {
  const { metric = 'log', B = 1000, seed = 1 } = options;
  const rng = makeRng(seed);
  const nItems = items.length;
  const samples = [];
  for (let b = 0; b < B; b++) {
    const bItems = new Array(nItems);
    const bEst = new Array(nItems);
    for (let i = 0; i < nItems; i++) {
      const r = Math.floor(rng() * nItems);
      bItems[i] = items[r];
      bEst[i] = estimates[r];
    }
    const r = rhoMeanPairwise(computeErrorMatrix(bItems, bEst, metric));
    if (Number.isFinite(r)) samples.push(r);
  }
  samples.sort((a, b) => a - b);
  return {
    ci95: [percentile(samples, 0.025), percentile(samples, 0.975)],
    nResamples: samples.length,
  };
}

// --------------------------------------------------------------------------
// Secondary prediction: is correlation stronger in the tails?
// Items are ranked by extremeness; the most extreme `tailQuantile` fraction is
// the tail, the remainder is the centre. Reported whichever way it comes out.
// --------------------------------------------------------------------------

export function tailCorrelation(items, estimates, options = {}) {
  const { metric = 'log', tailQuantile = 0.2, by = 'truth' } = options;
  const n = items.length;

  let score;
  if (by === 'truth') {
    const truths = items.map((it) => it.truth);
    const med = percentile([...truths].sort((a, b) => a - b), 0.5);
    score = truths.map((t) => Math.abs(t - med)); // distance from the median quantity
  } else if (by === 'error') {
    const E = computeErrorMatrix(items, estimates, metric);
    score = E.map((row) => {
      const f = finite(row).map(Math.abs);
      return f.length ? mean(f) : NaN;
    });
  } else {
    throw new Error(`Unknown tail axis "${by}". Use "truth" or "error".`);
  }

  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => score[b] - score[a]);
  const nTail = Math.max(2, Math.round(n * tailQuantile));
  const tailIdx = order.slice(0, nTail);
  const centralIdx = order.slice(nTail);

  const pick = (idx) => ({
    items: idx.map((i) => items[i]),
    estimates: idx.map((i) => estimates[i]),
  });
  const t = pick(tailIdx);
  const c = pick(centralIdx);

  const rhoTail = rhoMeanPairwise(computeErrorMatrix(t.items, t.estimates, metric));
  const rhoCentral = rhoMeanPairwise(computeErrorMatrix(c.items, c.estimates, metric));

  return {
    by,
    tailQuantile,
    rhoTail,
    rhoCentral,
    difference: rhoTail - rhoCentral, // > 0 supports the prediction; report regardless
    nTail: tailIdx.length,
    nCentral: centralIdx.length,
  };
}

// --------------------------------------------------------------------------
// Top-level analysis.
// --------------------------------------------------------------------------

function validate(items, estimates) {
  if (!Array.isArray(items) || !Array.isArray(estimates)) {
    throw new Error('items and estimates must both be arrays.');
  }
  if (items.length !== estimates.length) {
    throw new Error(`Row mismatch: ${items.length} items but ${estimates.length} estimate rows.`);
  }
  if (!items.length) throw new Error('No items supplied.');
  const widths = new Set(estimates.map((r) => (Array.isArray(r) ? r.length : -1)));
  if (widths.has(-1)) throw new Error('Every estimate row must be an array.');
  if (widths.size > 1) throw new Error('All estimate rows must have the same number of observers.');
}

/**
 * Run the full observer-correlation analysis.
 *
 * @returns a report object with:
 *   metric, N (observers), nItems
 *   sigma2                  typical single-observer error variance
 *   ensembleErrorVar        measured variance of the equal-weight ensemble error
 *   independenceIdealVar    sigma2 / N
 *   rmse: { single, ensemble, ideal }   the same three levels as RMS error
 *   reduction: { realized, ideal }      realized = sigma2 / ensembleErrorVar; ideal = N
 *   rho: { meanPairwise, varianceImplied, ci95, nResamples }
 *   tail: { ... }           secondary prediction
 *   perObserver: [ { observer, n, bias, variance, rmseAroundTruth } ]
 *   notes: string[]         flags worth surfacing to the user
 */
export function analyze(items, estimates, options = {}) {
  const { metric = 'log', observers = null, bootstrap = true, B = 1000, seed = 1, tailQuantile = 0.2 } = options;
  validate(items, estimates);

  const N = estimates[0].length;
  const nItems = items.length;
  const notes = [];

  const E = computeErrorMatrix(items, estimates, metric);
  const { cov, counts } = errorCovarianceMatrix(E);

  // sigma^2: mean of the finite diagonal (per-observer error variances).
  const diag = finite(cov.map((row, j) => row[j]));
  const sigma2 = diag.length ? mean(diag) : NaN;

  // Realized ensemble error variance — assumption-free, what actually happened.
  const ensembleErrorVar = variance(ensembleMeanErrors(E));
  const independenceIdealVar = isNum(sigma2) && N > 0 ? sigma2 / N : NaN;

  const rhoMP = meanOffDiagonal(correlationMatrix(cov));
  const rhoVI = rhoVarianceImplied(sigma2, ensembleErrorVar, N);

  let ci95 = [NaN, NaN];
  let nResamples = 0;
  if (bootstrap && N >= 2) {
    const bs = bootstrapRho(items, estimates, { metric, B, seed });
    ci95 = bs.ci95;
    nResamples = bs.nResamples;
  }

  const tail = N >= 2 ? tailCorrelation(items, estimates, { metric, tailQuantile }) : null;

  // Effective number of independent observers under the equicorrelation model:
  // N_eff = N / (1 + (N-1)*rho). rho->0 gives N; rho->1 gives 1.
  const nEff = N >= 1 && isNum(rhoMP) && 1 + (N - 1) * rhoMP > 0 ? N / (1 + (N - 1) * rhoMP) : N;

  if (N < 2) notes.push('Only one observer supplied: ensemble and correlation are undefined.');
  if (counts.some((row) => row.some((c) => c > 0 && c < nItems))) {
    notes.push('Some observer pairs share fewer items than the full battery; covariance uses pairwise-complete data.');
  }
  if (isNum(rhoVI) && rhoVI > 1.0001) {
    notes.push('Variance-implied rho exceeds 1: the ensemble did worse than a single observer, likely shared bias. Inspect per-observer bias.');
  }

  return {
    metric,
    N,
    nItems,
    sigma2,
    ensembleErrorVar,
    independenceIdealVar,
    rmse: {
      single: isNum(sigma2) ? Math.sqrt(sigma2) : NaN,
      ensemble: isNum(ensembleErrorVar) ? Math.sqrt(ensembleErrorVar) : NaN,
      ideal: isNum(independenceIdealVar) ? Math.sqrt(independenceIdealVar) : NaN,
    },
    reduction: {
      realized: isNum(sigma2) && ensembleErrorVar > 0 ? sigma2 / ensembleErrorVar : NaN,
      ideal: N,
    },
    rho: {
      meanPairwise: rhoMP,
      varianceImplied: rhoVI,
      ci95,
      nResamples,
    },
    nEff,
    covariance: cov,
    tail,
    perObserver: perObserverStats(E, observers),
    notes,
  };
}
