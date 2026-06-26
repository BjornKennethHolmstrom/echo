# ECHO

**An instrument that measures whether the observers you rely on are actually independent — by checking how much averaging their estimates reduces error, and how far that falls short of what genuine independence would give.**

ECHO takes a set of *observers* (several AI models, a panel of experts, a collection of indicators) that have each estimated the same quantities, compares them against known ground truth, and answers one question precisely: **does consulting more of them actually buy you anything?**

---

## Why this exists

Organizations increasingly lean on multiple observers and read their *agreement* as confidence, or their *average* as a better estimate. Both moves quietly assume the observers are independent. When they aren't, agreement is not evidence and averaging buys far less than it appears to — you think you have a panel, but you have an echo.

ECHO comes out of a research framework, *Governance as Engineering*, which treats governance systems as feedback systems and asks what control theory and information theory say about why they fail. One of its results (distributed sensing fails through *correlation*, not individual error) became the framework's first prediction tested against data: contemporary AI systems used as observers turned out to be near-perfectly correlated — roughly ρ ≈ 0.97 — so a six-model ensemble sat almost exactly at single-model error, where independence would have cut error about sixfold.

ECHO is the instrument that lets anyone run that test on their own observers and their own quantities, rather than taking the finding on faith. It is deliberately narrow: it measures one well-defined thing against ground truth. That narrowness is the point — it is checkable.

---

## The idea in one relation

If you average `N` observers, each with error variance `σ²` and pairwise error correlation `ρ`, the error variance of their average is:

```
Var_ensemble = σ² · ( (1 − ρ) / N + ρ )
```

Two extremes make it intuitive:

- **ρ = 0 (independent):** `Var = σ² / N`. Error falls as `1/N`. Ten independent observers cut your error variance tenfold. This is the ideal averaging is *supposed* to deliver.
- **ρ = 1 (identical errors):** `Var = σ²`. No matter how many observers you add, you stay at single-observer error. The panel is an echo.

Real observer pools sit between these. ECHO measures where yours sits. The deeper point, in the framework's terms: **a controller can only absorb the variety of disturbances it can perceive, and agreement among identical observers adds no variety.** Independent observers are what reduce error; correlated ones only feel reassuring.

---

## What you give it

Two pieces of data:

1. **A battery** — quantities whose true value is known (from public databases, audited records, anything you can defend as ground truth).
2. **Estimates** — each observer's number for each quantity.

Two input shapes, both producing the same internal result:

- **Battery + estimates (two files).** A battery sheet (`id`, `truth`, optional `units` / `source` / `as_of`) joined on `id` to an estimates sheet (`id`, then one column per observer). Use this when estimates are collected independently or estimators must not see the truth. This is the default.
- **Single sheet (one file).** `id`, `truth`, optional meta, then one column per observer. Convenient for quick exploration.

**Error metric** (selectable; `log` is the default). Governance quantities span orders of magnitude — populations in millions, budgets in billions, rates in percent — so a raw difference is meaningless across items. `log` (the log-ratio of estimate to truth) and `relative` (percentage error) are both scale-free and comparable across a mixed battery. Use `raw` only when every item shares a scale.

---

## What it tells you

- **Three error levels** — *single observer*, *your ensemble* (measured), and the *independence ideal* (`σ²/N`). These are measured directly; no model assumption. The headline is the gap between your ensemble and the ideal, summarised as a **reduction factor**: "your ensemble cut error 1.0× where independence would have cut it 4×."
- **Effective observers (N_eff)** — `N / (1 + (N−1)ρ)`, ρ translated into plain terms: how many genuinely independent observers your panel amounts to. "Four behaving like one" is the most legible version of the headline.
- **A plain-language reading** — two to four sentences interpreting *your* specific numbers (how correlated, whether consulting more helps, the honest caveats), with on-demand tooltips on the jargon terms.
- **ρ (mean pairwise)** with a **bootstrap 95% confidence interval** — the average correlation between any two observers' errors, and how uncertain that estimate is given your battery size.
- **ρ (variance-implied)** — the correlation that explains the reduction you actually got. With clean data it matches the mean-pairwise figure.
- **Tail check** — whether errors are *more* correlated on the extreme items than the central ones. Reported whichever way it comes out — a null is a real result, and so is its opposite.
- **Correlation by domain** — when the battery carries a `category` column, ρ and the reduction factor per category, with monocultures (ρ > 0.9) flagged. This is the variety-gap view: a panel can be independent on one kind of question and an echo on another, which the global average hides.
- **Observer portfolio** — the lowest-error weighting of the observers (a quadratic program over the measured error-covariance matrix). Under a non-negativity constraint, observers given weight ≈ 0 are redundant — you can stop querying them.
- **Per-observer table** — each observer's bias, variance, and RMSE against truth.
- **Notes** — data problems (duplicate ids, unmatched rows, missing cells) and analysis flags, surfaced rather than hidden.

