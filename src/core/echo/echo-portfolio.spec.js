import { optimizeWeights, optimizeObservers } from '@/core/echo/echo-portfolio';
import { load } from '@/core/echo/echo-load';

const diag = (vs) => vs.map((v, i) => vs.map((_, j) => (i === j ? v : 0)));
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

describe('optimizeWeights', () => {
  test('weights always sum to one', () => {
    for (const opt of [{ nonNegative: false }, { nonNegative: true }]) {
      const r = optimizeWeights([[1, 0.3, 0.1], [0.3, 1, 0.2], [0.1, 0.2, 1]], opt);
      expect(sum(r.weights)).toBeCloseTo(1, 6);
    }
  });

  test('independent observers get inverse-variance weights', () => {
    const r = optimizeWeights(diag([1, 2, 4]), { nonNegative: false });
    // 1/1 : 1/2 : 1/4 -> 4/7, 2/7, 1/7
    expect(r.weights[0]).toBeCloseTo(4 / 7, 2);
    expect(r.weights[1]).toBeCloseTo(2 / 7, 2);
    expect(r.weights[2]).toBeCloseTo(1 / 7, 2);
  });

  test('leans on the independent observer when two others are correlated', () => {
    const r = optimizeWeights([[1, 0.95, 0], [0.95, 1, 0], [0, 0, 1]], { nonNegative: true });
    expect(r.weights[2]).toBeGreaterThan(r.weights[0]);
    expect(r.weights[2]).toBeGreaterThan(r.weights[1]);
  });

  test('non-negative constraint can zero out a redundant observer', () => {
    // observer 0 is correlated with both 1 and 2; the constrained optimum drops it
    const r = optimizeWeights([[1, 0.9, 0.9], [0.9, 1, 0.2], [0.9, 0.2, 1]], { nonNegative: true });
    expect(r.weights[0]).toBeCloseTo(0, 2);
    expect(r.dropped.map((d) => d.index)).toContain(0);
  });

  test('unconstrained weights may go negative (a contrarian lever)', () => {
    const r = optimizeWeights([[1, 0.9, 0.9], [0.9, 1, 0.2], [0.9, 0.2, 1]], { nonNegative: false });
    expect(Math.min(...r.weights)).toBeLessThan(0);
  });

  test('the optimised ensemble never has higher variance than equal weighting', () => {
    const cov = [[1, 0.6, 0.3], [0.6, 1, 0.5], [0.3, 0.5, 1]];
    const r = optimizeWeights(cov, { nonNegative: true });
    expect(r.ensembleVariance).toBeLessThanOrEqual(r.equalWeightVariance + 1e-9);
    expect(r.varianceReduction).toBeGreaterThanOrEqual(1 - 1e-9);
  });

  test('effective observers ranges from 1 (concentrated) to N (spread)', () => {
    const spread = optimizeWeights(diag([1, 1, 1, 1]), { nonNegative: true });
    expect(spread.effectiveObservers).toBeCloseTo(4, 1); // equal weights -> N
    const concentrated = optimizeWeights(diag([0.01, 5, 5, 5]), { nonNegative: true });
    expect(concentrated.effectiveObservers).toBeLessThan(1.5); // nearly all weight on one
  });

  test('a bias penalty shifts weight away from a biased observer', () => {
    const cov = diag([1, 1, 1]);
    const biases = [2, 0, 0]; // observer 0 is badly biased
    const plain = optimizeWeights(cov, { nonNegative: true });
    const penalised = optimizeWeights(cov, { nonNegative: true, biasPenalty: 5, biases });
    expect(penalised.weights[0]).toBeLessThan(plain.weights[0]);
  });

  test('throws on a covariance with missing-data gaps', () => {
    expect(() => optimizeWeights([[1, NaN], [NaN, 1]])).toThrow(/non-finite/);
  });
});

describe('optimizeObservers (end to end)', () => {
  const wide = `id,truth,m1,m2,m3
a,10,9,9.1,2
b,20,18,18.2,40
c,30,27,27.3,5
d,40,36,36.4,80
e,50,45,45.5,9`;

  test('returns weights keyed by observer name and identifies redundancy', () => {
    // m1 and m2 track each other closely; m3 is wild and independent
    const { items, estimates, observers } = load({ wide });
    const r = optimizeObservers(items, estimates, { observers, nonNegative: true });
    expect(r.weights.map((w) => w.observer)).toEqual(['m1', 'm2', 'm3']);
    expect(sum(r.weights.map((w) => w.weight))).toBeCloseTo(1, 6);
    expect(r.dropped.every((d) => typeof d.observer === 'string')).toBe(true);
  });
});
