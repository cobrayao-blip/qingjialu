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
function extractQjlKeywordsFromMessage(message: string): string[] {
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

/** 时令卡片习俗名 → 当月原文小节（标题精确/包含匹配，取一条最贴切） */
export function findSectionForMonthCustom(month: string, customName: string): QingJiaLuSection | null {
  const list = getSectionsByMonth(month);
  const n = customName.trim();
  if (!n || !list.length) return null;
  const exact = list.find((s) => s.title.trim() === n);
  if (exact) return exact;
  const cand = list.filter((s) => {
    const t = s.title.trim();
    return t.includes(n) || n.includes(t);
  });
  if (!cand.length) return null;
  cand.sort((a, b) => a.title.length - b.title.length || a.title.localeCompare(b.title, 'zh'));
  return cand[0];
}

/** 与 ground-topic 一致：软检索命中或全文含用户短语即视为有据 */
export function isTopicGroundedInQjl(topic: string): boolean {
  const t = topic.trim();
  if (!t) return false;
  if (searchSectionsSoft(t, 1).length > 0) return true;
  const key = t.toLowerCase();
  for (const s of getAllSections()) {
    const hay = `${s.title}\n${s.content}`.toLowerCase();
    if (hay.includes(key)) return true;
  }
  return false;
}

/**
 * 灵感输入：软检索优先，再补足字面命中，去重后至多 max 条，供绘本剧本综合参考。
 */
export function collectSectionsForPictureBookTopic(topic: string, max = 6): QingJiaLuSection[] {
  const t = topic.trim();
  if (!t) return [];
  const seen = new Set<string>();
  const out: QingJiaLuSection[] = [];
  for (const s of searchSectionsSoft(t, max)) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  if (out.length >= max) return out.slice(0, max);
  const key = t.toLowerCase();
  for (const s of getAllSections()) {
    if (seen.has(s.id)) continue;
    const hay = `${s.title}\n${s.content}`.toLowerCase();
    if (!hay.includes(key)) continue;
    out.push(s);
    seen.add(s.id);
    if (out.length >= max) break;
  }
  return out;
}

const PICTURE_BOOK_REF_MAX_CHARS = 3200;

/** 拼入绘本剧本 prompt 的《清嘉录》参考块 */
export function formatQjlSectionsForPictureBookPrompt(
  sections: QingJiaLuSection[],
  mode: 'single_card' | 'multi_inspiration',
): string {
  if (!sections.length) return '';
  const head =
    mode === 'single_card'
      ? '【单条原文锚定】以下为该习俗在《清嘉录》中的正文。三页绘本的情节、专有名词与禳解/活动方式须与此一致；禁止改写成与此矛盾的泛化主题（例如把「注夏」偷换为一般夏日纳凉消暑，而忽略参考文中的茶饮、饮食禳解等）。\n\n'
      : '【多条原文综合】以下各节与您的灵感在《清嘉录》原文中均有依据。请通读后在三页故事中有机融合或分承体现各条要点；禁止只选其中最泛化的一条，而用与参考无关的套路敷衍带过。\n\n';

  const blocks = sections.map((s, i) => {
    let body = (s.content || '').trim();
    if (body.length > PICTURE_BOOK_REF_MAX_CHARS) {
      body = `${body.slice(0, PICTURE_BOOK_REF_MAX_CHARS)}\n…（以下略）`;
    }
    return `—— 第 ${i + 1} 条 ——\n卷「${s.juan}」·${s.month ?? ''}·「${s.title}」（小节 id：${s.id}）\n${body}`;
  });
  return head + blocks.join('\n\n');
}