### One subtlety worth understanding

ECHO's ρ is *centered* — it measures correlated mistakes **after** removing each observer's own systematic bias. This matters because the two failure modes are different:

- **Shared constant bias** (every observer reads 10% low across the board) still lets averaging help, because the part that *varies* between them cancels. The per-observer **bias** column shows this; ρ stays moderate.
- **Co-moving error** (on some items everyone is high, on others everyone is low, together) is the real echo trap. Averaging cannot cancel what moves in lockstep. This is what a high **ρ** catches.

The instrument separates the two on purpose. The bundled "Try example" is tuned to show the dangerous kind.

---

## How it's built

```
src/core/echo/
  echo-core.js        pure statistics — correlation, variance decomposition, bootstrap, N_eff
  echo-load.js        CSV parsing + the two loaders, no dependencies
  echo-interpret.js   plain-language reading of a report
  echo-context.js     per-category (variety-gap) analysis
  echo-portfolio.js   minimum-variance observer weighting (the QP)
  *.spec.js           a test suite beside each module
src/components/
  EchoAnalyzer.vue    the UI: upload, run, results, both panels
  EchoBarChart.vue    reusable Chart.js bar wrapper
  EchoContext.vue     correlation-by-domain panel
  EchoPortfolio.vue   interactive portfolio panel
  InfoTip.vue         inline term tooltips
scripts/
  build-battery.js    pulls a sourced, dated battery from the World Bank API
```

The split is deliberate. All the math and parsing live in pure functions that know nothing about Vue, so they can be tested in isolation, reasoned about, and extended (including by an LLM) without risk to the interface. The pipeline is just:

```js
const { items, observers, estimates, warnings } = load(input);
const report = analyze(items, estimates, { observers });
```

**The observer-portfolio optimizer** (`echo-portfolio.js`) is Markowitz portfolio optimisation with the error-covariance matrix standing in for the return-covariance matrix: minimise `wᵀΣw` subject to the weights summing to one. Unconstrained it has a closed form; with non-negativity it runs projected-gradient descent on the simplex and reports which observers are redundant. A bias penalty folds in as `Σ + λ·bbᵀ`. It operates on correlation you *measured* rather than independence you *assumed*.

---

## Running it

```bash
npm install          # once
npm run dev          # start the dev server
npm run test:unit    # run the core + loader tests
```

Open the app, click **Try example**, and the headline should land immediately: four observers, ρ ≈ 0.97, a reduction of about 1.0× against an ideal of 4×.

To build a real battery, run `node scripts/build-battery.js` (Node 18+, no key needed); it writes `battery.csv` and an `estimates-template.csv` to fill with each observer's answers, then load both in split mode.

### Deploying

The app is a static SPA and deploys to GitHub Pages via a build-and-deploy Action. Set `base` in `vite.config.js` to the repo path (e.g. `'/echo/'`) so assets resolve under the project URL.

---

## What ECHO does and does not claim

Following the parent framework's discipline of stating the boundary as plainly as the claim:

- It measures **observer error correlation against ground truth**. That is all. It does not rank observers' overall quality, judge governance, or recommend decisions.
- The **correlation result is the validated piece** — the mechanism (correlated observers buy little error reduction) is rigorous and has been tested. The wider governance framework it sits inside is, by its authors' own labelling, *in-principle*: the mathematics is sound; its reading onto institutions is an argument, not a theorem.
- **Your battery is your responsibility.** Results are only as fair as the quantities you choose. Items should have defensible ground truth, and — when observers are AI systems — you should be aware of training-cutoff contamination (a model "estimating" a figure it was trained on is not estimating). Note the `as_of` dates.
- **Small batteries give wide confidence intervals.** The bootstrap CI tells you how much to trust ρ; a handful of items will not pin it down.

---

## Provenance

ECHO is a build-out instrument for the *Governance as Engineering* research programme — a recent, solo, AI-assisted body of work that explicitly invites others to test, break, extend, and build on it. This tool operationalises one of its primitives so the correlation prediction can be run by anyone, on data its authors never saw. That is the intended relationship: the theory is diagnostic and formal; this is one of the instruments it asked for.
