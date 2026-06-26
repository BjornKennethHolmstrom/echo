/**
 * ECHO — plain-language interpretation.
 *
 * Turns a report into 2–4 sentences about THIS result: how correlated the
 * observers are, whether consulting more of them helps, and the honest caveats
 * (shared bias, tail behaviour, a loose estimate from a small battery). Pure;
 * returns { sentences: string[] }.
 */

const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');

function band(rho) {
  if (!Number.isFinite(rho)) return 'of unknown correlation';
  if (rho < 0.2) return 'nearly independent';
  if (rho < 0.6) return 'moderately correlated';
  if (rho < 0.85) return 'highly correlated';
  return 'almost perfectly correlated — effectively an echo';
}

export function interpret(report) {
  if (!report || report.N < 2) {
    return {
      sentences: [
        'Only one observer was supplied, so there is nothing to compare. Add at least two observers to measure correlation.',
      ],
    };
  }

  const s = [];
  const { N, nItems, sigma2 } = report;
  const rho = report.rho.meanPairwise;
  const realized = report.reduction.realized;
  const ideal = report.reduction.ideal;
  const nEffStr = f(report.nEff);

  if (!Number.isFinite(rho)) {
    return {
      sentences: [
        `Correlation could not be computed for these ${N} observers — usually too few overlapping items, or the log metric applied to non-positive values. Check the notes, and try the relative or raw metric if your quantities can be zero or negative.`,
      ],
    };
  }

  // 1. The headline read.
  s.push(
    `These ${N} observers are ${band(rho)} (ρ = ${f(rho)}). Averaging them cut error variance ` +
      `${f(realized)}× where independence would give ${ideal}× — in effect about ${nEffStr} ` +
      `independent observer${nEffStr === '1.00' ? '' : 's'}.`
  );

  // 2. What that means for using them.
  if (Number.isFinite(realized) && realized < 1.3) {
    s.push(`Consulting all ${N} is barely better than consulting one; the extra observers add little unique information.`);
  } else if (Number.isFinite(realized) && realized > 0.7 * ideal) {
    s.push(`The panel is genuinely diverse — each observer carries information the others don't, so consulting more of them pays off.`);
  } else {
    s.push(`The panel has some diversity, but well short of independence; a few observers carry most of the unique information.`);
  }

  // 3. Shared-bias caveat, only when the lean is large relative to the error.
  const biases = report.perObserver.map((o) => o.bias).filter(Number.isFinite);
  if (biases.length >= 2 && Number.isFinite(sigma2) && sigma2 > 0) {
    const allPos = biases.every((x) => x > 0);
    const allNeg = biases.every((x) => x < 0);
    const meanBias = biases.reduce((a, c) => a + c, 0) / biases.length;
    if ((allPos || allNeg) && Math.abs(meanBias) > 0.5 * Math.sqrt(sigma2)) {
      s.push(
        `They also share a systematic ${allPos ? 'over' : 'under'}-estimate; a calibration offset would help, ` +
          `but it wouldn't reduce how much their errors move together.`
      );
    }
  }

  // 4. Tail behaviour, if it points clearly one way.
  if (report.tail && Number.isFinite(report.tail.difference)) {
    if (report.tail.difference > 0.1) s.push('Their agreement is even tighter on the extreme items than the ordinary ones.');
    else if (report.tail.difference < -0.1) s.push('Their agreement loosens on the extreme items.');
  }

  // 5. How much to trust it.
  const ci = report.rho.ci95 || [NaN, NaN];
  if (Number.isFinite(ci[0]) && Number.isFinite(ci[1]) && (ci[1] - ci[0] > 0.4 || nItems < 15)) {
    s.push(`With ${nItems} item${nItems === 1 ? '' : 's'}, this is a loose estimate (95% CI ${f(ci[0])}–${f(ci[1])}); add more items to firm it up.`);
  }

  return { sentences: s };
}
