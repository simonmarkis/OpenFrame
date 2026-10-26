// Builds app/src/main/assets/geo/cities.tsv from GeoNames' cities5000.txt (CC BY 4.0, SPEC §8).
// Usage: node scripts/geo/make-cities.mjs <path to cities5000.txt>
// Download: https://download.geonames.org/export/dump/cities5000.zip (unzip first).
// Output, one place per line, sorted by population (largest first):
//   name <TAB> lat <TAB> lon <TAB> country code <TAB> US state (else empty) <TAB> population
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) { console.error('usage: node scripts/geo/make-cities.mjs <cities5000.txt>'); process.exit(1); }

// Populated places only: no city sections (PPLX: neighborhoods), historical, abandoned, or destroyed ones.
const SKIP = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH']);
const rows = [];
for (const line of readFileSync(src, 'utf8').split('\n')) {
  const f = line.split('\t');
  if (f.length < 15 || f[6] !== 'P' || SKIP.has(f[7])) continue;
  const name = f[1].replace(/[\t\r\n]/g, ' ').trim();
  const lat = Number(f[4]);
  const lon = Number(f[5]);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const cc = f[8];
  rows.push({ name, lat: lat.toFixed(4), lon: lon.toFixed(4), cc, st: cc === 'US' ? f[10] : '', pop: Number(f[14]) || 0 });
}
rows.sort((a, b) => b.pop - a.pop || a.name.localeCompare(b.name));
const out = fileURLToPath(new URL('../../app/src/main/assets/geo/cities.tsv', import.meta.url));
writeFileSync(out, rows.map((r) => [r.name, r.lat, r.lon, r.cc, r.st, r.pop].join('\t')).join('\n') + '\n');
console.log(`${rows.length} places -> ${out}`);
