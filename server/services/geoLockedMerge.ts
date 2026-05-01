import type { GeoPlace } from '../types/geo';
import { normalizeGeoName } from './geoPlaceEnrich';

/** 将「锁定」快照覆盖或补回当月列表（锁定键为 normalizeGeoName） */
export function mergeWithLockedGeoPlaces(
  fresh: GeoPlace[],
  lockedRows: Array<{ place_key: string; place_snapshot_json: string }>
): GeoPlace[] {
  const map = new Map<string, GeoPlace>();
  for (const p of fresh) {
    map.set(normalizeGeoName(p.name), p);
  }
  for (const row of lockedRows) {
    try {
      const snap = JSON.parse(row.place_snapshot_json) as GeoPlace;
      if (snap?.name) map.set(row.place_key.trim(), snap);
    } catch {
      // skip broken snapshot
    }
  }
  return Array.from(map.values());
}
