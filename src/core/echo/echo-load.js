/**
 * ECHO — CSV loaders.
 *
 * Two input shapes, one normalized output. Both `loadWide` and `loadSplit`
 * return { items, observers, estimates, warnings }, which plugs straight into
 * analyze(items, estimates, { observers }).
 *
 *   Wide:  one sheet. Columns: id, truth, optional meta (units/source/as_of),
 *          then one column per observer. Convenient for spreadsheet authoring.
 *
 *   Split: a battery sheet (id, truth, meta) joined on id to an estimates sheet
 *          (id, then one column per observer). Keeps ground truth separate from
 *          observers — the right shape when estimates are collected independently
 *          or estimators should not see the truth.
 *
 * Structural problems (a missing id/truth column) throw. Data problems (a bad
 * row, a duplicate id, an unmatched estimate) are collected into `warnings`
 * rather than aborting, so a messy file still yields a usable result you can
 * inspect. No external dependencies; the CSV parser handles standard quoting.
 */

// --------------------------------------------------------------------------
// CSV parsing (RFC 4180-ish: quoted fields, "" escapes, commas and newlines
// inside quotes, CRLF or LF, optional trailing newline, BOM).
// --------------------------------------------------------------------------

export function parseCsv(text) {
  if (typeof text !== 'string') throw new Error('parseCsv expects a string.');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const n = text.length;

  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // ignore; the following \n (or end) closes the row
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0 || inQuotes) {
    row.push(field);
    rows.push(row);
  }
  // drop blank lines (rows whose cells are all empty/whitespace)
  return rows.filter((r) => !r.every((cell) => cell.trim() === ''));
}

// --------------------------------------------------------------------------
// Tolerant numeric coercion. Handles thousands separators, leading/trailing
// currency or unit text ($, €, kr, %), and common null tokens. Returns null
// for missing/unparseable, which the analysis treats as missing data.
// Assumes "." as the decimal mark.
// --------------------------------------------------------------------------

const NULL_TOKENS = new Set(['', 'na', 'n/a', 'null', 'nan', 'none', '-', '\u2014']);

export function coerceNumber(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (NULL_TOKENS.has(s.toLowerCase())) return null;
  const cleaned = s.replace(/[\s,_]/g, '');
  const m = cleaned.match(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/);
  return m ? Number(m[0]) : null;
}

// --------------------------------------------------------------------------
// Header helpers.
// --------------------------------------------------------------------------

function colIndex(header, name) {
  const target = String(name).trim().toLowerCase();
  return header.findIndex((h) => h.trim().toLowerCase() === target);
}

function metaKeyFor(headerCell) {
  const t = headerCell.trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (['units', 'unit'].includes(t)) return 'units';
  if (['source', 'src'].includes(t)) return 'source';
  if (['as_of', 'asof', 'as_of_date', 'date'].includes(t)) return 'asOf';
  if (['notes', 'note', 'description', 'desc'].includes(t)) return 'notes';
  if (['category', 'cat', 'domain'].includes(t)) return 'category';
  return null;
}

function camelize(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[-\s]+(.)?/g, (_, ch) => (ch ? ch.toUpperCase() : ''));
}

/** Returns { columnIndex: metaKey } for meta columns. */
function resolveMeta(header, metaColumns) {
  const map = {};
  if (metaColumns) {
    metaColumns.forEach((name) => {
      const ix = colIndex(header, name);
      if (ix >= 0) map[ix] = camelize(name);
    });
    return map;
  }
  header.forEach((h, i) => {
    const key = metaKeyFor(h);
    if (key) map[i] = key;
  });
  return map;
}

function requireColumns(header, idColumn, truthColumn, opts = {}) {
  const idIdx = colIndex(header, idColumn);
  if (idIdx < 0) throw new Error(`Missing id column "${idColumn}". Columns found: ${header.join(', ')}.`);
  if (opts.needTruth !== false) {
    const truthIdx = colIndex(header, truthColumn);
    if (truthIdx < 0) throw new Error(`Missing truth column "${truthColumn}". Columns found: ${header.join(', ')}.`);
    return { idIdx, truthIdx };
  }
  return { idIdx, truthIdx: -1 };
}

// --------------------------------------------------------------------------
// Wide loader.
// --------------------------------------------------------------------------

export function loadWide(csvText, options = {}) {
  const { idColumn = 'id', truthColumn = 'truth', observerColumns = null, metaColumns = null } = options;
  const rows = parseCsv(csvText);
  if (!rows.length) throw new Error('Empty CSV.');

  const header = rows[0].map((h) => h.trim());
  const body = rows.slice(1);
  const warnings = [];

  const { idIdx, truthIdx } = requireColumns(header, idColumn, truthColumn);
  const metaMap = resolveMeta(header, metaColumns);

  let observerIdx;
  if (observerColumns) {
    observerIdx = observerColumns.map((name) => {
      const ix = colIndex(header, name);
      if (ix < 0) throw new Error(`Observer column "${name}" not found.`);
      return ix;
    });
  } else {
    const reserved = new Set([idIdx, truthIdx, ...Object.keys(metaMap).map(Number)]);
    observerIdx = header.map((_, i) => i).filter((i) => !reserved.has(i));
  }
  const observers = observerIdx.map((i) => header[i]);
  if (!observers.length) warnings.push('No observer columns detected.');

  const { items, estimates } = buildRows(body, {
    idIdx,
    truthIdx,
    metaMap,
    observerIdx,
    warnings,
  });
  if (!items.length) warnings.push('No valid items parsed.');

  return { items, observers, estimates, warnings };
}

