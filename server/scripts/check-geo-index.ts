import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { GeoPlace } from '../types/geo';
import { validateGeoPlaces } from '../services/geoValidation';

function main() {
  const filePath = resolve(process.cwd(), 'server/data/geo-places.v1.json');
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as GeoPlace[];
  const { accepted, rejected } = validateGeoPlaces(parsed);
  if (rejected.length > 0) {
    console.error('[geo:check] invalid entries:', rejected.length);
    for (const item of rejected) {
      console.error(`- ${item.id}: ${item.reason}`);
    }
    process.exit(1);
  }
  console.log(`[geo:check] ok. entries=${accepted.length}`);
}

main();
