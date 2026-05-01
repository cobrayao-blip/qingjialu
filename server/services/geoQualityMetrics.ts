import { listGeoMonthCacheRows } from '../db';
import { getAvailableMonths, getSectionById } from '../qingjialuSource';
import type { GeoPlace } from '../types/geo';
import { validateGeoPlace } from './geoValidation';
import { normalizeGeoName } from './geoPlaceEnrich';

export interface GeoQualityMetrics {
  monthsTotal: number;
  monthsWithGeoCache: number;
  coverage: number;
  totalCachedPlaces: number;
  totalCitations: number;
  citationHitRate: number;
  duplicateNameClusters: number;
  /** 对缓存条目再跑校验，未通过条数 / 总条数 */
  schemaRejectRate: number;
  lockedReviewCount: number;
}

export async function computeGeoQualityMetrics(lockedCount: number): Promise<GeoQualityMetrics> {
  const months = getAvailableMonths();
  const rows = await listGeoMonthCacheRows();
  const monthsWithCache = new Set(rows.map((r) => r.month));

  let totalCites = 0;
  let citeHits = 0;
  let dupClusters = 0;
  let totalPlaces = 0;
  let schemaFail = 0;

  for (const row of rows) {
    let payload: { places?: GeoPlace[] } = {};
    try {
      payload = JSON.parse(row.payloadJson) as { places?: GeoPlace[] };
    } catch {
      continue;
    }
    const places = Array.isArray(payload.places) ? payload.places : [];
    totalPlaces += places.length;
    const names = new Map<string, number>();
    for (const p of places) {
      const k = normalizeGeoName(p.name || '');
      names.set(k, (names.get(k) || 0) + 1);
      const vr = validateGeoPlace(p);
      if (!vr.ok) schemaFail++;
      for (const c of p.citations || []) {
        totalCites++;
        const sec = getSectionById(c.sectionId);
        if (sec && sec.content.includes(c.quoteText)) citeHits++;
      }
    }
    for (const [, n] of names) {
      if (n > 1) dupClusters++;
    }
  }

  return {
    monthsTotal: months.length,
    monthsWithGeoCache: monthsWithCache.size,
    coverage: months.length ? monthsWithCache.size / months.length : 0,
    totalCachedPlaces: totalPlaces,
    totalCitations: totalCites,
    citationHitRate: totalCites ? citeHits / totalCites : 0,
    duplicateNameClusters: dupClusters,
    schemaRejectRate: totalPlaces ? schemaFail / totalPlaces : 0,
    lockedReviewCount: lockedCount,
  };
}
