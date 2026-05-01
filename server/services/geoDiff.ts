import type { GeoPlace } from '../types/geo';
import { normalizeGeoName } from './geoPlaceEnrich';

function citeKey(c: { sectionId?: string; quoteText?: string }) {
  return `${c.sectionId || ''}|${(c.quoteText || '').slice(0, 120)}`;
}

export interface GeoPlacesDiff {
  added: string[];
  removed: string[];
  changed: Array<{ name: string; fields: string[] }>;
  citationChanges: Array<{ name: string; addedCites: number; removedCites: number }>;
}

export function computeGeoPlacesDiff(before: GeoPlace[], after: GeoPlace[]): GeoPlacesDiff {
  const key = (p: GeoPlace) => normalizeGeoName(p.name);
  const bMap = new Map(before.map((p) => [key(p), p]));
  const aMap = new Map(after.map((p) => [key(p), p]));
  const removed = before.filter((p) => !aMap.has(key(p))).map((p) => p.name);
  const added = after.filter((p) => !bMap.has(key(p))).map((p) => p.name);
  const changed: GeoPlacesDiff['changed'] = [];
  const citationChanges: GeoPlacesDiff['citationChanges'] = [];

  for (const [k, ap] of aMap) {
    const bp = bMap.get(k);
    if (!bp) continue;
    const fields: string[] = [];
    if (JSON.stringify(bp.citations) !== JSON.stringify(ap.citations)) fields.push('citations');
    if (bp.modernSummary !== ap.modernSummary) fields.push('modernSummary');
    if (bp.ancientSummary !== ap.ancientSummary) fields.push('ancientSummary');
    if (bp.ancientEvidence !== ap.ancientEvidence) fields.push('ancientEvidence');
    if (bp.modernFactual !== ap.modernFactual) fields.push('modernFactual');
    if (bp.modernInterpretation !== ap.modernInterpretation) fields.push('modernInterpretation');
    if (bp.status !== ap.status) fields.push('status');
    if (fields.length) changed.push({ name: ap.name, fields });

    const bSet = new Set((bp.citations || []).map(citeKey));
    const aSet = new Set((ap.citations || []).map(citeKey));
    let addC = 0;
    let remC = 0;
    for (const x of aSet) if (!bSet.has(x)) addC++;
    for (const x of bSet) if (!aSet.has(x)) remC++;
    if (addC || remC) citationChanges.push({ name: ap.name, addedCites: addC, removedCites: remC });
  }

  return { added, removed, changed, citationChanges };
}
