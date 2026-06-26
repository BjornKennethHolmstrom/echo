import {
  METRICS,
  computeErrorMatrix,
  pairCovariance,
  errorCovarianceMatrix,
  correlationMatrix,
  meanOffDiagonal,
  ensembleMeanErrors,
  makeRng,
  bootstrapRho,
  tailCorrelation,
  analyze,
} from '@/core/echo/echo-core';

// --- helpers: reproducible synthetic data with a known error correlation ---

function gaussianFactory(seed) {
  const r = makeRng(seed);
  return () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

// errors with equicorrelation `rho`, unit variance; truth=0 so error === estimate.
function makeData(nItems, N, rho, seed) {
  const g = gaussianFactory(seed);
  const items = [];
  const estimates = [];
  for (let i = 0; i < nItems; i++) {
    const common = g();
    const row = [];
    for (let j = 0; j < N; j++) {
      row.push(Math.sqrt(rho) * common + Math.sqrt(1 - rho) * g());
    }
    items.push({ id: i, truth: 0 });
    estimates.push(row);
  }
  return { items, estimates };
}

describe('error metrics', () => {
  test('raw, relative, log compute the expected error', () => {
    expect(METRICS.raw(12, 10)).toBe(2);
    expect(METRICS.relative(12, 10)).toBeCloseTo(0.2, 10);
    expect(METRICS.log(20, 10)).toBeCloseTo(Math.log(2), 10);
  });
});

describe('computeErrorMatrix', () => {
  const items = [{ id: 'a', truth: 10 }, { id: 'b', truth: 100 }];

  test('produces an [item][observer] matrix', () => {
    const E = computeErrorMatrix(items, [[12, 8], [90, 110]], 'relative');
    expect(E).toHaveLength(2);
    expect(E[0][0]).toBeCloseTo(0.2, 10);
    expect(E[1][1]).toBeCloseTo(0.1, 10);
  });

  test('marks invalid entries NaN without dropping the item', () => {
    const E = computeErrorMatrix(items, [[null, -5], [90, 110]], 'log');
    expect(Number.isNaN(E[0][0])).toBe(true); // missing
    expect(Number.isNaN(E[0][1])).toBe(true); // log of negative
    expect(Number.isFinite(E[1][0])).toBe(true);
  });

  test('throws on an unknown metric', () => {
    expect(() => computeErrorMatrix(items, [[1, 2], [3, 4]], 'nope')).toThrow();
  });
});

describe('covariance and correlation primitives', () => {
  test('pairCovariance uses only pairwise-complete observations', () => {
    const { cov, n } = pairCovariance([1, 2, 3, NaN], [2, 4, 6, 8]);
    expect(n).toBe(3);
    expect(cov).toBeCloseTo(2, 10); // cov of [1,2,3] and [2,4,6]
  });

  test('correlation of identical columns is 1, of negated columns is -1', () => {
    const E = [[1, 1], [2, 2], [3, 3], [4, 4]];
    const corr = correlationMatrix(errorCovarianceMatrix(E).cov);
    expect(corr[0][1]).toBeCloseTo(1, 10);

    const Eneg = [[1, -1], [2, -2], [3, -3], [4, -4]];
    const corrNeg = correlationMatrix(errorCovarianceMatrix(Eneg).cov);
    expect(corrNeg[0][1]).toBeCloseTo(-1, 10);
  });

  test('meanOffDiagonal averages the distinct pairs only', () => {
    const M = [
      [1, 0.4, 0.6],
      [0.4, 1, 0.8],
      [0.6, 0.8, 1],
    ];
    expect(meanOffDiagonal(M)).toBeCloseTo((0.4 + 0.6 + 0.8) / 3, 10);
  });

  test('ensembleMeanErrors averages finite errors per item', () => {
    expect(ensembleMeanErrors([[2, 4], [10, NaN]])).toEqual([3, 10]);
  });
});

describe('analyze recovers the equicorrelation model', () => {
  test('independent observers approach the 1/N ideal', () => {
    const { items, estimates } = makeData(1000, 6, 0.0, 42);
    const a = analyze(items, estimates, { metric: 'raw', B: 200, seed: 7 });
    expect(a.rho.meanPairwise).toBeCloseTo(0, 1); // ~0
    expect(a.reduction.realized).toBeGreaterThan(5); // close to N=6
    expect(a.ensembleErrorVar).toBeCloseTo(a.independenceIdealVar, 1);
  });

  test('near-perfectly correlated observers buy almost no reduction (the echo case)', () => {
    const { items, estimates } = makeData(1000, 6, 0.97, 42);
    const a = analyze(items, estimates, { metric: 'raw', B: 200, seed: 7 });
    expect(a.rho.meanPairwise).toBeGreaterThan(0.92);
    expect(a.reduction.realized).toBeLessThan(1.2); // six observers ~ one observer
  });

  test('moderate correlation recovers rho within tolerance', () => {
    const { items, estimates } = makeData(1000, 6, 0.5, 42);
    const a = analyze(items, estimates, { metric: 'raw', B: 200, seed: 7 });
    expect(a.rho.meanPairwise).toBeCloseTo(0.5, 1);
    expect(a.rho.varianceImplied).toBeCloseTo(0.5, 1);
  });

  test('the bootstrap CI brackets the point estimate', () => {
    const { items, estimates } = makeData(600, 5, 0.6, 11);
    const a = analyze(items, estimates, { metric: 'raw', B: 400, seed: 7 });
    expect(a.rho.ci95[0]).toBeLessThanOrEqual(a.rho.meanPairwise);
    expect(a.rho.ci95[1]).toBeGreaterThanOrEqual(a.rho.meanPairwise);
  });
});

describe('reproducibility', () => {
  test('a fixed seed yields identical bootstrap CIs', () => {
    const { items, estimates } = makeData(300, 5, 0.6, 1);
    const opt = { metric: 'raw', B: 300, seed: 99 };
    const a = analyze(items, estimates, opt);
    const b = analyze(items, estimates, opt);
    expect(a.rho.ci95).toEqual(b.rho.ci95);
  });

  test('bootstrapRho is deterministic given a seed', () => {
    const { items, estimates } = makeData(200, 4, 0.3, 2);
    const r1 = bootstrapRho(items, estimates, { metric: 'raw', B: 200, seed: 5 });
    const r2 = bootstrapRho(items, estimates, { metric: 'raw', B: 200, seed: 5 });
    expect(r1.ci95).toEqual(r2.ci95);
  });
});

describe('bias is separated from correlated noise', () => {
  test('shared bias is reported per observer and excluded from centered variance', () => {
    const g = gaussianFactory(5);
    const items = [];
    const estimates = [];
    for (let i = 0; i < 500; i++) {
      items.push({ id: i, truth: 0 });
      estimates.push([0, 0, 0, 0].map(() => 2 + g())); // all biased +2, independent noise
    }
    const a = analyze(items, estimates, { metric: 'raw', B: 100, seed: 3 });
    a.perObserver.forEach((o) => expect(o.bias).toBeCloseTo(2, 0));
    // centered ensemble variance still drops toward 1/N despite the shared bias
    expect(a.reduction.realized).toBeGreaterThan(3);
    // but RMSE around truth stays elevated because bias is real error
    expect(a.rmse.ensemble).toBeLessThan(a.perObserver[0].rmseAroundTruth);
  });
});

describe('tail correlation (secondary prediction)', () => {
  test('returns a comparable rho for tail and centre', () => {
    const { items, estimates } = makeData(400, 5, 0.5, 8);
    const t = tailCorrelation(items, estimates, { metric: 'raw', tailQuantile: 0.2 });
    expect(t.nTail + t.nCentral).toBe(400);
    expect(Number.isFinite(t.rhoTail)).toBe(true);
    expect(Number.isFinite(t.rhoCentral)).toBe(true);
    expect(t.difference).toBeCloseTo(t.rhoTail - t.rhoCentral, 10);
  });
});

describe('edge cases', () => {
  test('throws on dimension mismatch', () => {
    expect(() => analyze([{ id: 1, truth: 1 }], [[1], [2]])).toThrow(/Row mismatch/);
  });

  test('throws on ragged observer counts', () => {
    expect(() =>
      analyze([{ id: 1, truth: 1 }, { id: 2, truth: 2 }], [[1, 2], [3]])
    ).toThrow(/same number of observers/);
  });

  test('a single observer is handled with a note rather than a crash', () => {
    const items = [{ id: 1, truth: 1 }, { id: 2, truth: 2 }, { id: 3, truth: 3 }];
    const a = analyze(items, [[1.1], [2.2], [2.9]], { metric: 'raw', bootstrap: false });
    expect(a.N).toBe(1);
    expect(Number.isNaN(a.rho.meanPairwise)).toBe(true);
    expect(a.notes.join(' ')).toMatch(/one observer/i);
  });

  test('missing data is handled via pairwise-complete covariance and flagged', () => {
    const items = [{ id: 1, truth: 10 }, { id: 2, truth: 20 }, { id: 3, truth: 30 }, { id: 4, truth: 40 }];
    const estimates = [
      [11, 9],
      [21, null],
      [29, 31],
      [41, 39],
    ];
    const a = analyze(items, estimates, { metric: 'raw', bootstrap: false });
    expect(Number.isFinite(a.rho.meanPairwise)).toBe(true);
    expect(a.notes.join(' ')).toMatch(/pairwise-complete/i);
  });
});

describe('effective observers and covariance exposure', () => {
  test('nEff approaches N for independent observers and ~1 for an echo', () => {
    const indep = makeData(800, 5, 0.0, 3);
    const a1 = analyze(indep.items, indep.estimates, { metric: 'raw', bootstrap: false });
    expect(a1.nEff).toBeGreaterThan(4); // close to 5

    const echo = makeData(800, 5, 0.97, 3);
    const a2 = analyze(echo.items, echo.estimates, { metric: 'raw', bootstrap: false });
    expect(a2.nEff).toBeLessThan(1.5); // five observers behaving like one
  });

  test('the report exposes the N x N error covariance matrix', () => {
    const d = makeData(200, 4, 0.5, 1);
    const a = analyze(d.items, d.estimates, { metric: 'raw', bootstrap: false });
    expect(a.covariance).toHaveLength(4);
    expect(a.covariance[0]).toHaveLength(4);
    expect(Number.isFinite(a.covariance[0][0])).toBe(true);
  });
});
