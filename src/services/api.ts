/**
 * 前端统一调用后端 API，不再直连大模型，避免 API Key 暴露
 */

import type { CanonicalGraph } from '../graph/folkloreGraphModel';

const viteEnv = (typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined) as { VITE_API_BASE?: string } | undefined;
const API_BASE = viteEnv?.VITE_API_BASE
  ? String(viteEnv.VITE_API_BASE).replace(/\/$/, '')
  : '';

const AUTH_JWT_KEY = 'qingjialuJwt';
const AUTH_JWT_LEGACY = 'geoAdminJwt';

function readStoredJwtForRequest(): string {
  try {
    return localStorage.getItem(AUTH_JWT_KEY) || localStorage.getItem(AUTH_JWT_LEGACY) || '';
  } catch {
    return '';
  }
}

/** 供非 request() 的 fetch（如 TTS 二进制流）附加 Authorization */
export function authFetchHeaders(base: Record<string, string> = {}): Record<string, string> {
  const t = readStoredJwtForRequest().trim();
  const next = { ...base };
  if (t && !next.Authorization && !next.authorization) {
    next.Authorization = `Bearer ${t}`;
  }
  return next;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const incoming = (options?.headers || {}) as Record<string, string>;
  const hasAuth = Boolean(incoming.Authorization || incoming.authorization);
  const tok = readStoredJwtForRequest().trim();
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...incoming,
      ...(hasAuth || !tok ? {} : { Authorization: `Bearer ${tok}` }),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && typeof data.error === 'string') ? data.error : `请求失败: ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export interface MonthCustom {
  name: string;
  description: string;
  roles?: string[];
  modernStatus?: string;
}

export interface MonthData {
  month: string;
  summary: string;
  customs: MonthCustom[];
}

/** 时令接口在基于本地原文抽取时附加的元信息 */
export interface MonthDataMeta {
  grounded: boolean;
  sectionCount: number;
  sectionTitles: string[];
}

export type MonthDataResponse = MonthData & { _meta?: MonthDataMeta };

export type GeoStatus = '存续' | '已变迁' | '待考';

export type GeoEvidenceStrength = 'direct' | 'indirect' | 'inferred';

export interface GeoCitation {
  sectionId: string;
  chapterTitle: string;
  quoteText: string;
  evidenceStrength?: GeoEvidenceStrength;
}

export interface GeoPlace {
  id: string;
  name: string;
  aliases?: string[];
  ancientEvidence?: string;
  ancientSummary: string;
  modernFactual?: string;
  modernInterpretation?: string;
  modernSummary: string;
  status: GeoStatus;
  months: string[];
  citations: GeoCitation[];
}

/** 解析 Tab 追问时附带的地理卡片上下文（服务端写入 prompt，检索仍用读者原句） */
export interface GeoChatContextPayload {
  month: string;
  placeName: string;
  ancientEvidence?: string;
  citations: Array<Pick<GeoCitation, 'sectionId' | 'chapterTitle' | 'quoteText'>>;
}

export interface GeoGlossaryEntry {
  term: string;
  aliases?: string[];
  definition: string;
  /** editorial=编者注；original=来自原文或可直接对读原文的简注 */
  source: 'editorial' | 'original' | string;
}

export interface GeoQualityMetrics {
  monthsTotal: number;
  monthsWithGeoCache: number;
  coverage: number;
  totalCachedPlaces: number;
  totalCitations: number;
  citationHitRate: number;
  duplicateNameClusters: number;
  schemaRejectRate: number;
  lockedReviewCount: number;
}

export interface GeoReviewRecord {
  month: string;
  placeKey: string;
  status: 'pending' | 'reviewed' | 'locked';
  reviewerUsername?: string | null;
  reviewNote?: string | null;
  updatedAt: string;
}

export interface AuthLoginResponse {
  token: string;
  user: { id: number | string; username: string; role: 'admin' | 'editor' | 'viewer' };
}
export interface AuthUser {
  id: number;
  username: string;
  role: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ChatSessionPayload {
  id: string;
  title: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  feedback?: Record<number, 'up' | 'down'>;
  createdAt: string;
  updatedAt: string;
}

/** 民俗问答（解析）；可选 geoContext 将地点与引文作为 RAG 附文交给模型 */
export async function analyzeFolklore(message: string, geoContext?: GeoChatContextPayload | null): Promise<string> {
  const body: Record<string, unknown> = { message };
  if (geoContext) body.geoContext = geoContext;
  const { text } = await request<{ text: string }>('/api/llm/chat', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return text ?? '';
}

export async function getGeoGlossary(): Promise<{ entries: GeoGlossaryEntry[] } | null> {
  try {
    return await request<{ entries: GeoGlossaryEntry[] }>('/api/geo/glossary');
  } catch {
    return null;
  }
}

/** 触发浏览器下载当月地理缓存（JSON / Markdown） */
export async function downloadGeoExport(month: string, format: 'json' | 'md', token?: string): Promise<void> {
  const url = `${API_BASE}/api/geo/export?month=${encodeURIComponent(month.trim())}&format=${format}`;
  const headers = token?.trim()
    ? { Authorization: `Bearer ${token.trim()}` }
    : authFetchHeaders();
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `导出失败: ${res.status}`);
  }
  const blob = await res.blob();
  const ext = format === 'md' ? 'md' : 'json';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `geo-${month.trim()}.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function getGeoAdminMetrics(adminToken: string): Promise<GeoQualityMetrics> {
  return await request<GeoQualityMetrics>('/api/geo/admin/metrics', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

export async function postGeoAdminRebuildPreview(
  adminToken: string,
  month: string
): Promise<{
  month: string;
  dryRun: boolean;
  beforeCount: number;
  afterCount: number;
  diff: unknown;
  afterPlaces: GeoPlace[];
}> {
  return await request('/api/geo/admin/rebuild-preview', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ month: month.trim() }),
  });
}

