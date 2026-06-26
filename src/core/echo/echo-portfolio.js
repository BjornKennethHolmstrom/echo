/**
 * ECHO — observer-portfolio optimizer (phase 2).
 *
 * Given how a set of observers' errors actually co-vary, which weighting of
 * them produces the lowest-error ensemble? This is Markowitz portfolio
 * optimisation with the error-covariance matrix in the role of the
 * return-covariance matrix: minimise wᵀΣw subject to the weights summing to 1.
 *
 * The point is decision support. The min-variance weights tell you how to
 * combine observers; under the non-negative constraint, observers that get
 * weight ~0 are redundant — their error adds nothing the others don't already
 * carry, so you can stop querying them.
 *
 * Pure, dependency-free. Imports only the covariance machinery from the core.
 */

import { computeErrorMatrix, errorCovarianceMatrix } from './echo-core.js';

// --------------------------------------------------------------------------
// Small matrix helpers.
// --------------------------------------------------------------------------

function matVec(M, v) {
  return M.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
}

function quadForm(M, v) {
  return v.reduce((s, vi, i) => s + vi * matVec(M, v)[i], 0);
}

/** Solve M x = b by Gaussian elimination with partial pivoting. */
function solve(M, b) {
  const n = b.length;
  const A = M.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null; // singular
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c];
    }
  }
  return A.map((row, i) => row[n] / row[i]); // Gauss-Jordan: matrix is diagonal here
}

/** Euclidean projection of v onto the probability simplex {w >= 0, sum w = 1}. */
function projectSimplex(v) {
  const n = v.length;
  const u = [...v].sort((a, b) => b - a);
  let cssv = 0;
  let rho = -1;
  let theta = 0;
  for (let i = 0; i < n; i++) {
    cssv += u[i];
    const t = (cssv - 1) / (i + 1);
    if (u[i] - t > 0) {
      rho = i;
      theta = t;
    }
  }
  return v.map((x) => Math.max(x - theta, 0));
}

/** Largest absolute row sum — an upper bound on the spectral norm (step sizing). */
function rowSumBound(M) {
  return Math.max(...M.map((row) => row.reduce((s, x) => s + Math.abs(x), 0)), 1e-9);
}

// --------------------------------------------------------------------------
// Core optimisation.
// --------------------------------------------------------------------------

/**
 * Minimum-variance weights over an error-covariance matrix.
 *
 * @param {number[][]} covariance  N x N error covariance (from the core).
 * @param {object} [options]
 *   nonNegative  constrain w >= 0 (default true). Enables the redundancy report.
 *   biasPenalty  lambda >= 0; penalises squared ensemble bias via Σ + λ·bbᵀ.
 *   biases       length-N per-observer bias (required iff biasPenalty > 0).
 *   ridge        diagonal regularisation as a fraction of mean variance (default 1e-6).
 *   dropThreshold weights below this are reported as "dropped" (default 1e-3).
 *   maxIter, tol  projected-gradient controls.
 * @returns { weights, ensembleVariance, equalWeightVariance, varianceReduction,
 *            effectiveObservers, dropped, converged }
 */
export function optimizeWeights(covariance, options = {}) {
  const {
    nonNegative = true,
    biasPenalty = 0,
    biases = null,
    ridge = 1e-6,
    dropThreshold = 1e-3,
    maxIter = 5000,
    tol = 1e-9,
  } = options;

  const N = covariance.length;
  if (N === 0) throw new Error('Empty covariance matrix.');
  if (covariance.some((row) => row.length !== N)) throw new Error('Covariance matrix must be square.');
  if (covariance.flat().some((x) => !Number.isFinite(x))) {
    throw new Error('Covariance matrix contains non-finite entries (missing-data gaps). Use a complete battery or restrict observers.');
  }

  // Reported variance uses the true covariance; the optimisation may use a
  // bias-penalised version M = Σ + λ·bbᵀ (also a valid covariance shape).
  const meanDiag = covariance.reduce((s, row, i) => s + row[i], 0) / N;
  const reg = ridge * (meanDiag || 1);
  const M = covariance.map((row, i) =>
    row.map((x, j) => x + (i === j ? reg : 0) + (biasPenalty > 0 && biases ? biasPenalty * biases[i] * biases[j] : 0))
  );

  let weights;
  let converged = true;

  if (!nonNegative) {
    // Closed form: w = M⁻¹1 / (1ᵀM⁻¹1).
    const ones = new Array(N).fill(1);
    const x = solve(M, ones);
    if (!x) throw new Error('Covariance is singular; add observers, a ridge, or use non-negative weights.');
    const denom = x.reduce((s, xi) => s + xi, 0);
    weights = x.map((xi) => xi / denom);
  } else {
    // Projected gradient descent on the simplex. Convex objective wᵀMw,
    // gradient 2Mw, step 1/(2L) with L an upper bound on the spectral norm.
    const step = 1 / (2 * rowSumBound(M));
    let w = new Array(N).fill(1 / N);
    for (let it = 0; it < maxIter; it++) {
      const grad = matVec(M, w).map((g) => 2 * g);
      const next = projectSimplex(w.map((wi, i) => wi - step * grad[i]));
      let diff = 0;
      for (let i = 0; i < N; i++) diff += (next[i] - w[i]) ** 2;
      w = next;
      if (Math.sqrt(diff) < tol) {
        converged = true;
        break;
      }
      converged = it < maxIter - 1;
    }
    weights = w;
  }

  const ensembleVariance = quadForm(covariance, weights);
  const ones = new Array(N).fill(1 / N);
  const equalWeightVariance = quadForm(covariance, ones);
  const sumSq = weights.reduce((s, wi) => s + wi * wi, 0);

  return {
    weights,
    ensembleVariance,
    equalWeightVariance,
    varianceReduction: ensembleVariance > 0 ? equalWeightVariance / ensembleVariance : NaN,
    // participation ratio: equal weights -> N, all weight on one -> 1.
    effectiveObservers: sumSq > 0 ? 1 / sumSq : NaN,
    dropped: weights.map((w, i) => ({ index: i, weight: w })).filter((o) => o.weight < dropThreshold),
    converged,
  };
}

// --------------------------------------------------------------------------
// Convenience: optimise straight from items/estimates, keyed by observer name.
// --------------------------------------------------------------------------

export function optimizeObservers(items, estimates, options = {}) {
  const { metric = 'log', observers = null } = options;
  const E = computeErrorMatrix(items, estimates, metric);
  const { cov } = errorCovarianceMatrix(E);

  let biases = null;
  if (options.biasPenalty > 0) {
    biases = cov.map((_, j) => {
      const col = E.map((row) => row[j]).filter(Number.isFinite);
      return col.length ? col.reduce((s, x) => s + x, 0) / col.length : 0;
    });
  }

  const result = optimizeWeights(cov, { ...options, biases });
  const names = observers || cov.map((_, i) => i);
  return {
    ...result,
    weights: result.weights.map((w, i) => ({ observer: names[i], weight: w })),
    dropped: result.dropped.map((d) => ({ observer: names[d.index], weight: d.weight })),
  };
}
