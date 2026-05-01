import { dashscopeChatJson } from '../llm/dashscope';
import type { GeoCitation, GeoPlace } from '../types/geo';
import { validateGeoPlaces } from './geoValidation';
import { enrichGeoPlace } from './geoPlaceEnrich';
import type { QingJiaLuSection } from '../qingjialuSource';

const GEO_EXTRACT_MONTH_SYSTEM = `你是《清嘉录》地理抽取助手。请仅根据提供的原文抽取地点信息，输出 JSON：
{
  "places": [
    {
      "name": "地点名",
      "aliases": ["别名、异写、古今并称（如圆妙观/玄妙观）"],
      "ancientEvidence": "只用原文可支撑的一句话（尽量贴近引文）",
      "ancientSummary": "可选：对清代侧做更完整的白话概括（不要编造引文没有的事实）",
      "citations": [
        { "chapterTitle": "小节标题", "quoteText": "原文连续片段" }
      ]
    }
  ]
}
要求：每条 places 至少 1 条 citations；不得编造原文未出现地点。`;

const GEO_COMPARE_MONTH_SYSTEM = `你是古今地理对照助手。基于给定地点与原文引用补全现代说明，输出 JSON：
{
  "places": [
    {
      "id": "id",
      "name": "地点名",
      "aliases": [],
      "ancientEvidence": "文献可证要点（必须可由 citations 支撑）",
      "ancientSummary": "可选：清代侧补充解释（克制）",
      "modernFactual": "现代侧可核对信息（地点是否仍存在、大致区位等）",
      "modernInterpretation": "现代侧推断/类比/旅游化叙述（必须克制，不确定写待考）",
      "modernSummary": "现代侧一句话总述（可与 factual/interpretation 不重复）",
      "status": "存续|已变迁|待考",
      "months": ["正月"],
      "citations": [
        { "sectionId": "id", "chapterTitle": "小节", "quoteText": "...", "evidenceStrength": "direct|indirect|inferred" }
      ]
    }
  ]
}
要求：保留 citations，不要删除或新增无依据地点；evidenceStrength 必须自洽。`;

export async function generateGeoMonthPlacesFromSections(
  monthTrimmed: string,
  sections: QingJiaLuSection[],
  apiKey: string,
  modelText: string,
  urlText: string
): Promise<GeoPlace[]> {
  if (sections.length === 0) return [];

  const sourceText = sections.map((s) => `【${s.title}】\n${s.content}`).join('\n\n');
  const extracted = await dashscopeChatJson<{
    places: Array<{
      name: string;
      aliases?: string[];
      ancientEvidence?: string;
      ancientSummary?: string;
      citations: Array<{ chapterTitle: string; quoteText: string }>;
    }>;
  }>(
    apiKey,
    GEO_EXTRACT_MONTH_SYSTEM,
    `请从${monthTrimmed}原文抽取地点条目：\n\n${sourceText}`,
    modelText,
    urlText
  );

  const resolveSectionId = (chapterTitle: string, quoteText: string): string => {
    const byTitleAndQuote = sections.find((s) => s.title.trim() === chapterTitle.trim() && s.content.includes(quoteText.trim()));
    if (byTitleAndQuote) return byTitleAndQuote.id;
    const byTitle = sections.find((s) => s.title.trim() === chapterTitle.trim());
    if (byTitle) return byTitle.id;
    const byQuote = sections.find((s) => s.content.includes(quoteText.trim()));
    return byQuote?.id ?? '';
  };

  const normalized: GeoPlace[] = (Array.isArray(extracted?.places) ? extracted.places : [])
    .filter((p) => p?.name?.trim())
    .map((p) => {
      const citations: GeoCitation[] = (Array.isArray(p.citations) ? p.citations : [])
        .map((c) => ({
          sectionId: resolveSectionId(c.chapterTitle || '', c.quoteText || ''),
          chapterTitle: (c.chapterTitle || '').trim(),
          quoteText: (c.quoteText || '').trim(),
        }))
        .filter((c) => c.sectionId && c.chapterTitle && c.quoteText);
      const ancientEvidence = (p.ancientEvidence || '').trim();
      const ancientSummary = (p.ancientSummary || '').trim();
      return {
        id: 'tmp',
        name: p.name.trim(),
        aliases: Array.isArray(p.aliases) ? p.aliases : [],
        ancientEvidence: ancientEvidence || undefined,
        ancientSummary: ancientSummary || ancientEvidence,
        modernSummary: '待补充',
        status: '待考',
        months: [monthTrimmed],
        citations,
      } as GeoPlace;
    })
    .filter((p) => p.citations.length > 0 && (p.ancientEvidence || p.ancientSummary));

  const compared = await dashscopeChatJson<{ places: GeoPlace[] }>(
    apiKey,
    GEO_COMPARE_MONTH_SYSTEM,
    `请基于以下地点条目生成古今对照，保留全部 citations：\n\n${JSON.stringify({ places: normalized }, null, 2)}`,
    modelText,
    urlText
  );

  const quoteInSection = (c: GeoCitation) => {
    const section = sections.find((s) => s.id === c.sectionId);
    return Boolean(section && section.content.includes(c.quoteText));
  };
  const withGroundingCheck = (Array.isArray(compared?.places) ? compared.places : []).map((p) => ({
    ...p,
    months: [monthTrimmed],
    citations: (p.citations || []).filter(quoteInSection),
  }));
  const { accepted } = validateGeoPlaces(withGroundingCheck as GeoPlace[]);
  return accepted.map((p) => enrichGeoPlace(p));
}
