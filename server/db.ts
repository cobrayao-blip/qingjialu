import { Pool } from 'pg';
import type { PictureBook, PictureBookPage } from './types';
import type { GeoPlace } from './types/geo';
import { createHash } from 'crypto';
import { env } from './env';
import bcrypt from 'bcryptjs';

const pool = new Pool({
  host: env.PG_HOST,
  port: env.PG_PORT,
  user: env.PG_USER,
  password: env.PG_PASSWORD,
  database: env.PG_DATABASE,
});

export interface LlmConfigRow {
  provider: string;
  api_key: string | null;
  model_text: string | null;
  model_image: string | null;
  updated_at: string;
  provider_text?: string | null;
  api_key_text?: string | null;
  url_text?: string | null;
  provider_image?: string | null;
  api_key_image?: string | null;
  url_image?: string | null;
  provider_tts?: string | null;
  api_key_tts?: string | null;
  url_tts?: string | null;
  model_tts?: string | null;
  voice_tts?: string | null;
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

function maskApiKey(key: string | null | undefined): string {
  if (!key || key.length === 0) return '';
  if (key.length <= 4) return '****';
  return '***' + key.slice(-4);
}

let cachedLlmConfig: LlmConfigRow | null = null;

async function fetchLlmConfigRow(): Promise<LlmConfigRow | null> {
  const res = await pool.query('SELECT * FROM llm_config WHERE id = 1');
  const row = res.rows[0];
  if (!row) return null;
  return {
    provider: row.provider ?? 'dashscope',
    api_key: row.api_key ?? null,
    model_text: row.model_text ?? null,
    model_image: row.model_image ?? null,
    updated_at: row.updated_at ?? '',
    provider_text: row.provider_text ?? null,
    api_key_text: row.api_key_text ?? null,
    url_text: row.url_text ?? null,
    provider_image: row.provider_image ?? null,
    api_key_image: row.api_key_image ?? null,
    url_image: row.url_image ?? null,
    provider_tts: row.provider_tts ?? null,
    api_key_tts: row.api_key_tts ?? null,
    url_tts: row.url_tts ?? null,
    model_tts: row.model_tts ?? null,
    voice_tts: row.voice_tts ?? null,
  };
}

export function getLlmConfig(): LlmConfigRow | null {
  return cachedLlmConfig;
}

export function getLlmConfigForDisplay(): LlmConfigForDisplay {
  const row = getLlmConfig();
  const textKey = row?.api_key_text ?? row?.api_key ?? null;
  const imageKey = row?.api_key_image ?? row?.api_key ?? null;
  const ttsKey = row?.api_key_tts ?? row?.api_key ?? null;
  return {
    text: {
      provider: row?.provider_text ?? row?.provider ?? 'dashscope',
      model: row?.model_text ?? '',
      url: row?.url_text?.trim() ?? '',
      apiKeyMasked: maskApiKey(textKey) || '未配置',
    },
    image: {
      provider: row?.provider_image ?? row?.provider ?? 'dashscope',
      model: row?.model_image ?? '',
      url: row?.url_image?.trim() ?? '',
      apiKeyMasked: maskApiKey(imageKey) || '未配置',
    },
    tts: {
      provider: row?.provider_tts ?? row?.provider ?? 'dashscope',
      model: row?.model_tts ?? '',
      url: row?.url_tts?.trim() ?? '',
      apiKeyMasked: maskApiKey(ttsKey) || '未配置',
      voice: row?.voice_tts?.trim() ?? undefined,
    },
    updatedAt: row?.updated_at ?? '',
  };
}

export function saveLlmConfig(updates: {
  text?: { provider?: string; model?: string; url?: string; apiKey?: string | null };
  image?: { provider?: string; model?: string; url?: string; apiKey?: string | null };
  tts?: { provider?: string; model?: string; url?: string; apiKey?: string | null; voice?: string | null };
  apiKey?: string | null;
  modelText?: string;
  modelImage?: string;
}): Promise<void> {
  return (async () => {
    const current = (await fetchLlmConfigRow()) as LlmConfigRow | null;
    const c: Partial<LlmConfigRow> = current ?? {};

  const text = updates.text ?? {};
  const image = updates.image ?? {};
  const tts = updates.tts ?? {};
  const provider_text = text.provider !== undefined ? text.provider : (c.provider_text as string) ?? (c.provider as string) ?? 'dashscope';
  const model_text = text.model !== undefined ? text.model : (c.model_text as string) ?? updates.modelText ?? '';
  const url_text = text.url !== undefined ? (text.url || null) : (c.url_text as string | null) ?? null;
  const api_key_text = text.apiKey !== undefined ? (text.apiKey === '' || text.apiKey === null ? null : text.apiKey) : (c.api_key_text as string | null) ?? (c.api_key as string | null);

  const provider_image = image.provider !== undefined ? image.provider : (c.provider_image as string) ?? (c.provider as string) ?? 'dashscope';
  const model_image = image.model !== undefined ? image.model : (c.model_image as string) ?? updates.modelImage ?? '';
  const url_image = image.url !== undefined ? (image.url || null) : (c.url_image as string | null) ?? null;
  const api_key_image = image.apiKey !== undefined ? (image.apiKey === '' || image.apiKey === null ? null : image.apiKey) : (c.api_key_image as string | null) ?? (c.api_key as string | null);

  const provider_tts = tts.provider !== undefined ? tts.provider : (c.provider_tts as string) ?? (c.provider as string) ?? 'dashscope';
  const model_tts = tts.model !== undefined ? tts.model : (c.model_tts as string) ?? '';
  const url_tts = tts.url !== undefined ? (tts.url || null) : (c.url_tts as string | null) ?? null;
  const voice_tts = tts.voice !== undefined ? (tts.voice || null) : (c.voice_tts as string | null) ?? null;
  const api_key_tts = tts.apiKey !== undefined ? (tts.apiKey === '' || tts.apiKey === null ? null : tts.apiKey) : (c.api_key_tts as string | null) ?? (c.api_key as string | null);

  const api_key = api_key_text ?? api_key_image ?? api_key_tts ?? (updates.apiKey !== undefined ? (updates.apiKey === '' || updates.apiKey === null ? null : updates.apiKey) : (c.api_key as string | null));

  await pool.query(
    `INSERT INTO llm_config (
       id, provider, api_key,
       provider_text, api_key_text, model_text, url_text,
       provider_image, api_key_image, model_image, url_image,
       provider_tts, api_key_tts, model_tts, url_tts, voice_tts,
       updated_at
     )
     VALUES (
       1, $1, $2,
       $3, $4, $5, $6,
       $7, $8, $9, $10,
       $11, $12, $13, $14, $15,
       NOW()
     )
     ON CONFLICT (id) DO UPDATE SET
       provider = EXCLUDED.provider,
       api_key = EXCLUDED.api_key,
       provider_text = EXCLUDED.provider_text,
       api_key_text = EXCLUDED.api_key_text,
       model_text = EXCLUDED.model_text,
       url_text = EXCLUDED.url_text,
       provider_image = EXCLUDED.provider_image,
       api_key_image = EXCLUDED.api_key_image,
       model_image = EXCLUDED.model_image,
       url_image = EXCLUDED.url_image,
       provider_tts = EXCLUDED.provider_tts,
       api_key_tts = EXCLUDED.api_key_tts,
       model_tts = EXCLUDED.model_tts,
       url_tts = EXCLUDED.url_tts,
       voice_tts = EXCLUDED.voice_tts,
       updated_at = EXCLUDED.updated_at`,
    [
      provider_text,
      api_key,
      provider_text,
      api_key_text,
      model_text,
      url_text,
      provider_image,
      api_key_image,
      model_image,
      url_image,
      provider_tts,
      api_key_tts,
      model_tts,
      url_tts,
      voice_tts,
    ]
  );
  cachedLlmConfig = await fetchLlmConfigRow();
})();
}

export async function listPictureBooks(): Promise<Omit<PictureBook, 'pages'>[]> {
  const res = await pool.query(
    'SELECT id, title, topic, created_at AS "createdAt" FROM picture_books ORDER BY created_at DESC'
  );
  return res.rows as Omit<PictureBook, 'pages'>[];
}

export async function getPictureBook(id: number): Promise<PictureBook | null> {
  const res = await pool.query(
    'SELECT id, title, topic, pages_json, created_at AS "createdAt" FROM picture_books WHERE id = $1',
    [id]
  );
  const row = res.rows[0] as
    | { id: number; title: string; topic: string; pages_json: string; createdAt: string }
    | undefined;
  if (!row) return null;
  const pages: PictureBookPage[] = JSON.parse(row.pages_json);
  return {
    id: row.id,
    title: row.title,
    topic: row.topic,
    pages,
    createdAt: row.createdAt,
  };
}

/** 时令月份结构化数据缓存：source_key 为原文小节 id 拼接的 hash，原文变更后可刷新 */
export async function getMonthDataCache(month: string): Promise<{ payloadJson: string; sourceKey: string } | null> {
  const res = await pool.query(
    'SELECT payload_json AS "payloadJson", source_key AS "sourceKey" FROM month_data_cache WHERE month = $1',
    [month.trim()]
  );
  const row = res.rows[0] as { payloadJson: string; sourceKey: string } | undefined;
  return row ?? null;
}

export async function saveMonthDataCache(month: string, payload: unknown, sourceKey: string): Promise<void> {
  const m = month.trim();
  const json = JSON.stringify(payload);
  await pool.query(
    `INSERT INTO month_data_cache (month, payload_json, source_key, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (month) DO UPDATE SET
       payload_json = EXCLUDED.payload_json,
       source_key = EXCLUDED.source_key,
       updated_at = EXCLUDED.updated_at`,
    [m, json, sourceKey]
  );
}

/** 原文白话翻译缓存：同 sectionId + sourceKey 命中则直接复用 */
export async function getQjlTranslationCache(
  sectionId: string,
  sourceKey: string
): Promise<{ translation: string } | null> {
  const res = await pool.query(
    `SELECT translation_text AS "translation" FROM qjl_translation_cache
     WHERE section_id = $1 AND source_key = $2`,
    [sectionId.trim(), sourceKey.trim()]
  );
  const row = res.rows[0] as { translation: string } | undefined;
  return row ?? null;
}

export async function saveQjlTranslationCache(
  sectionId: string,
  sourceKey: string,
  translation: string
): Promise<void> {
  await pool.query(
    `INSERT INTO qjl_translation_cache (section_id, source_key, translation_text, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (section_id, source_key) DO UPDATE SET
       translation_text = EXCLUDED.translation_text,
       updated_at = EXCLUDED.updated_at`,
    [sectionId.trim(), sourceKey.trim(), translation]
  );
}

/** 地理模块按月缓存：在线抽取+RAG 古今对照结果 */
export async function getGeoMonthDataCache(month: string): Promise<{ payloadJson: string; sourceKey: string } | null> {
  const res = await pool.query(
    'SELECT payload_json AS "payloadJson", source_key AS "sourceKey" FROM geo_month_cache WHERE month = $1',
    [month.trim()]
  );
  const row = res.rows[0] as { payloadJson: string; sourceKey: string } | undefined;
  return row ?? null;
}

export async function saveGeoMonthDataCache(month: string, places: GeoPlace[], sourceKey: string): Promise<void> {
  const m = month.trim();
  const payload = {
    month: m,
    count: places.length,
    places,
  };
  await pool.query(
    `INSERT INTO geo_month_cache (month, payload_json, source_key, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (month) DO UPDATE SET
       payload_json = EXCLUDED.payload_json,
       source_key = EXCLUDED.source_key,
       updated_at = EXCLUDED.updated_at`,
    [m, JSON.stringify(payload), sourceKey]
  );
}

export async function listGeoMonthCacheRows(): Promise<Array<{ month: string; payloadJson: string; sourceKey: string }>> {
  const res = await pool.query(
    'SELECT month, payload_json AS "payloadJson", source_key AS "sourceKey" FROM geo_month_cache ORDER BY month ASC'
  );
  return res.rows as Array<{ month: string; payloadJson: string; sourceKey: string }>;
}

export type GeoPlaceReviewStatus = 'pending' | 'reviewed' | 'locked';

export interface GeoPlaceReviewRow {
  month: string;
  placeKey: string;
  status: GeoPlaceReviewStatus;
  placeSnapshotJson: string | null;
  reviewerUsername: string | null;
  reviewNote: string | null;
  updatedAt: string;
}

/** 校审状态（待审/已审/锁定）；锁定行带快照，重算时以快照覆盖模型输出 */
export async function listGeoPlaceReviews(month?: string): Promise<GeoPlaceReviewRow[]> {
  const q = month?.trim()
    ? 'SELECT month, place_key AS "placeKey", status, place_snapshot_json AS "placeSnapshotJson", reviewer_username AS "reviewerUsername", review_note AS "reviewNote", updated_at AS "updatedAt" FROM geo_place_review WHERE month = $1 ORDER BY place_key ASC'
    : 'SELECT month, place_key AS "placeKey", status, place_snapshot_json AS "placeSnapshotJson", reviewer_username AS "reviewerUsername", review_note AS "reviewNote", updated_at AS "updatedAt" FROM geo_place_review ORDER BY month ASC, place_key ASC';
  const res = month?.trim() ? await pool.query(q, [month.trim()]) : await pool.query(q);
  return res.rows as GeoPlaceReviewRow[];
}

export async function getLockedGeoReviewRows(month: string): Promise<Array<{ place_key: string; place_snapshot_json: string }>> {
  const res = await pool.query(
    `SELECT place_key, place_snapshot_json FROM geo_place_review
     WHERE month = $1 AND status = 'locked' AND place_snapshot_json IS NOT NULL AND length(trim(place_snapshot_json)) > 0`,
    [month.trim()]
  );
  return res.rows as Array<{ place_key: string; place_snapshot_json: string }>;
}

export async function upsertGeoPlaceReview(
  month: string,
  placeKey: string,
  status: GeoPlaceReviewStatus,
  placeSnapshotJson: string | null,
  reviewerUsername: string | null,
  reviewNote: string | null
): Promise<void> {
  const m = month.trim();
  const k = placeKey.trim();
  await pool.query(
    `INSERT INTO geo_place_review (month, place_key, status, place_snapshot_json, reviewer_username, review_note, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (month, place_key) DO UPDATE SET
       status = EXCLUDED.status,
       place_snapshot_json = EXCLUDED.place_snapshot_json,
       reviewer_username = EXCLUDED.reviewer_username,
       review_note = EXCLUDED.review_note,
       updated_at = EXCLUDED.updated_at`,
    [m, k, status, placeSnapshotJson, reviewerUsername, reviewNote]
  );
}

export async function deleteGeoPlaceReview(month: string, placeKey: string): Promise<void> {
  await pool.query('DELETE FROM geo_place_review WHERE month = $1 AND place_key = $2', [month.trim(), placeKey.trim()]);
}

export async function saveGeoRebuildLog(month: string, beforeJson: string, afterJson: string, diffJson: string): Promise<void> {
  await pool.query(
    `INSERT INTO geo_rebuild_log (month, before_json, after_json, diff_json, created_at) VALUES ($1, $2, $3, $4, NOW())`,
    [month.trim(), beforeJson, afterJson, diffJson]
  );
}

export async function listGeoRebuildLogs(month: string, limit = 20): Promise<
  Array<{ id: number; month: string; diffJson: string; createdAt: string }>
> {
  const res = await pool.query(
    `SELECT id, month, diff_json AS "diffJson", created_at AS "createdAt" FROM geo_rebuild_log
     WHERE month = $1 ORDER BY id DESC LIMIT $2`,
    [month.trim(), Math.min(Math.max(limit, 1), 100)]
  );
  return res.rows as Array<{ id: number; month: string; diffJson: string; createdAt: string }>;
}

export interface AuthUserRow {
  id: number;
  username: string;
  passwordHash: string;
  role: 'admin' | 'editor' | 'viewer';
  createdAt: string;
  updatedAt: string;
}

export async function getAuthUserByUsername(username: string): Promise<AuthUserRow | null> {
  const res = await pool.query(
    `SELECT id, username, password_hash AS "passwordHash", role, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM auth_users WHERE username = $1`,
    [username.trim()]
  );
  const row = res.rows[0] as AuthUserRow | undefined;
  return row ?? null;
}

export async function getAuthUserById(id: number): Promise<AuthUserRow | null> {
  const res = await pool.query(
    `SELECT id, username, password_hash AS "passwordHash", role, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM auth_users WHERE id = $1`,
    [id]
  );
  const row = res.rows[0] as AuthUserRow | undefined;
  return row ?? null;
}

export async function countAuthUsersByRole(role: AuthUserRow['role']): Promise<number> {
  const res = await pool.query(`SELECT COUNT(*)::int AS c FROM auth_users WHERE role = $1`, [role]);
  return Number(res.rows[0]?.c ?? 0);
}

export async function upsertAuthUser(username: string, passwordPlain: string, role: AuthUserRow['role']): Promise<void> {
  const hash = await bcrypt.hash(passwordPlain, 10);
  await pool.query(
    `INSERT INTO auth_users (username, password_hash, role, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (username) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       updated_at = EXCLUDED.updated_at`,
    [username.trim(), hash, role]
  );
}

export async function listAuthUsers(): Promise<Array<{ id: number; username: string; role: AuthUserRow['role']; createdAt: string; updatedAt: string }>> {
  const res = await pool.query(
    `SELECT id, username, role, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM auth_users ORDER BY id ASC`
  );
  return res.rows as Array<{ id: number; username: string; role: AuthUserRow['role']; createdAt: string; updatedAt: string }>;
}

export async function updateAuthUserRole(userId: number, role: AuthUserRow['role']): Promise<void> {
  await pool.query(`UPDATE auth_users SET role = $2, updated_at = NOW() WHERE id = $1`, [userId, role]);
}

export async function setAuthUserPassword(userId: number, passwordPlain: string): Promise<void> {
  const hash = await bcrypt.hash(passwordPlain, 10);
  await pool.query(`UPDATE auth_users SET password_hash = $2, updated_at = NOW() WHERE id = $1`, [userId, hash]);
}

export async function createAuthUser(username: string, passwordPlain: string, role: AuthUserRow['role']): Promise<void> {
  const hash = await bcrypt.hash(passwordPlain, 10);
  await pool.query(
    `INSERT INTO auth_users (username, password_hash, role, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
    [username.trim(), hash, role]
  );
}

export async function deleteAuthUser(userId: number): Promise<void> {
  await pool.query(`DELETE FROM auth_users WHERE id = $1`, [userId]);
}

export async function saveGeoAuditLog(entry: {
  actorUserId: number;
  actorUsername: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  detailJson: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO geo_audit_log (
      actor_user_id, actor_username, actor_role, action, target_type, target_id, detail_json, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
    [entry.actorUserId, entry.actorUsername, entry.actorRole, entry.action, entry.targetType, entry.targetId, entry.detailJson]
  );
}

export async function listGeoAuditLogs(limit = 100): Promise<
  Array<{
    id: number;
    actorUserId: number;
    actorUsername: string;
    actorRole: string;
    action: string;
    targetType: string;
    targetId: string;
    detailJson: string;
    createdAt: string;
  }>
> {
  const res = await pool.query(
    `SELECT id,
            actor_user_id AS "actorUserId",
            actor_username AS "actorUsername",
            actor_role AS "actorRole",
            action,
            target_type AS "targetType",
            target_id AS "targetId",
            detail_json AS "detailJson",
            created_at AS "createdAt"
     FROM geo_audit_log
     ORDER BY id DESC
     LIMIT $1`,
    [Math.min(Math.max(limit, 1), 500)]
  );
  return res.rows as Array<{
    id: number;
    actorUserId: number;
    actorUsername: string;
    actorRole: string;
    action: string;
    targetType: string;
    targetId: string;
    detailJson: string;
    createdAt: string;
  }>;
}

/** 根据某月原文小节 id 列表生成 source_key（sections.json 变更后自动失效缓存） */
export function monthDataSourceKey(sectionIds: string[]): string {
  if (sectionIds.length === 0) return 'noground';
  return createHash('sha256').update(sectionIds.sort().join('|')).digest('hex').slice(0, 32);
}

export async function savePictureBook(book: Omit<PictureBook, 'id' | 'createdAt'>): Promise<number> {
  const res = await pool.query(
    'INSERT INTO picture_books (title, topic, pages_json, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id',
    [book.title, book.topic, JSON.stringify(book.pages)]
  );
  return res.rows[0].id as number;
}

export async function deletePictureBook(id: number): Promise<void> {
  await pool.query('DELETE FROM picture_books WHERE id = $1', [id]);
}

export async function updatePictureBookPages(id: number, pages: PictureBookPage[]): Promise<void> {
  const res = await pool.query('UPDATE picture_books SET pages_json = $1 WHERE id = $2', [
    JSON.stringify(pages),
    id,
  ]);
  if (res.rowCount === 0) {
    throw new Error('绘本不存在');
  }
}

export interface ChatSessionRow {
  id: string;
  title: string;
  messagesJson: string;
  feedbackJson: string;
  createdAt: string;
  updatedAt: string;
}

export async function listChatSessions(): Promise<ChatSessionRow[]> {
  const res = await pool.query(
    `SELECT
       id,
       title,
       messages_json AS "messagesJson",
       feedback_json AS "feedbackJson",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM chat_sessions
     ORDER BY updated_at DESC`
  );
  return res.rows as ChatSessionRow[];
}

export async function getChatSessionById(id: string): Promise<ChatSessionRow | null> {
  const res = await pool.query(
    `SELECT
       id,
       title,
       messages_json AS "messagesJson",
       feedback_json AS "feedbackJson",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM chat_sessions
     WHERE id = $1`,
    [id]
  );
  const row = res.rows[0] as ChatSessionRow | undefined;
  return row ?? null;
}

export async function createChatSession(payload: {
  id: string;
  title: string;
  messagesJson?: string;
  feedbackJson?: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO chat_sessions (id, title, messages_json, feedback_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [payload.id, payload.title, payload.messagesJson ?? '[]', payload.feedbackJson ?? '{}']
  );
}

export async function upsertChatSession(payload: {
  id: string;
  title: string;
  messagesJson: string;
  feedbackJson?: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO chat_sessions (id, title, messages_json, feedback_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       messages_json = EXCLUDED.messages_json,
       feedback_json = EXCLUDED.feedback_json,
       updated_at = EXCLUDED.updated_at`,
    [payload.id, payload.title, payload.messagesJson, payload.feedbackJson ?? '{}']
  );
}

export async function deleteChatSessionById(id: string): Promise<void> {
  await pool.query('DELETE FROM chat_sessions WHERE id = $1', [id]);
}

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS picture_books (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      topic TEXT NOT NULL,
      pages_json TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS month_data_cache (
      month TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      source_key TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS geo_month_cache (
      month TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      source_key TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qjl_translation_cache (
      section_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      translation_text TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (section_id, source_key)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS geo_place_review (
      month TEXT NOT NULL,
      place_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      place_snapshot_json TEXT,
      reviewer_username TEXT,
      review_note TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (month, place_key)
    );
  `);
  await pool.query(`ALTER TABLE geo_place_review ADD COLUMN IF NOT EXISTS reviewer_username TEXT`);
  await pool.query(`ALTER TABLE geo_place_review ADD COLUMN IF NOT EXISTS review_note TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS geo_rebuild_log (
      id SERIAL PRIMARY KEY,
      month TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      diff_json TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS llm_config (
      id INTEGER PRIMARY KEY,
      provider TEXT DEFAULT 'dashscope',
      api_key TEXT,
      model_text TEXT,
      model_image TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      provider_text TEXT,
      api_key_text TEXT,
      url_text TEXT,
      provider_image TEXT,
      api_key_image TEXT,
      url_image TEXT,
      provider_tts TEXT,
      api_key_tts TEXT,
      url_tts TEXT,
      model_tts TEXT,
      voice_tts TEXT
    );
  `);

  // 确保有一条基础配置记录（若迁移脚本尚未写入则只保留 provider）
  await pool.query(
    `INSERT INTO llm_config (id, provider, updated_at)
     VALUES (1, 'dashscope', NOW())
     ON CONFLICT (id) DO NOTHING`
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS geo_audit_log (
      id SERIAL PRIMARY KEY,
      actor_user_id INTEGER NOT NULL,
      actor_username TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      messages_json TEXT NOT NULL,
      feedback_json TEXT NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  if (env.ADMIN_USERNAME && env.ADMIN_PASSWORD) {
    await upsertAuthUser(env.ADMIN_USERNAME, env.ADMIN_PASSWORD, 'admin');
  }

  cachedLlmConfig = await fetchLlmConfigRow();
}
