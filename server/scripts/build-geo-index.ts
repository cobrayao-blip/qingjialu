import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { initDb, getLlmConfig } from '../db';
import { requireDashScope } from '../llmConfig';
import { dashscopeChatJson } from '../llm/dashscope';
import { getSectionsByMonth, getAvailableMonths, type QingJiaLuSection } from '../qingjialuSource';
import { GEO_EXTRACT_SYSTEM } from '../prompts/geoExtract';
import { GEO_COMPARE_SYSTEM } from '../prompts/geoCompare';
import type { GeoCitation, GeoPlace } from '../types/geo';
import { validateGeoPlaces } from '../services/geoValidation';

interface RawExtractPlace {
  name: string;
  aliases?: string[];
  ancientSummary: string;
  citations: Array<{ chapterTitle: string; quoteText: string }>;
}

function getTextModelConfig() {
  const c = getLlmConfig();
  const modelText = c?.model_text ?? '';
  const rawUrlText = c?.url_text?.trim() ?? '';
  const urlText = rawUrlText || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  if (!modelText) throw new Error('请先在「大模型配置」→ 文本模型中填写模型名称');
  if (!urlText) throw new Error('请先在「大模型配置」→ 文本模型中填写 URL');
  return { modelText, urlText };
}

function slugify(name: string) {
  const base = name.trim().toLowerCase().replace(/\s+/g, '-');
  const hash = createHash('md5').update(name.trim()).digest('hex').slice(0, 6);
  return `${base || 'place'}-${hash}`;
}

function matchSectionId(chapterTitle: string, quoteText: string, sections: QingJiaLuSection[]): string {
  const chapter = chapterTitle.trim();
  const quote = quoteText.trim();
  const exactTitle = sections.find((s) => s.title.trim() === chapter && s.content.includes(quote));
  if (exactTitle) return exactTitle.id;
  const titleOnly = sections.find((s) => s.title.trim() === chapter);
  if (titleOnly) return titleOnly.id;
  const contentOnly = sections.find((s) => s.content.includes(quote));
  if (contentOnly) return contentOnly.id;
  return sections[0]?.id ?? '';
}

function buildMonthPrompt(month: string, sections: QingJiaLuSection[]) {
  const sourceText = sections.map((s) => `【${s.title}】\n${s.content}`).join('\n\n');
  return [
    `请从以下《清嘉录》${month}原文中抽取地理条目。`,
    '只抽取地点相关内容，返回 JSON。',
    '',
    sourceText,
  ].join('\n');
}

async function extractMonthPlaces(
  month: string,
  sections: QingJiaLuSection[],
  apiKey: string,
  modelText: string,
  urlText: string
): Promise<GeoPlace[]> {
  const data = await dashscopeChatJson<{ places: RawExtractPlace[] }>(
    apiKey,
    GEO_EXTRACT_SYSTEM,
    buildMonthPrompt(month, sections),
    modelText,
    urlText
  );
  const raw = Array.isArray(data?.places) ? data.places : [];
  return raw
    .filter((p) => p?.name?.trim() && Array.isArray(p.citations) && p.citations.length > 0)
    .map((p) => {
      const citations: GeoCitation[] = p.citations
        .map((c) => ({
          sectionId: matchSectionId(c.chapterTitle || '', c.quoteText || '', sections),
          chapterTitle: (c.chapterTitle || '').trim(),
          quoteText: (c.quoteText || '').trim(),
        }))
        .filter((c) => c.sectionId && c.chapterTitle && c.quoteText);
      return {
        id: slugify(p.name),
        name: p.name.trim(),
        aliases: Array.isArray(p.aliases) ? p.aliases : [],
        ancientSummary: (p.ancientSummary || '').trim(),
        modernSummary: '待补充',
        status: '待考',
        months: [month],
        citations,
      } as GeoPlace;
    })
    .filter((p) => p.citations.length > 0 && p.ancientSummary);
}

function mergePlaces(all: GeoPlace[]): GeoPlace[] {
  const byName = new Map<string, GeoPlace>();
  for (const item of all) {
    const key = item.name.trim();
    const found = byName.get(key);
    if (!found) {
      byName.set(key, { ...item, citations: [...item.citations], months: [...item.months], aliases: [...(item.aliases ?? [])] });
      continue;
    }
    found.months = Array.from(new Set([...found.months, ...item.months]));
    found.aliases = Array.from(new Set([...(found.aliases ?? []), ...(item.aliases ?? [])]));
    const citationKey = new Set(found.citations.map((c) => `${c.sectionId}|${c.quoteText}`));
    for (const c of item.citations) {
      const k = `${c.sectionId}|${c.quoteText}`;
      if (!citationKey.has(k)) {
        citationKey.add(k);
        found.citations.push(c);
      }
    }
    if (item.ancientSummary.length > found.ancientSummary.length) {
      found.ancientSummary = item.ancientSummary;
    }
  }
  return Array.from(byName.values()).map((p) => ({ ...p, id: slugify(p.name) }));
}

async function enrichPlaces(
  places: GeoPlace[],
  apiKey: string,
  modelText: string,
  urlText: string
): Promise<GeoPlace[]> {
  const payload = places.map((p) => ({
    id: p.id,
    name: p.name,
    aliases: p.aliases ?? [],
    months: p.months,
    ancientSummary: p.ancientSummary,
    citations: p.citations,
  }));
  const userPrompt = [
    '请在不改变引用的前提下补全现代对照与状态。',
    '注意：每条都要保留 citations 原样，不要删减。',
    '',
    JSON.stringify({ places: payload }, null, 2),
  ].join('\n');
  const data = await dashscopeChatJson<{ places: GeoPlace[] }>(
    apiKey,
    GEO_COMPARE_SYSTEM,
    userPrompt,
    modelText,
    urlText
  );
  return Array.isArray(data?.places) ? data.places : [];
}

async function main() {
  await initDb();
  const apiKey = requireDashScope();
  const { modelText, urlText } = getTextModelConfig();
  const months = getAvailableMonths();
  const extractedAll: GeoPlace[] = [];
  const monthStats: Array<{ month: string; sections: number; extracted: number }> = [];

  for (const month of months) {
    const sections = getSectionsByMonth(month);
    if (sections.length === 0) continue;
    const extracted = await extractMonthPlaces(month, sections, apiKey, modelText, urlText);
    extractedAll.push(...extracted);
    monthStats.push({ month, sections: sections.length, extracted: extracted.length });
    console.log(`[geo:build] month=${month} sections=${sections.length} extracted=${extracted.length}`);
  }

  const merged = mergePlaces(extractedAll);
  const enriched = await enrichPlaces(merged, apiKey, modelText, urlText);
  const { accepted, rejected } = validateGeoPlaces(enriched);
  const outPath = resolve(process.cwd(), 'server/data/geo-places.v1.json');
  const reportPath = resolve(process.cwd(), 'server/data/geo-build-report.json');
  writeFileSync(outPath, JSON.stringify(accepted, null, 2), 'utf8');
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        modelText,
        urlText,
        months: monthStats,
        extractedTotal: extractedAll.length,
        mergedTotal: merged.length,
        acceptedTotal: accepted.length,
        rejectedTotal: rejected.length,
        rejected,
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`[geo:build] done. accepted=${accepted.length} rejected=${rejected.length}`);
}

main().catch((err) => {
  console.error('[geo:build] failed:', err);
  process.exit(1);
});