export async function postGeoAdminReview(
  adminToken: string,
  payload: { month: string; placeKey: string; status: 'pending' | 'reviewed' | 'locked'; placeSnapshot?: GeoPlace; reviewNote?: string }
): Promise<{ ok: boolean }> {
  return await request('/api/geo/admin/reviews', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(payload),
  });
}

export async function listGeoAdminReviews(token: string, month: string): Promise<{ reviews: GeoReviewRecord[] }> {
  return await request(`/api/geo/admin/reviews?month=${encodeURIComponent(month.trim())}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function loginAdmin(username: string, password: string): Promise<AuthLoginResponse> {
  return await request<AuthLoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: username.trim(), password }),
  });
}

export async function getAuthMe(token: string): Promise<{ user: { sub: string; username: string; role: 'admin' | 'editor' | 'viewer' } }> {
  return await request('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function refreshAuthToken(token: string): Promise<AuthLoginResponse> {
  return await request<AuthLoginResponse>('/api/auth/refresh', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function listAuthUsers(token: string): Promise<{ users: AuthUser[] }> {
  return await request('/api/auth/users', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createAuthUser(
  token: string,
  payload: { username: string; password: string; role: 'editor' | 'viewer' }
): Promise<{ ok: boolean }> {
  return await request('/api/auth/users', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

export async function patchAuthUser(
  token: string,
  id: number,
  payload: { role?: 'editor' | 'viewer'; password?: string }
): Promise<{ ok: boolean }> {
  return await request(`/api/auth/users/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

export async function removeAuthUser(token: string, id: number): Promise<{ ok: boolean }> {
  return await request(`/api/auth/users/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function listGeoAuditLogs(token: string, limit = 100): Promise<{ logs: Array<Record<string, unknown>> }> {
  return await request(`/api/geo/admin/audit-logs?limit=${Math.min(Math.max(limit, 1), 500)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function listChatSessionsApi(): Promise<{ sessions: ChatSessionPayload[] }> {
  return await request('/api/chat/sessions');
}

export async function createChatSessionApi(): Promise<{ session: ChatSessionPayload }> {
  return await request('/api/chat/sessions/create', {
    method: 'POST',
  });
}

export async function appendChatSessionMessageApi(
  id: string,
  message: { role: 'user' | 'assistant'; content: string }
): Promise<{ ok: boolean }> {
  return await request(`/api/chat/sessions/${encodeURIComponent(id)}/messages`, {
    method: 'POST',
    body: JSON.stringify(message),
  });
}

export async function saveChatSessionApi(payload: {
  id: string;
  title: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  feedback?: Record<number, 'up' | 'down'>;
}): Promise<{ ok: boolean }> {
  return await request('/api/chat/sessions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteChatSessionApi(id: string): Promise<{ ok: boolean }> {
  return await request(`/api/chat/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** 按月份获取结构化民俗数据（可能带 _meta）。服务端有缓存时不会重复调 LLM；refresh=true 强制重新生成并写库 */
export async function getStructuredMonthData(month: string, options?: { refresh?: boolean }): Promise<MonthDataResponse | null> {
  try {
    const data = await request<MonthDataResponse>('/api/llm/month-data', {
      method: 'POST',
      body: JSON.stringify({ month, refresh: options?.refresh === true }),
    });
    return data;
  } catch {
    return null;
  }
}

/** 民俗知识图谱 canonical 数据（请求失败时由调用方回退本地内置数据） */
export async function getFolkloreGraph(): Promise<CanonicalGraph | null> {
  try {
    const data = await request<{
      version?: number;
      evidence?: {
        totalRelations: number;
        requiredRelations: number;
        withEvidence: number;
        pending: number;
        coverage: number;
      };
      entities?: CanonicalGraph['entities'];
      relations?: CanonicalGraph['relations'];
    }>('/api/graph');
    if (!data?.entities || !data?.relations) return null;
    if (!Array.isArray(data.entities) || !Array.isArray(data.relations)) return null;
    return { entities: data.entities, relations: data.relations };
  } catch {
    return null;
  }
}

export async function getFolkloreEvidenceMetrics(): Promise<{
  totalRelations: number;
  requiredRelations: number;
  withEvidence: number;
  pending: number;
  coverage: number;
} | null> {
  try {
    const data = await request<{
      version?: number;
      evidence?: {
        totalRelations: number;
        requiredRelations: number;
        withEvidence: number;
        pending: number;
        coverage: number;
      };
    }>('/api/graph/evidence-metrics');
    return data?.evidence ?? null;
  } catch {
    return null;
  }
}

/** 获取图谱子图（按预设或维度筛选）；失败返回 null */
export async function getFolkloreSubgraph(options?: {
  preset?: 'month_custom_role' | 'time_place_practice' | 'narrative_practice_concept_experience';
  month?: string;
  entityTypes?: Array<'time' | 'practice' | 'actor' | 'place' | 'artifact' | 'source' | 'concept' | 'experience'>;
  relationTypes?: Array<
    | 'occurs_in'
    | 'occurs_at'
    | 'performed_by'
    | 'uses'
    | 'documented_in'
    | 'related_to'
    | 'symbolizes'
    | 'regulates'
    | 'evokes'
    | 'associated_with'
  >;
  onlyWithSources?: boolean;
}): Promise<CanonicalGraph | null> {
  try {
    const params = new URLSearchParams();
    if (options?.preset) params.set('preset', options.preset);
    if (options?.month?.trim()) params.set('month', options.month.trim());
    if (options?.entityTypes?.length) params.set('entityTypes', options.entityTypes.join(','));
    if (options?.relationTypes?.length) params.set('relationTypes', options.relationTypes.join(','));
    if (options?.onlyWithSources) params.set('onlyWithSources', '1');
    const q = params.toString();
    const path = q ? `/api/graph/subgraph?${q}` : '/api/graph/subgraph';
    const data = await request<{
      entities?: CanonicalGraph['entities'];
      relations?: CanonicalGraph['relations'];
    }>(path);
    if (!data?.entities || !data?.relations) return null;
    if (!Array.isArray(data.entities) || !Array.isArray(data.relations)) return null;
    return { entities: data.entities, relations: data.relations };
  } catch {
    return null;
  }
}

/** 《清嘉录》某月小节目录（无正文） */
export async function listQingJiaLuSections(month: string): Promise<{ month: string; count: number; sections: { id: string; title: string; juan: string; month?: string }[] } | null> {
  try {
    const q = encodeURIComponent(month);
    return await request(`/api/qjl/sections?month=${q}`);
  } catch {
    return null;
  }
}

/** 按关键词反查可能月份（用于时令左栏搜索） */
export async function searchQingJiaLuMonths(query: string): Promise<{ query: string; months: { month: string; count: number }[] } | null> {
  try {
    const q = encodeURIComponent(query.trim());
    return await request(`/api/qjl/search-months?q=${q}`);
  } catch {
    return null;
  }
}

/** 《清嘉录》单条原文全文 */
export async function getQingJiaLuSection(id: string): Promise<{ id: string; juan: string; month?: string; title: string; content: string } | null> {
  try {
    const q = encodeURIComponent(id);
    return await request(`/api/qjl/sections/${q}`);
  } catch {
    return null;
  }
}

/** 《清嘉录》单条原文白话翻译（服务端缓存命中则直接返回） */
export async function getQingJiaLuSectionTranslation(id: string): Promise<{
  sectionId: string;
  sourceKey: string;
  cached: boolean;
  translation: string;
} | null> {
  try {
    const q = encodeURIComponent(id);
    return await request(`/api/qjl/sections/${q}/translation`);
  } catch {
    return null;
  }
}

/** 地理模块：按月获取古今地理对照（每条包含原文引用） */
export async function listGeoPlaces(month?: string): Promise<{ month: string | null; count: number; places: GeoPlace[] } | null> {
  try {
    const q = month?.trim() ? `?month=${encodeURIComponent(month.trim())}` : '';
    return await request(`/api/geo/places${q}`);
  } catch {
    return null;
  }
}

/** 地理模块（二期）：按月在线抽取 + RAG 对照（缓存） */
export async function getGeoMonthData(month: string, options?: { refresh?: boolean }): Promise<{
  month: string;
  count: number;
  places: GeoPlace[];
  _meta?: {
    grounded: boolean;
    sectionCount: number;
    sourceKey?: string;
    cachedSourceKey?: string;
    stale?: boolean;
    cacheMismatch?: boolean;
    regenerated?: boolean;
  };
} | null> {
  try {
    return await request('/api/geo/month-data', {
      method: 'POST',
      body: JSON.stringify({ month, refresh: options?.refresh === true }),
    });
  } catch {
    return null;
  }
}

export async function searchGeoPlaces(payload: {
  query: string;
  month?: string;
  customTitle?: string;
  limit?: number;
}): Promise<{
  query: string;
  tokens: string[];
  month?: string | null;
  customTitle?: string | null;
  count: number;
  places: GeoPlace[];
} | null> {
  try {
    return await request('/api/geo/search', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch {
    return null;
  }
}

export async function aggregateGeoByName(name: string): Promise<{ name: string; count: number; places: GeoPlace[] } | null> {
  try {
    const q = encodeURIComponent(name.trim());
    return await request(`/api/geo/places/aggregate?name=${q}`);
  } catch {
    return null;
  }
}

export interface PictureBookPage {
  text: string;
  imageBase64?: string;
  /** 单页标题（如“迎春摸春牛”），为兼容旧数据保留可选 */
  title?: string;
  /** 用于生成插图的英文或中英文提示词 */
  imagePrompt?: string;
   /** 后端生成并入库的语音（base64），可选 */
  audioBase64?: string;
}

export interface PictureBook {
  id?: number;
  title: string;
  topic: string;
  pages: PictureBookPage[];
  createdAt?: string;
}

/** 根据用户一句话生成绘本；可选传入民俗参考文案以结合《清嘉录》数据 */
export async function generatePictureBook(
  topic: string,
  generateImage = true,
  folkloreContext?: string
): Promise<PictureBook> {
  return request<PictureBook>('/api/picture-book/generate', {
    method: 'POST',
    body: JSON.stringify({ topic, generateImage, folkloreContext }),
  });
}

/** 绘本列表（不含正文） */
export async function listPictureBooks(): Promise<Omit<PictureBook, 'pages'>[]> {
  return request<Omit<PictureBook, 'pages'>[]>('/api/picture-book');
}

/** 获取单本绘本 */
export async function getPictureBook(id: number): Promise<PictureBook> {
  return request<PictureBook>(`/api/picture-book/${id}`);
}

/** 保存绘本 */
export async function savePictureBook(book: Omit<PictureBook, 'id' | 'createdAt'>): Promise<{ id: number }> {
  const result = await request<{ id: number; message: string }>('/api/picture-book', {
    method: 'POST',
    body: JSON.stringify(book),
  });
  return { id: result.id };
}

/** 删除绘本 */
export async function deletePictureBook(id: number): Promise<void> {
  await request(`/api/picture-book/${id}`, {
    method: 'DELETE',
  });
}

/** 为单页重新生成插图 */
export async function regeneratePictureBookPageImage(payload: {
  topic: string;
  text: string;
  imagePrompt?: string;
}): Promise<string> {
  const { imageBase64 } = await request<{ imageBase64: string }>('/api/picture-book/page-image', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return imageBase64;
}

/** 更新已保存绘本的 pages（如补全某页插图） */
export async function updatePictureBookPages(id: number, pages: PictureBookPage[]): Promise<void> {
  await request(`/api/picture-book/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ pages }),
  });
}

/** 绘本页语音合成（TTS），返回可播放的 data URL；失败返回 null */
export async function getPictureBookTts(text: string): Promise<string | null> {
  try {
    const { audioBase64, mimeType } = await request<{ audioBase64: string; mimeType?: string }>('/api/picture-book/tts', {
      method: 'POST',
      body: JSON.stringify({ text: text.trim() }),
    });
    if (!audioBase64) return null;
    const mime = mimeType || 'audio/webm';
    return `data:${mime};base64,${audioBase64}`;
  } catch {
    return null;
  }
}

/** 导出绘本 MP4（自动翻页 + 自动朗读），返回可下载的 Blob 与文件名 */
export async function exportPictureBookMp4(book: Pick<PictureBook, 'title' | 'pages'>): Promise<{ blob: Blob; filename: string }> {
  const url = `${API_BASE}/api/picture-book/export-mp4`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authFetchHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ title: book.title, pages: book.pages }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = (data && typeof data.error === 'string') ? data.error : `请求失败: ${res.status}`;
    throw new Error(msg);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const matched = disposition.match(/filename="?([^"]+)"?/i);
  const rawName = matched?.[1] ? decodeURIComponent(matched[1]) : '';
  const filename = rawName && rawName.endsWith('.mp4') ? rawName : `${book.title || 'picture-book'}.mp4`;
  return { blob, filename };
}

// ---------- 大模型配置（API Key 仅在后端存储，前端仅见脱敏）----------

function llmAuthHeaders(adminToken: string): HeadersInit {
  const t = adminToken.trim();
  if (!t) throw new Error('需要管理员登录后才能访问大模型配置');
  return { Authorization: `Bearer ${t}` };
}

export interface LlmConfigModelDisplay {
  provider: string;
  model: string;
  url: string;
  apiKeyMasked: string;
}

export interface LlmConfigTtsDisplay extends LlmConfigModelDisplay {
  voice?: string;
}

export interface LlmConfigForDisplay {
  text: LlmConfigModelDisplay;
  image: LlmConfigModelDisplay;
  tts: LlmConfigTtsDisplay;
  updatedAt: string;
}

/** 获取大模型配置（API Key 已脱敏；须 admin JWT） */
export async function getLlmConfig(adminToken: string): Promise<LlmConfigForDisplay> {
  return request<LlmConfigForDisplay>('/api/config/llm', { headers: llmAuthHeaders(adminToken) });
}

/** 保存大模型配置（text/image/tts 各含 provider, model, url, apiKey；tts 可含 voice；留空不修改） */
export async function saveLlmConfig(
  adminToken: string,
  payload: {
    text?: { provider?: string; model?: string; url?: string; apiKey?: string | null };
    image?: { provider?: string; model?: string; url?: string; apiKey?: string | null };
    tts?: { provider?: string; model?: string; url?: string; apiKey?: string | null; voice?: string | null };
  }
): Promise<void> {
  await request('/api/config/llm', {
    method: 'POST',
    headers: llmAuthHeaders(adminToken),
    body: JSON.stringify(payload),
  });
}

/** 文本大模型连接测试（可传当前表单的 url） */
export async function testLlmConnection(
  adminToken: string,
  apiKey?: string,
  modelText?: string,
  url?: string
): Promise<{ ok: boolean; error?: string }> {
  return await request<{ ok: boolean; error?: string }>('/api/config/llm/test', {
    method: 'POST',
    headers: llmAuthHeaders(adminToken),
    body: JSON.stringify({ apiKey: apiKey || undefined, modelText: modelText || undefined, url: url || undefined }),
  });
}

/** 图像大模型连接测试（可传当前表单的 url，未保存时也会用该 URL 测） */
export async function testLlmConnectionImage(
  adminToken: string,
  apiKey?: string,
  modelImage?: string,
  url?: string
): Promise<{ ok: boolean; error?: string }> {
  return await request<{ ok: boolean; error?: string }>('/api/config/llm/testimage', {
    method: 'POST',
    headers: llmAuthHeaders(adminToken),
    body: JSON.stringify({ apiKey: apiKey || undefined, modelImage: modelImage || undefined, url: url || undefined }),
  });
}

/** 语音模型（TTS）连接测试（可传当前表单的 url、model、voice） */
export async function testLlmConnectionTts(
  adminToken: string,
  apiKey?: string,
  modelTts?: string,
  url?: string,
  voice?: string
): Promise<{ ok: boolean; error?: string }> {
  return await request<{ ok: boolean; error?: string }>('/api/config/llm/testtts', {
    method: 'POST',
    headers: llmAuthHeaders(adminToken),
    body: JSON.stringify({
      apiKey: apiKey || undefined,
      modelTts: modelTts || undefined,
      url: url || undefined,
      voice: voice || undefined,
    }),
  });
}
