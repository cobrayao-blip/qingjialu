import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { GeoPlace } from '../types/geo';

let cachedPlaces: GeoPlace[] | null = null;

function loadGeoPlacesFromDisk(): GeoPlace[] {
  const filePath = resolve(process.cwd(), 'server/data/geo-places.v1.json');
  const raw = readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw) as GeoPlace[];
  return data
    .filter((item) => Array.isArray(item.citations) && item.citations.length > 0)
    .map((item) => ({
      ...item,
      months: Array.isArray(item.months) ? item.months : [],
      citations: item.citations.filter((c) => Boolean(c.quoteText?.trim())),
    }))
    .filter((item) => item.citations.length > 0);
}

export function listGeoPlaces(month?: string): GeoPlace[] {
  if (!cachedPlaces) cachedPlaces = loadGeoPlacesFromDisk();
  const m = typeof month === 'string' ? month.trim() : '';
  if (!m) return cachedPlaces;
  return cachedPlaces.filter((place) => place.months.includes(m));
}

export function getGeoPlaceById(id: string): GeoPlace | undefined {
  if (!cachedPlaces) cachedPlaces = loadGeoPlacesFromDisk();
  const key = id.trim();
  if (!key) return undefined;
  return cachedPlaces.find((place) => place.id === key);
}
