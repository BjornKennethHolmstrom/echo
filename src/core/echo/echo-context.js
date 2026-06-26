/**
 * ECHO — contextual analysis.
 *
 * A panel of observers can be near-independent on one kind of quantity and a
 * monoculture on another (independent on physical geography, locked in step on
 * economics, say). Global ρ averages that away. analyzeByCategory splits the
 * battery by an item `category` and reports ρ, the reduction factor, and N_eff
 * within each — a domain-by-domain variety map.
 *
 * Items carry `category` when the battery has a category/domain/cat column
 * (the loader folds it into each item). Items without one fall under
 * "uncategorized".
 */

import { analyze } from './echo-core.js';

const MONOCULTURE_RHO = 0.9;

/**
 * @returns array (sorted by category name) of:
 *   { category, n, rho, reduction, nEff, monoculture, report }
 * Categories with fewer than 2 items get report: null and a note.
 */
export function analyzeByCategory(items, estimates, options = {}) {
  const { bootstrap = false, ...rest } = options;

  const groups = new Map();
  items.forEach((item, i) => {
    const cat = item.category || 'uncategorized';
    if (!groups.has(cat)) groups.set(cat, { items: [], estimates: [] });
    const g = groups.get(cat);
    g.items.push(item);
    g.estimates.push(estimates[i]);
  });

  const out = [];
  for (const [category, g] of groups) {
    if (g.items.length < 2) {
      out.push({ category, n: g.items.length, rho: NaN, reduction: NaN, nEff: NaN, monoculture: false, report: null });
      continue;
    }
    const report = analyze(g.items, g.estimates, { ...rest, bootstrap });
    const rho = report.rho.meanPairwise;
    out.push({
      category,
      n: g.items.length,
      rho,
      reduction: report.reduction.realized,
      nEff: report.nEff,
      monoculture: Number.isFinite(rho) && rho > MONOCULTURE_RHO,
      report,
    });
  }

  out.sort((a, b) => a.category.localeCompare(b.category));
  return out;
}

export { MONOCULTURE_RHO };
