import { interpret } from '@/core/echo/echo-interpret';
import { analyze, makeRng } from '@/core/echo/echo-core';

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
function equicorr(n, N, rho, seed) {
  const g = gauss(seed);
  const items = [];
  const estimates = [];
  for (let i = 0; i < n; i++) {
    const c = g();
    const row = [];
    for (let j = 0; j < N; j++) row.push(Math.sqrt(rho) * c + Math.sqrt(1 - rho) * g());
    items.push({ id: i, truth: 0 });
    estimates.push(row);
  }
  return { items, estimates };
}

const text = (report) => interpret(report).sentences.join(' ');

describe('interpret', () => {
  test('reads a highly correlated panel as an echo with little to gain', () => {
    const d = equicorr(400, 5, 0.95, 1);
    const t = text(analyze(d.items, d.estimates, { metric: 'raw' }));
    expect(t).toMatch(/echo/i);
    expect(t).toMatch(/barely better|little unique/i);
  });

  test('reads an independent panel as genuinely diverse', () => {
    const d = equicorr(400, 5, 0.03, 2);
    const t = text(analyze(d.items, d.estimates, { metric: 'raw' }));
    expect(t).toMatch(/nearly independent/i);
    expect(t).toMatch(/genuinely diverse|pays off/i);
  });

  test('flags a single observer as nothing to compare', () => {
    const t = text(analyze([{ id: 1, truth: 1 }, { id: 2, truth: 2 }], [[1.1], [1.9]], { bootstrap: false }));
    expect(t).toMatch(/nothing to compare/i);
  });

  test('explains when correlation cannot be computed', () => {
    // log metric on data that includes non-positive values -> all errors NaN
    const d = equicorr(30, 4, 0.5, 3);
    const t = text(analyze(d.items, d.estimates, { metric: 'log' }));
    expect(t).toMatch(/could not be computed/i);
  });

  test('surfaces a shared systematic bias', () => {
    const g = gauss(5);
    const items = [];
    const estimates = [];
    for (let i = 0; i < 200; i++) {
      items.push({ id: i, truth: 0 });
      estimates.push([0, 0, 0].map(() => 2 + g())); // all biased +2, independent noise
    }
    const t = text(analyze(items, estimates, { metric: 'raw', bootstrap: false }));
    expect(t).toMatch(/systematic over-estimate/i);
  });

  test('warns that a small battery gives a loose estimate', () => {
    const d = equicorr(8, 4, 0.6, 9);
    const t = text(analyze(d.items, d.estimates, { metric: 'raw' }));
    expect(t).toMatch(/loose estimate/i);
  });
});
