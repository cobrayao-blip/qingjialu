import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface QingJiaLuSection {
  id: string;
  juan: string;
  month?: string;
  title: string;
  content: string;
}

interface Store {
  sections: QingJiaLuSection[];
  byMonth: Map<string, QingJiaLuSection[]>;
}

let store: Store | null = null;

function loadStore(): Store {
  if (store) return store;

  const jsonPath = resolve(process.cwd(), 'docs/qingjialu/sections.json');
  const raw = readFileSync(jsonPath, 'utf8');
  const sections = JSON.parse(raw) as QingJiaLuSection[];

  const byMonth = new Map<string, QingJiaLuSection[]>();
  for (const s of sections) {
    if (!s.month) continue;
    const key = s.month.trim();
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(s);
  }

  store = { sections, byMonth };
  return store;
}

export function getAllSections(): QingJiaLuSection[] {
  return loadStore().sections;
}

export function getSectionsByMonth(month: string): QingJiaLuSection[] {
  const m = month.trim();
  if (!m) return [];
  const { byMonth } = loadStore();
  return byMonth.get(m) ?? [];
}

export function getAvailableMonths(): string[] {
  const { byMonth } = loadStore();
  return Array.from(byMonth.keys());
}

/** 按 id 取单条（全文） */
export function getSectionById(id: string): QingJiaLuSection | undefined {
  const { sections } = loadStore();
  return sections.find((s) => s.id === id);
}

/** 某月小节列表（不含正文，减轻列表接口体积） */
export function getSectionSummariesByMonth(month: string): Pick<QingJiaLuSection, 'id' | 'title' | 'juan' | 'month'>[] {
  return getSectionsByMonth(month).map(({ id, title, juan, month: m }) => ({ id, title, juan, month: m }));
}

/** 从用户随意提问中抽取用于检索的关键词（软规则，无需严格 NLP） */
export function extractQjlKeywordsFromMessage(message: string): string[] {
  const text = message.trim();
  if (!text) return [];

  const { sections } = loadStore();
  const keywords = new Set<string>();

  // 1）优先：命中现有小节标题（标题通常就是习俗名）
  for (const s of sections) {
    const title = s.title.trim();
    if (!title) continue;
    if (text.includes(title)) {
      keywords.add(title);
    }
  }

  if (keywords.size > 0) {
    return Array.from(keywords);
  }

  // 2）退化：从整句中取最长的连续汉字子串作为关键词（过滤掉明显过短的）
  const parts = text
    .split(/[，。,.;；？！?\n\r]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!parts.length) return [];

  let longest = parts[0];
  for (const p of parts) {
    if (p.length > longest.length) longest = p;
  }

  if (longest.length >= 2) {
    keywords.add(longest);
  }

  return Array.from(keywords);
}

/**
 * 软匹配版检索：支持多个关键词打分，并设置分数门槛；
 * 只在“比较确信命中”的情况下才返回原文，避免错绑导致体验变差。
 */
export function searchSectionsSoft(message: string, limit = 6): QingJiaLuSection[] {
  const keywords = extractQjlKeywordsFromMessage(message);
  if (!keywords.length) return [];

  const { sections } = loadStore();

  type Scored = { section: QingJiaLuSection; score: number };
  const scored: Scored[] = [];

  for (const s of sections) {
    let score = 0;
    const titleLower = s.title.toLowerCase();
    const contentLower = s.content.toLowerCase();

    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      if (titleLower.includes(kwLower)) score += 5;
      if (contentLower.includes(kwLower)) score += 1;
    }

    if (score > 0) {
      scored.push({ section: s, score });
    }
  }

  if (!scored.length) return [];

  scored.sort((a, b) => b.score - a.score);

  // 分数门槛：至少 3 分（例如：标题命中一次，或正文多次命中）
  const MIN_SCORE = 3;
  const filtered = scored.filter((s) => s.score >= MIN_SCORE).slice(0, Math.max(1, limit));

  return filtered.map((x) => x.section);
}

