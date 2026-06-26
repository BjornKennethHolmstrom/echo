import { analyzeByCategory } from '@/core/echo/echo-context';
import { makeRng } from '@/core/echo/echo-core';

// reproducible equicorrelated errors (truth = 0, metric 'raw' so error == estimate)
function gauss(seed) {
  const r = makeRng(seed);
  return () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}
function block(category, n, N, rho, seed) {
  const g = gauss(seed);
  const items = [];
  const estimates = [];
  for (let i = 0; i < n; i++) {
    const common = g();
    const row = [];
    for (let j = 0; j < N; j++) row.push(Math.sqrt(rho) * common + Math.sqrt(1 - rho) * g());
    items.push({ id: `${category}_${i}`, truth: 0, category });
    estimates.push(row);
  }
  return { items, estimates };
}

describe('analyzeByCategory', () => {
  test('separates a monoculture category from an independent one', () => {
    const eco = block('economics', 300, 4, 0.95, 1); // locked in step
    const geo = block('geography', 300, 4, 0.05, 2); // nearly independent
    const items = [...eco.items, ...geo.items];
    const estimates = [...eco.estimates, ...geo.estimates];

    const res = analyzeByCategory(items, estimates, { metric: 'raw' });
    const byCat = Object.fromEntries(res.map((r) => [r.category, r]));

    expect(byCat.economics.rho).toBeGreaterThan(0.9);
    expect(byCat.economics.monoculture).toBe(true);
    expect(byCat.geography.rho).toBeLessThan(0.3);
    expect(byCat.geography.monoculture).toBe(false);
    // independent category should show a far better reduction factor
    expect(byCat.geography.reduction).toBeGreaterThan(byCat.economics.reduction);
  });

  test('items without a category fall under "uncategorized"', () => {
    const items = [
      { id: 'a', truth: 10 },
      { id: 'b', truth: 20 },
      { id: 'c', truth: 30 },
    ];
    const estimates = [[9, 11], [19, 21], [29, 31]];
    const res = analyzeByCategory(items, estimates, { metric: 'raw' });
    expect(res).toHaveLength(1);
    expect(res[0].category).toBe('uncategorized');
  });

  test('a category with a single item is reported but not analysed', () => {
    const items = [
      { id: 'a', truth: 10, category: 'solo' },
      { id: 'b', truth: 20, category: 'pair' },
      { id: 'c', truth: 30, category: 'pair' },
    ];
    const estimates = [[9, 11], [19, 21], [29, 31]];
    const res = analyzeByCategory(items, estimates, { metric: 'raw' });
    const solo = res.find((r) => r.category === 'solo');
    expect(solo.n).toBe(1);
    expect(solo.report).toBeNull();
  });
});
