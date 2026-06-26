/**
 * build-battery.mjs — assemble a real ECHO battery from the World Bank API.
 *
 * Produces two files for split-mode loading:
 *   battery.csv            id, truth, units, source, as_of, notes(question)
 *   estimates-template.csv id + placeholder observer columns for you to fill
 *
 * Why a builder rather than a checked-in CSV: ground truth must be correct and
 * sourced. This pulls dated values straight from the World Bank, so the battery
 * is reproducible and the truth comes from the database, not from anyone's
 * memory. The World Bank API is free and needs no key.
 *
 * Run:  node scripts/build-battery.mjs
 * Needs Node 18+ (uses the global fetch). No dependencies.
 *
 * Methodology note: YEAR is set to a value that predates common AI training
 * cutoffs on purpose — that is the *controlled* condition (an observer asked
 * for a figure it may have memorised is not estimating). For an *ecological*
 * complement, build a second battery with a very recent YEAR and read the two
 * side by side. Either way, you remain responsible for the battery's fairness.
 */

// --------------------------------------------------------------------------
// CONFIG — edit freely.
// --------------------------------------------------------------------------

const YEAR = 2022;

// Slow-moving, well-measured quantities spanning many orders of magnitude
// (good for the log metric and for the tail check). code -> { label, units }.
const INDICATORS = {
  'SP.POP.TOTL': { label: 'Total population', units: 'people', category: 'demographics' },
  'NY.GDP.MKTP.CD': { label: 'GDP (current US$)', units: 'usd', category: 'economics' },
  'NY.GDP.PCAP.CD': { label: 'GDP per capita (current US$)', units: 'usd', category: 'economics' },
  'SP.DYN.LE00.IN': { label: 'Life expectancy at birth', units: 'years', category: 'health' },
  'AG.SRF.TOTL.K2': { label: 'Surface area', units: 'sq_km', category: 'geography' },
  'SP.DYN.IMRT.IN': { label: 'Infant mortality rate', units: 'per_1000_live_births', category: 'health' },
  'SL.UEM.TOTL.ZS': { label: 'Unemployment', units: 'percent_of_labour_force', category: 'economics' },
  'IT.NET.USER.ZS': { label: 'Individuals using the internet', units: 'percent_of_population', category: 'connectivity' },
  'SP.URB.TOTL.IN.ZS': { label: 'Urban population', units: 'percent_of_total', category: 'demographics' },
  'AG.LND.FRST.ZS': { label: 'Forest area', units: 'percent_of_land', category: 'geography' },
  'SH.XPD.CHEX.PC.CD': { label: 'Current health expenditure per capita', units: 'usd', category: 'health' },
  // CO2 codes have changed over time; if this returns nothing, check the
  // current code in the World Bank indicator catalogue and swap it in.
  'EN.GHG.CO2.PC.CE.AR5': { label: 'CO2 emissions per capita', units: 'tonnes', category: 'environment' },
};

// A spread across scales gives the battery range. ISO3 codes.
const COUNTRIES = [
  'SWE', 'NOR', 'DNK', 'FIN', 'ISL',
  'DEU', 'FRA', 'GBR', 'NLD', 'POL', 'EST',
  'USA', 'CAN', 'JPN', 'KOR',
  'CHN', 'IND', 'BRA', 'NGA', 'KEN',
];

// Placeholder observer columns written into the estimates template. Rename
// these to your actual observers (gpt5, claude, gemini, a human panel, ...).
const OBSERVER_PLACEHOLDERS = ['observer_a', 'observer_b', 'observer_c'];

// --------------------------------------------------------------------------
// Fetch + parse.
// --------------------------------------------------------------------------

const API = 'https://api.worldbank.org/v2';

async function fetchIndicator(code) {
  const countries = COUNTRIES.join(';');
  const url = `${API}/country/${countries}/indicator/${code}?date=${YEAR}&format=json&per_page=1000`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${code}`);
  const json = await res.json();
  // World Bank returns [ metadata, dataArray ]; dataArray is null when empty.
  if (!Array.isArray(json) || json.length < 2 || !Array.isArray(json[1])) return [];
  return json[1];
}

/** Turn one indicator's API rows into battery rows; skips null values. */
export function rowsFromApi(apiRows, code) {
  const { label, units, category } = INDICATORS[code];
  const rows = [];
  for (const r of apiRows) {
    if (r == null || r.value == null) continue;
    const iso3 = r.countryiso3code || (r.country && r.country.id) || '';
    const countryName = (r.country && r.country.value) || iso3;
    if (!iso3) continue;
    rows.push({
      id: `${iso3}__${code}`,
      truth: r.value,
      units,
      category,
      source: 'World Bank',
      as_of: String(r.date || YEAR),
      notes: `${label} — ${countryName}, ${YEAR}`,
    });
  }
  return rows;
}

// --------------------------------------------------------------------------
// CSV writing (quote fields that need it).
// --------------------------------------------------------------------------

export function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function csvLine(cells) {
  return cells.map(csvCell).join(',');
}

async function writeFile(path, text) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, text, 'utf8');
}

// --------------------------------------------------------------------------
// Main.
// --------------------------------------------------------------------------

async function main() {
  const codes = Object.keys(INDICATORS);
  const all = [];

  for (const code of codes) {
    try {
      const apiRows = await fetchIndicator(code);
      const rows = rowsFromApi(apiRows, code);
      all.push(...rows);
      console.log(`${code.padEnd(22)} ${rows.length} value(s)`);
    } catch (err) {
      console.warn(`${code.padEnd(22)} skipped: ${err.message}`);
    }
  }

  if (!all.length) {
    console.error('No data fetched. Check connectivity, country codes, and the YEAR.');
    process.exit(1);
  }

  // battery.csv
  const batteryHeader = ['id', 'truth', 'units', 'category', 'source', 'as_of', 'notes'];
  const batteryCsv = [
    csvLine(batteryHeader),
    ...all.map((r) => csvLine([r.id, r.truth, r.units, r.category, r.source, r.as_of, r.notes])),
  ].join('\n');
  await writeFile('battery.csv', batteryCsv);

  // estimates-template.csv (id + empty observer columns, with the question in
  // a comment-free way: ids only, since the estimates sheet must be id+observers).
  const estHeader = ['id', ...OBSERVER_PLACEHOLDERS];
  const estCsv = [
    csvLine(estHeader),
    ...all.map((r) => csvLine([r.id, ...OBSERVER_PLACEHOLDERS.map(() => '')])),
  ].join('\n');
  await writeFile('estimates-template.csv', estCsv);

  console.log(
    `\nWrote battery.csv (${all.length} items) and estimates-template.csv ` +
      `(${OBSERVER_PLACEHOLDERS.length} placeholder observers).`
  );
  console.log('Next: ask each observer the question in each battery row\'s notes,');
  console.log('put the numbers in estimates-template.csv, then load both in split mode.');
}

// Run only when invoked directly (so tests can import the helpers).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
