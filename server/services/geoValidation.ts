import type { GeoCitation, GeoPlace, GeoStatus } from '../types/geo';

const ALLOWED_STATUS: GeoStatus[] = ['存续', '已变迁', '待考'];

function normalizeCitation(citation: GeoCitation): GeoCitation | null {
  const sectionId = citation.sectionId?.trim();
  const chapterTitle = citation.chapterTitle?.trim();
  const quoteText = citation.quoteText?.trim();
  if (!sectionId || !chapterTitle || !quoteText) return null;
  return { sectionId, chapterTitle, quoteText };
}

export function validateGeoPlace(place: GeoPlace): { ok: true; value: GeoPlace } | { ok: false; reason: string } {
  const id = place.id?.trim();
  const name = place.name?.trim();
  if (!id) return { ok: false, reason: 'missing_id' };
  if (!name) return { ok: false, reason: 'missing_name' };
  if (!Array.isArray(place.months) || place.months.length === 0) return { ok: false, reason: 'missing_months' };
  const citations = Array.isArray(place.citations) ? place.citations.map(normalizeCitation).filter(Boolean) as GeoCitation[] : [];
  if (citations.length === 0) return { ok: false, reason: 'missing_citations' };
  const status = ALLOWED_STATUS.includes(place.status) ? place.status : '待考';
  const ancientEvidence = place.ancientEvidence?.trim();
  const ancientSummary = place.ancientSummary?.trim();
  const modernFactual = place.modernFactual?.trim();
  const modernInterpretation = place.modernInterpretation?.trim();
  const modernSummary = place.modernSummary?.trim();
  if (!(ancientEvidence || ancientSummary)) return { ok: false, reason: 'missing_ancient' };
  if (!(modernSummary || modernFactual || modernInterpretation)) return { ok: false, reason: 'missing_modern' };
  return {
    ok: true,
    value: {
      ...place,
      id,
      name,
      status,
      months: Array.from(new Set(place.months.map((m) => m.trim()).filter(Boolean))),
      citations,
      aliases: Array.isArray(place.aliases) ? Array.from(new Set(place.aliases.map((a) => a.trim()).filter(Boolean))) : undefined,
      ancientEvidence: ancientEvidence || undefined,
      ancientSummary: ancientSummary || '',
      modernFactual: modernFactual || undefined,
      modernInterpretation: modernInterpretation || undefined,
      modernSummary: modernSummary || '',
    },
  };
}

export function validateGeoPlaces(places: GeoPlace[]) {
  const accepted: GeoPlace[] = [];
  const rejected: { id: string; reason: string }[] = [];
  for (const place of places) {
    const result = validateGeoPlace(place);
    if (result.ok) accepted.push(result.value);
    else rejected.push({ id: place.id || place.name || 'unknown', reason: result.ok === false ? result.reason : 'unknown' });
  }
  return { accepted, rejected };
}
