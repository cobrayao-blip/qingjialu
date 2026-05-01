import { createHash } from 'crypto';
import type { GeoCitation, GeoEvidenceStrength, GeoPlace } from '../types/geo';

export function normalizeGeoName(name: string) {
  return name.replace(/\s+/g, '').trim();
}

function stablePlaceId(name: string) {
  const key = normalizeGeoName(name);
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 10);
  return `geo:${hash}`;
}

function containsAny(haystack: string, needles: string[]) {
  return needles.some((n) => n && haystack.includes(n));
}

function inferEvidenceStrength(placeName: string, aliases: string[] | undefined, citation: GeoCitation): GeoEvidenceStrength {
  const quote = citation.quoteText;
  const title = citation.chapterTitle;
  const needles = [normalizeGeoName(placeName), ...(aliases ?? []).map((a) => normalizeGeoName(a))].filter(Boolean);
  if (containsAny(quote, needles)) return 'direct';
  if (containsAny(title, needles)) return 'indirect';
  return 'inferred';
}

export function enrichGeoPlace(place: GeoPlace): GeoPlace {
  const name = place.name.trim();
  const aliases = Array.isArray(place.aliases) ? place.aliases.map((a) => a.trim()).filter(Boolean) : [];
  const citations = (place.citations || []).map((c) => ({
    ...c,
    evidenceStrength: (c.evidenceStrength as GeoEvidenceStrength | undefined) ?? inferEvidenceStrength(name, aliases, c),
  }));

  const ancientEvidence = place.ancientEvidence?.trim();
  let ancientSummary = place.ancientSummary?.trim() || '';
  const modernFactual = place.modernFactual?.trim();
  const modernInterpretation = place.modernInterpretation?.trim();
  let modernSummary = place.modernSummary?.trim() || '';

  if (!ancientSummary && ancientEvidence) ancientSummary = ancientEvidence;
  if (!modernSummary) {
    const parts = [modernFactual, modernInterpretation].filter(Boolean);
    modernSummary = parts.join(' ').trim();
  }
  if (!modernSummary) {
    modernSummary = '（本词条暂缺现代侧说明，可点击「重新抽取」补全）';
  }

  return {
    ...place,
    id: stablePlaceId(name),
    name,
    aliases: aliases.length ? aliases : undefined,
    ancientEvidence: ancientEvidence || undefined,
    ancientSummary,
    modernFactual: modernFactual || undefined,
    modernInterpretation: modernInterpretation || undefined,
    modernSummary,
    citations,
  };
}
