# Changelog

All notable changes to ECHO are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-06-26

First working version: load observer estimates against a known-answer battery,
measure how correlated the observers' errors are, and read the result in plain
language.

### Added

- **Statistics core** (`echo-core.js`) — error-correlation analysis under the
  equicorrelation model: the three error levels (single / ensemble / independence
  ideal), the reduction factor, mean-pairwise and variance-implied ρ with a
  reproducible bootstrap CI, the tail check, per-observer bias/variance/RMSE, and
  effective independent observers (N_eff).
- **CSV loaders** (`echo-load.js`) — split mode (battery + estimates joined on
  `id`) and single-sheet mode, a dependency-free RFC-4180 parser, tolerant numeric
  coercion, and data problems collected as warnings rather than thrown.
- **Plain-language interpretation** (`echo-interpret.js`) — a few sentences reading
  the user's own result.
- **Correlation by domain** (`echo-context.js`) — per-category ρ and reduction,
  flagging monocultures (ρ > 0.9); the variety-gap view.
- **Observer-portfolio optimizer** (`echo-portfolio.js`) — minimum-variance
  weighting over the measured error covariance (closed-form unconstrained;
  projected-gradient on the simplex for non-negative weights), with a redundancy
  report and an optional bias penalty.
- **Battery builder** (`scripts/build-battery.js`) — pulls a sourced, dated,
  category-tagged battery from the World Bank API.
- **UI** — upload zones (split and single sheet), metric selector, the three-level
  bar chart, the two analysis panels, a collapsible explainer, inline term
  tooltips, and warnings.
- **Docs & deploy** — README and a GitHub Pages build-and-deploy workflow.

### Notes

- Every core module ships with a co-located test suite.
- Pure logic is fully decoupled from the Vue layer.
