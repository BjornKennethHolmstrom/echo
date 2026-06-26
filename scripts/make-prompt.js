// scripts/make-prompt.js  ->  node scripts/make-prompt.js > items.txt
import { readFile } from 'node:fs/promises';
import { parseCsv } from '../src/core/echo/echo-load.js';
const rows = parseCsv(await readFile('battery.csv', 'utf8'));
const h = rows[0].map((s) => s.trim());
const [id, notes, units] = ['id', 'notes', 'units'].map((n) => h.indexOf(n));
for (const r of rows.slice(1)) console.log(`${r[id]} | ${r[notes]} | unit: ${r[units]}`);
