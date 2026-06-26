import { parseCsv, coerceNumber, loadWide, loadSplit, load } from '@/core/echo/echo-load';
import { analyze } from '@/core/echo/echo-core';

describe('parseCsv', () => {
  test('parses a basic grid', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  test('keeps commas and newlines inside quoted fields', () => {
    expect(parseCsv('a,b\n"x,y",2')).toEqual([['a', 'b'], ['x,y', '2']]);
    expect(parseCsv('a,b\n"line1\nline2",2')).toEqual([['a', 'b'], ['line1\nline2', '2']]);
  });

  test('unescapes doubled quotes', () => {
    expect(parseCsv('a,b\n"she said ""hi""",2')).toEqual([['a', 'b'], ['she said "hi"', '2']]);
  });

  test('handles CRLF, a trailing newline, and blank lines', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\n\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  test('strips a leading BOM', () => {
    expect(parseCsv('\ufeffa,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('coerceNumber', () => {
  test('reads plain, decimal, negative, and scientific numbers', () => {
    expect(coerceNumber('42')).toBe(42);
    expect(coerceNumber('3.14')).toBeCloseTo(3.14, 10);
    expect(coerceNumber('-7')).toBe(-7);
    expect(coerceNumber('-3.2e4')).toBe(-32000);
  });

  test('tolerates thousands separators, currency, units, and percent signs', () => {
    expect(coerceNumber('1,234,567')).toBe(1234567);
    expect(coerceNumber('$1,234.5')).toBeCloseTo(1234.5, 10);
    expect(coerceNumber('1 234 kr')).toBe(1234);
    expect(coerceNumber('12%')).toBe(12);
  });

  test('returns null for missing and null-like tokens', () => {
    expect(coerceNumber('')).toBeNull();
    expect(coerceNumber('   ')).toBeNull();
    expect(coerceNumber('N/A')).toBeNull();
    expect(coerceNumber(null)).toBeNull();
    expect(coerceNumber('xyz')).toBeNull();
  });
});

describe('loadWide', () => {
  const csv = `id,truth,units,source,gpt,claude,gemini
pop_se,10500000,people,scb,1.0e7,11000000,9500000
gdp,540,billion usd,wb,500,560,540`;

  test('infers observers and attaches recognized meta', () => {
    const w = loadWide(csv);
    expect(w.observers).toEqual(['gpt', 'claude', 'gemini']);
    expect(w.items[0]).toEqual({ id: 'pop_se', truth: 10500000, units: 'people', source: 'scb' });
    expect(w.estimates[0]).toEqual([10000000, 11000000, 9500000]);
    expect(w.warnings).toEqual([]);
  });

  test('throws when a required column is missing', () => {
    expect(() => loadWide('id,gpt\nx,1')).toThrow(/Missing truth/);
    expect(() => loadWide('truth,gpt\n1,1')).toThrow(/Missing id/);
  });

  test('warns on duplicate ids and bad truth, and reads blank cells as missing', () => {
    const w = loadWide(`id,truth,a,b
x,10,1,2
x,99,3,4
y,abc,5,6
z,30,,8`);
    expect(w.items.map((i) => i.id)).toEqual(['x', 'z']);
    expect(w.estimates[1]).toEqual([null, 8]); // z's first observer cell is blank
    expect(w.warnings).toHaveLength(2);
  });

  test('honours an explicit observer list', () => {
    const w = loadWide(csv, { observerColumns: ['gpt', 'gemini'] });
    expect(w.observers).toEqual(['gpt', 'gemini']);
    expect(w.estimates[0]).toEqual([10000000, 9500000]);
  });

  test('recognizes a category column as meta, not an observer', () => {
    const w = loadWide(`id,truth,category,gpt,claude
a,10,economics,9,11
b,30,geography,28,32`);
    expect(w.observers).toEqual(['gpt', 'claude']);
    expect(w.items[0].category).toBe('economics');
    expect(w.items[1].category).toBe('geography');
  });
});

describe('loadSplit', () => {
  const battery = `id,truth,units
a,100,kg
b,200,kg
c,300,kg`;
  const estimates = `id,m1,m2,m3
a,110,90,105
c,290,310,300
d,5,5,5`;

  test('joins estimates onto the battery by id', () => {
    const s = loadSplit(battery, estimates);
    expect(s.observers).toEqual(['m1', 'm2', 'm3']);
    expect(s.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(s.estimates[0]).toEqual([110, 90, 105]);
    expect(s.estimates[2]).toEqual([290, 310, 300]);
  });

  test('leaves unmatched battery items as missing and skips unknown estimate ids, with warnings', () => {
    const s = loadSplit(battery, estimates);
    expect(s.estimates[1]).toEqual([null, null, null]); // b has no estimates row
    expect(s.warnings.some((w) => /not in battery/.test(w))).toBe(true); // d
    expect(s.warnings.some((w) => /no estimates row/.test(w))).toBe(true); // b
  });

  test('throws when the estimates sheet lacks an id column', () => {
    expect(() => loadSplit(battery, 'm1,m2\n1,2')).toThrow(/missing id column/);
  });
});

describe('load dispatcher and integration', () => {
  const wide = `id,truth,gpt,claude,gemini
a,10,9,11,10
b,20,22,18,21
c,30,28,33,29
d,40,41,39,40`;

  test('dispatches by input shape', () => {
    expect(load({ wide }).observers).toEqual(['gpt', 'claude', 'gemini']);
    expect(load({ battery: 'id,truth\na,1', estimates: 'id,m1\na,1' }).observers).toEqual(['m1']);
    expect(() => load({})).toThrow();
  });

  test('loader output feeds analyze directly', () => {
    const { items, estimates, observers } = load({ wide });
    const report = analyze(items, estimates, { observers, bootstrap: false });
    expect(report.N).toBe(3);
    expect(report.nItems).toBe(4);
    expect(report.perObserver.map((o) => o.observer)).toEqual(['gpt', 'claude', 'gemini']);
  });
});