/** Shared row builder for a table that carries truth + observers together. */
function buildRows(body, { idIdx, truthIdx, metaMap, observerIdx, warnings }) {
  const items = [];
  const estimates = [];
  const seen = new Set();

  body.forEach((cells, r) => {
    const line = r + 2; // header is line 1
    const id = (cells[idIdx] ?? '').trim();
    if (id === '') {
      warnings.push(`Row ${line}: empty id, skipped.`);
      return;
    }
    const truth = coerceNumber(cells[truthIdx]);
    if (truth === null) {
      warnings.push(`Row ${line} (id "${id}"): non-numeric truth, skipped.`);
      return;
    }
    if (seen.has(id)) {
      warnings.push(`Row ${line}: duplicate id "${id}" ignored; first occurrence kept.`);
      return;
    }
    seen.add(id);

    const item = { id, truth };
    for (const [ci, key] of Object.entries(metaMap)) {
      const v = (cells[Number(ci)] ?? '').trim();
      if (v !== '') item[key] = v;
    }
    items.push(item);
    estimates.push(observerIdx.map((i) => coerceNumber(cells[i])));
  });

  return { items, estimates };
}

// --------------------------------------------------------------------------
// Split loader (battery joined to estimates on id).
// --------------------------------------------------------------------------

export function loadSplit(batteryCsv, estimatesCsv, options = {}) {
  const { idColumn = 'id', truthColumn = 'truth', observerColumns = null, metaColumns = null } = options;
  const warnings = [];

  // --- battery: id, truth, meta (no observers) ---
  const bRows = parseCsv(batteryCsv);
  if (!bRows.length) throw new Error('Empty battery CSV.');
  const bHeader = bRows[0].map((h) => h.trim());
  const { idIdx: bId, truthIdx: bTruth } = requireColumns(bHeader, idColumn, truthColumn);
  const metaMap = resolveMeta(bHeader, metaColumns);

  const items = [];
  const indexById = new Map();
  bRows.slice(1).forEach((cells, r) => {
    const line = r + 2;
    const id = (cells[bId] ?? '').trim();
    if (id === '') {
      warnings.push(`Battery row ${line}: empty id, skipped.`);
      return;
    }
    const truth = coerceNumber(cells[bTruth]);
    if (truth === null) {
      warnings.push(`Battery row ${line} (id "${id}"): non-numeric truth, skipped.`);
      return;
    }
    if (indexById.has(id)) {
      warnings.push(`Battery row ${line}: duplicate id "${id}" ignored; first kept.`);
      return;
    }
    const item = { id, truth };
    for (const [ci, key] of Object.entries(metaMap)) {
      const v = (cells[Number(ci)] ?? '').trim();
      if (v !== '') item[key] = v;
    }
    indexById.set(id, items.length);
    items.push(item);
  });
  if (!items.length) warnings.push('No valid battery items parsed.');

  // --- estimates: id + one column per observer ---
  const eRows = parseCsv(estimatesCsv);
  if (!eRows.length) throw new Error('Empty estimates CSV.');
  const eHeader = eRows[0].map((h) => h.trim());
  const eId = colIndex(eHeader, idColumn);
  if (eId < 0) throw new Error(`Estimates sheet missing id column "${idColumn}". Columns found: ${eHeader.join(', ')}.`);

  let observerIdx;
  if (observerColumns) {
    observerIdx = observerColumns.map((name) => {
      const ix = colIndex(eHeader, name);
      if (ix < 0) throw new Error(`Observer column "${name}" not found in estimates sheet.`);
      return ix;
    });
  } else {
    observerIdx = eHeader.map((_, i) => i).filter((i) => i !== eId);
  }
  const observers = observerIdx.map((i) => eHeader[i]);
  if (!observers.length) warnings.push('No observer columns detected in estimates sheet.');

  const estimates = items.map(() => observers.map(() => null));
  const matched = new Set();
  eRows.slice(1).forEach((cells, r) => {
    const line = r + 2;
    const id = (cells[eId] ?? '').trim();
    if (id === '') {
      warnings.push(`Estimates row ${line}: empty id, skipped.`);
      return;
    }
    if (!indexById.has(id)) {
      warnings.push(`Estimates row ${line}: id "${id}" not in battery, skipped.`);
      return;
    }
    if (matched.has(id)) {
      warnings.push(`Estimates row ${line}: duplicate id "${id}" ignored; first kept.`);
      return;
    }
    matched.add(id);
    estimates[indexById.get(id)] = observerIdx.map((i) => coerceNumber(cells[i]));
  });

  const missing = items.length - matched.size;
  if (missing > 0) warnings.push(`${missing} battery item(s) had no estimates row; left as missing.`);

  return { items, observers, estimates, warnings };
}

// --------------------------------------------------------------------------
// Convenience dispatcher for the UI: one call, either shape.
// --------------------------------------------------------------------------

export function load(input, options = {}) {
  if (input && typeof input === 'object' && typeof input.wide === 'string') {
    return loadWide(input.wide, options);
  }
  if (input && typeof input === 'object' && typeof input.battery === 'string' && typeof input.estimates === 'string') {
    return loadSplit(input.battery, input.estimates, options);
  }
  throw new Error('Provide { wide: csvText } or { battery: csvText, estimates: csvText }.');
}
