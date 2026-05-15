import { Router, type Request, type Response } from 'express';
import { sendJsonSafe } from '../sendJsonSafe';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { requireDashScope, getDashScopeApiKeyText, getDashScopeApiKeyImage, getDashScopeApiKeyTts } from '../llmConfig';
import { dashscopeChat, dashscopeChatJson, dashscopeTextToImage } from '../llm/dashscope';
import { env } from '../env.js';
import type { MonthData } from '../types';
import { generatePictureBook, generatePictureBookPageImage } from '../pictureBook';
import {
  getPictureBook,
  listPictureBooks,
  savePictureBook,
  deletePictureBook,
  updatePictureBookPages,
  getLlmConfigForDisplay,
  saveLlmConfig,
  getLlmConfig,
  getMonthDataCache,
  saveMonthDataCache,
  monthDataSourceKey,
  getGeoMonthDataCache,
  saveGeoMonthDataCache,
  listGeoMonthCacheRows,
  getLockedGeoReviewRows,
  saveGeoRebuildLog,
  listGeoPlaceReviews,
  upsertGeoPlaceReview,
  deleteGeoPlaceReview,
  listGeoRebuildLogs,
  getAuthUserByUsername,
  upsertAuthUser,
  getAuthUserById,
  listAuthUsers,
  countAuthUsersByRole,
  createAuthUser,
  updateAuthUserRole,
  setAuthUserPassword,
  deleteAuthUser,
  saveGeoAuditLog,
  listGeoAuditLogs,
  listChatSessions,
  getChatSessionById,
  createChatSession,
  upsertChatSession,
  deleteChatSessionById,
  getQjlTranslationCache,
  saveQjlTranslationCache,
  listFolkloreGraphDrafts,
  insertFolkloreGraphDraft,
  getFolkloreGraphDraftById,
  deleteFolkloreGraphDraftById,
  insertFolkloreGraphPublishLog,
} from '../db';
import {
  getSectionsByMonth,
  getSectionById,
  getSectionSummariesByMonth,
  getAvailableMonths,
  searchSectionsSoft,
  getAllSections,
  findSectionForMonthCustom,
  collectSectionsForPictureBookTopic,
  isTopicGroundedInQjl,
  formatQjlSectionsForPictureBookPrompt,
  type QingJiaLuSection,
} from '../qingjialuSource';
import { EdgeTTS } from 'node-edge-tts';
import { tmpdir } from 'os';
import { randomUUID, createHash } from 'crypto';
import { join, resolve } from 'path';
import { readFileSync, unlinkSync } from 'fs';
import { generatePictureBookSpeech } from '../tts';
import { exportPictureBookMp4 } from '../videoExport';
import { listGeoPlaces, getGeoPlaceById } from '../services/geoRepository';
import type { GeoPlace } from '../types/geo';
import { enrichGeoPlace, normalizeGeoName } from '../services/geoPlaceEnrich';
import { expandGeoQueryTokens, placeMatchesQuery, sectionMatchesQuery } from '../services/geoQuery';
import { generateGeoMonthPlacesFromSections } from '../services/geoMonthGenerator';
import { mergeWithLockedGeoPlaces } from '../services/geoLockedMerge';
import { computeGeoPlacesDiff } from '../services/geoDiff';
import { computeGeoQualityMetrics } from '../services/geoQualityMetrics';
import {
  getPresetSliceOptions,
  GRAPH_RELATION_TYPES,
  sliceCanonicalGraph,
  sliceCanonicalGraphByMonthLabel,
  listSourceCitationsForEntity,
} from '../../src/graph/folkloreGraphModel';
import {
  getFolkloreEvidenceStats,
  getFolkloreGraph,
  getFolkloreGraphMeta,
  reloadFolkloreGraphCache,
  writeFolkloreGraphFile,
} from '../services/folkloreGraphRepository';
import { mergeQjlSectionsIntoGraph } from '../services/folkloreGraphMerge';
import type { CanonicalGraph } from '../../src/graph/folkloreGraphModel';

const router = Router();

interface AuthPayload {
  sub: string;
  username: string;
  role: 'admin' | 'editor' | 'viewer';
}

function signAuthToken(payload: AuthPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '7d' });
}

function verifyAuthTokenFromRequest(req: Request): AuthPayload | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length).trim();
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
    if (!decoded || typeof decoded !== 'object') return null;
    const role = decoded.role;
    const username = decoded.username;
    const sub = decoded.sub;
    if (
      (role !== 'admin' && role !== 'editor' && role !== 'viewer') ||
      typeof username !== 'string' ||
      typeof sub !== 'string'
    ) {
      return null;
    }
    return { sub, username, role };
  } catch {
    return null;
  }
}

function requireRole(req: Request, res: Response, allowed: Array<AuthPayload['role']>): AuthPayload | null {
  const payload = verifyAuthTokenFromRequest(req);
  if (!payload) {
    res.status(401).json({ error: '未登录或会话已失效' });
    return null;
  }
  if (!allowed.includes(payload.role)) {
    res.status(403).json({ error: '权限不足' });
    return null;
  }
  return payload;
}

async function writeAudit(
  actor: AuthPayload,
  action: string,
  targetType: string,
  targetId: string,
  detail: Record<string, unknown>
) {
  await saveGeoAuditLog({
    actorUserId: Number(actor.sub),
    actorUsername: actor.username,
    actorRole: actor.role,
    action,
    targetType,
    targetId,
    detailJson: JSON.stringify(detail),
  });
}

const FOLKLORE_SYSTEM = `你是一位精通清代苏州民俗的学者，特别是对顾禄《清嘉录》有深入研究。
读者会就《清嘉录》相关的民俗、节令、地理、文言词句等向你提问，问题可能比较随意或不够严谨。

系统有时会附带一部分从本地《清嘉录》数据中检索出的原文片段（可能不完全覆盖读者问题，但通常有一定相关性），
请遵循以下原则：

1. 若系统提供了原文片段，请优先基于这些原文进行解释、翻译和考证。当你的记忆与原文不一致时，以原文为准，并可以说明版本差异或可能原因。
2. 在原文基础上，可以结合你对清代苏州社会、礼俗、地理的知识，补充背景、演变和类比，但请避免编造原文中明确不存在的细节。
3. 若系统没有附带任何原文片段，仍可根据你已掌握的知识审慎作答。此时请注意标明不确定性，避免用“《清嘉录》中一定如何如何”这类语气，而是用“通常记载”“可能”“大致”“据一般记载”等更温和的表述。
4. 回答时尽量引用原文、解释关键用语，并给出通顺的白话说明。
5. 如果涉及古今地理对照，请结合现代苏州的情况进行说明。
6. 如果涉及文言文解析，优先结构为：先给出适量原文（可分句或分段），再逐句标出关键难词并解释，最后给出完整白话翻译，必要时再简要说明礼俗含义或历史背景。
7. 输出格式请优先采用“短标题 + 项目符号 + 简短说明（如有）”的结构化段落，不要使用 Markdown 表格（不要输出 \`|---|---|\` 这类表格语法）。

请使用 Markdown 格式回复。`;

const MONTH_JSON_SYSTEM = `你是一个民俗数据助手。请根据《清嘉录》提取指定月份的民俗信息。
只输出一个 JSON 对象，不要 markdown 或其它说明。格式如下：
{
  "month": "月份名",
  "summary": "该月份民俗的总体特征，一段话",
  "customs": [
    {
      "name": "习俗名称",
      "description": "习俗详细描述",
      "roles": ["角色1","角色2"],
      "modernStatus": "该习俗在现代苏州的存续情况或对应地点的现状（请用你对现代苏州的了解进行推断，不要说“原文未提及”之类的话；若无法判断可以留空）"
    }
  ]
}
要求：customs 须尽量穷尽原文中出现的民俗条目，数量不限。每一项的 name 必填且为简短标题（可与原文小标题对应），不要留空，不要只把名称写在 description 里。`;

// POST /api/auth/login — 登录并签发 JWT（RBAC）
router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = (req.body || {}) as { username?: string; password?: string };
    const u = typeof username === 'string' ? username.trim() : '';
    const p = typeof password === 'string' ? password : '';
    if (!u || !p) return sendJsonSafe(res, 400, { error: '请提供 username 与 password' });

    // 若配置了环境管理员，并且本次登录命中该用户名，则在登录时保证该账号存在且为 admin。
    // 这样在重启后或库迁移后不会出现“环境里改了管理员用户名，但库里未同步”的困扰。
    if (env.ADMIN_USERNAME && env.ADMIN_PASSWORD && u === env.ADMIN_USERNAME) {
      await upsertAuthUser(env.ADMIN_USERNAME, env.ADMIN_PASSWORD, 'admin');
    }

    const user = await getAuthUserByUsername(u);
    if (!user) return sendJsonSafe(res, 401, { error: '账号或密码错误' });
    let ok = false;
    try {
      ok =
        typeof user.passwordHash === 'string' &&
        user.passwordHash.length > 0 &&
        (await bcrypt.compare(p, user.passwordHash));
    } catch (bcryptErr) {
      console.error('auth login bcrypt.compare error:', bcryptErr);
      return sendJsonSafe(res, 401, { error: '账号或密码错误' });
    }
    if (!ok) return sendJsonSafe(res, 401, { error: '账号或密码错误' });
    const role = user.role;
    if (role !== 'admin' && role !== 'editor' && role !== 'viewer') {
      console.error('auth login: invalid role in DB', { username: user.username, role });
      return sendJsonSafe(res, 500, {
        error: '登录失败',
        ...(env.NODE_ENV !== 'production'
          ? { detail: `数据库中账号角色无效: ${String(role)}，应为 admin / editor / viewer` }
          : {}),
      });
    }
    let token: string;
    try {
      token = signAuthToken({ sub: String(user.id), username: user.username, role });
    } catch (signErr) {
      console.error('auth login jwt.sign error:', signErr);
      return sendJsonSafe(res, 500, {
        error: '登录失败',
        ...(env.NODE_ENV !== 'production'
          ? {
              detail: signErr instanceof Error ? signErr.message : String(signErr),
              hint: '常见原因：JWT_SECRET 为空或无效。检查 .env 中 JWT_SECRET 是否为非空字符串。',
            }
          : {}),
      });
    }
    const uid = Number(user.id);
    return sendJsonSafe(res, 200, {
      token,
      user: { id: Number.isFinite(uid) ? uid : user.id, username: user.username, role },
    });
  } catch (e) {
    console.error('auth login error:', e);
    const isDev = env.NODE_ENV !== 'production';
    const msg = e instanceof Error ? e.message : String(e);
    const pgCode =
      e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
    return sendJsonSafe(res, 500, {
      error: '登录失败',
      ...(isDev
        ? {
            detail: msg,
            ...(pgCode ? { pgCode } : {}),
            hint:
              pgCode === 'ECONNREFUSED' || msg.includes('ECONNREFUSED')
                ? '无法连接 PostgreSQL：Docker 开发请确认 api 使用 PG_HOST=db 且 db 容器已启动；宿主机直连请确认本机 Postgres 已监听对应端口。'
                : undefined,
          }
        : {}),
    });
  }
});

/** 除登录接口外，所有业务 API 须携带有效 JWT（admin / editor / viewer） */
router.use((req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  const auth = requireRole(req, res, ['admin', 'editor', 'viewer']);
  if (!auth) return;
  next();
});

// GET /api/auth/me — 验证当前 JWT
router.get('/auth/me', (req, res) => {
  const payload = verifyAuthTokenFromRequest(req);
  if (!payload) return res.status(401).json({ error: '未登录或会话已失效' });
  res.json({ user: payload });
});

// POST /api/auth/refresh — 刷新 JWT（若原 token 仍有效）
router.post('/auth/refresh', (req, res) => {
  const payload = verifyAuthTokenFromRequest(req);
  if (!payload) return res.status(401).json({ error: '未登录或会话已失效' });
  const token = signAuthToken(payload);
  res.json({ token, user: payload });
});

// GET /api/auth/users — 用户列表（admin）
router.get('/auth/users', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin']);
    if (!auth) return;
    const users = await listAuthUsers();
    res.json({ users });
  } catch (e) {
    console.error('auth users list error', e);
    res.status(500).json({ error: '读取用户失败' });
  }
});

// POST /api/auth/users — 创建用户（admin）
router.post('/auth/users', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin']);
    if (!auth) return;
    const { username, password, role } = (req.body || {}) as { username?: string; password?: string; role?: string };
    const u = typeof username === 'string' ? username.trim() : '';
    const p = typeof password === 'string' ? password : '';
    const r = role === 'editor' || role === 'viewer' ? role : '';
    if (!u || !p || !r) {
      return res.status(400).json({ error: '请提供 username/password，角色仅可为 editor 或 viewer' });
    }
    await createAuthUser(u, p, r);
    await writeAudit(auth, 'auth.user.create', 'auth_user', u, { role: r });
    res.json({ ok: true });
  } catch (e) {
    console.error('auth users create error', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '创建用户失败' });
  }
});

// PATCH /api/auth/users/:id — 更新角色/密码（admin）
router.patch('/auth/users/:id', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin']);
    if (!auth) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: '无效用户 id' });
    const { role, password } = (req.body || {}) as { role?: string; password?: string };
    const target = await getAuthUserById(id);
    if (!target) return res.status(404).json({ error: '用户不存在' });
    if (role && (role === 'editor' || role === 'viewer')) {
      if (target.role === 'admin') {
        return res.status(400).json({ error: '管理员角色不在此处修改' });
      }
      await updateAuthUserRole(id, role);
      await writeAudit(auth, 'auth.user.updateRole', 'auth_user', String(id), { role });
    }
    if (typeof password === 'string' && password.trim().length > 0) {
      await setAuthUserPassword(id, password);
      await writeAudit(auth, 'auth.user.resetPassword', 'auth_user', String(id), { via: 'admin' });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('auth users patch error', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '更新用户失败' });
  }
});

// DELETE /api/auth/users/:id — 删除用户（admin）
router.delete('/auth/users/:id', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin']);
    if (!auth) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: '无效用户 id' });
    if (Number(auth.sub) === id) return res.status(400).json({ error: '不能删除当前登录账号' });
    const target = await getAuthUserById(id);
    if (!target) return res.status(404).json({ error: '用户不存在' });
    if (target.role === 'admin') {
      const adminCount = await countAuthUsersByRole('admin');
      if (adminCount <= 1) return res.status(400).json({ error: '系统至少需要保留 1 个 admin 账号' });
    }
    await deleteAuthUser(id);
    await writeAudit(auth, 'auth.user.delete', 'auth_user', String(id), {});
    res.json({ ok: true });
  } catch (e) {
    console.error('auth users delete error', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '删除用户失败' });
  }
});

function formatGeoContextBlock(ctx: {
  month: string;
  placeName: string;
  ancientEvidence?: string;
  citations: Array<{ chapterTitle: string; quoteText: string; sectionId?: string }>;
}): string {
  const citeLines = (ctx.citations || []).map((c, i) => {
    const sid = c.sectionId ? ` sectionId=${c.sectionId}` : '';
    return `${i + 1}. 《${c.chapterTitle}》${sid}\n   「${c.quoteText}」`;
  });
  return [
    '【地理卡片上下文 · 仅供你答题引用，请勿当作独立文献出处对外断言】',
    `月份：${ctx.month}`,
    `地点：${ctx.placeName}`,
    ctx.ancientEvidence ? `文献可证摘要：${ctx.ancientEvidence}` : '',
    '证据摘录：',
    ...citeLines,
  ]
    .filter(Boolean)
    .join('\n');
}

async function buildGeoMonthPayloadCore(
  monthTrimmed: string,
  sections: ReturnType<typeof getSectionsByMonth>,
  apiKey: string,
  modelText: string,
  urlText: string
): Promise<{ payload: Record<string, unknown>; places: GeoPlace[]; sourceKey: string }> {
  const sourceKey = sections.length > 0 ? monthDataSourceKey(sections.map((s) => s.id)) : `noground:${monthTrimmed}`;

  if (sections.length === 0) {
    const lockedRows = await getLockedGeoReviewRows(monthTrimmed);
    const merged = mergeWithLockedGeoPlaces([], lockedRows);
    const payload = {
      month: monthTrimmed,
      count: merged.length,
      places: merged,
      _meta: { grounded: false, sectionCount: 0, sourceKey, stale: false },
    };
    await saveGeoMonthDataCache(monthTrimmed, merged, sourceKey);
    return { payload, places: merged, sourceKey };
  }

  const enrichedRaw = await generateGeoMonthPlacesFromSections(monthTrimmed, sections, apiKey, modelText, urlText);
  const lockedRows = await getLockedGeoReviewRows(monthTrimmed);
  const enriched = mergeWithLockedGeoPlaces(enrichedRaw, lockedRows);

  const prev = await getGeoMonthDataCache(monthTrimmed);
  if (prev) {
    try {
      const oldPayload = JSON.parse(prev.payloadJson) as { places?: GeoPlace[] };
      const oldPlaces = oldPayload.places || [];
      const diff = computeGeoPlacesDiff(oldPlaces, enriched);
      await saveGeoRebuildLog(
        monthTrimmed,
        prev.payloadJson,
        JSON.stringify({ month: monthTrimmed, count: enriched.length, places: enriched }),
        JSON.stringify(diff)
      );
    } catch (e) {
      console.warn('[geo] rebuild log skipped', e);
    }
  }

  await saveGeoMonthDataCache(monthTrimmed, enriched, sourceKey);
  const payload = {
    month: monthTrimmed,
    count: enriched.length,
    places: enriched,
    _meta: {
      grounded: true,
      sectionCount: sections.length,
      sourceKey,
      stale: false,
      cacheMismatch: false,
      regenerated: true,
    },
  };
  return { payload, places: enriched, sourceKey };
}

function getLlmModels() {
  const c = getLlmConfig();
  const modelText = c?.model_text ?? '';
  const rawUrlText = c?.url_text?.trim() ?? '';
  // 默认按官方 OpenAI 兼容协议：用户不填 URL 时，走 compatible-mode/v1
  const urlText = rawUrlText || 'https://dashscope.aliyuncs.com/compatible-mode/v1';

  const modelImage = c?.model_image ?? '';
  const rawUrlImage = c?.url_image?.trim() ?? '';
  // 图像如果未填写 URL，则保持为空，由前端提示用户配置；避免误调用错误路径
  const urlImage = rawUrlImage;

  const modelTts = c?.model_tts ?? '';
  const rawUrlTts = c?.url_tts?.trim() ?? '';
  // 语音模型默认也使用 DashScope 官方 base，由 TTS 封装自动补全路径
  const urlTts = rawUrlTts || 'https://dashscope.aliyuncs.com/api/v1';

  return {
    modelText,
    urlText,
    modelImage,
    urlImage,
    modelTts,
    urlTts,
    voiceTts: c?.voice_tts?.trim() ?? '',
    apiKeyTts: getDashScopeApiKeyTts(),
  };
}

// POST /api/llm/chat — 民俗问答
router.post('/llm/chat', async (req, res) => {
  try {
    const apiKey = requireDashScope();
    const { modelText, urlText } = getLlmModels();
    if (!urlText) return res.status(400).json({ error: '请先在「大模型配置」→ 文本模型中填写 URL' });
    if (!modelText) return res.status(400).json({ error: '请先在「大模型配置」→ 文本模型中填写模型名称' });
    const { message, geoContext } = req.body as {
      message?: string;
      geoContext?: {
        month?: string;
        placeName?: string;
        ancientEvidence?: string;
        citations?: Array<{ chapterTitle?: string; quoteText?: string; sectionId?: string }>;
      };
    };
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: '请提供 message 字段' });
    }
    const rawQuestion = message.trim();
    let augmentedQuestion = rawQuestion;
    if (geoContext && typeof geoContext === 'object') {
      const month = typeof geoContext.month === 'string' ? geoContext.month.trim() : '';
      const placeName = typeof geoContext.placeName === 'string' ? geoContext.placeName.trim() : '';
      const ancientEvidence = typeof geoContext.ancientEvidence === 'string' ? geoContext.ancientEvidence.trim() : '';
      const citations = Array.isArray(geoContext.citations)
        ? geoContext.citations.map((c) => ({
            chapterTitle: (c.chapterTitle || '').trim(),
            quoteText: (c.quoteText || '').trim(),
            sectionId: typeof c.sectionId === 'string' ? c.sectionId.trim() : undefined,
          }))
        : [];
      if (month && placeName && citations.length > 0) {
        augmentedQuestion = [
          formatGeoContextBlock({ month, placeName, ancientEvidence: ancientEvidence || undefined, citations }),
          '',
          '---',
          '',
          '读者的问题：',
          rawQuestion,
        ].join('\n');
      }
    }
    // 软 Grounding：检索仍用读者原句，避免地理附文干扰命中
    let messages: { role: 'system' | 'user'; content: string }[];
    try {
      const matched = searchSectionsSoft(rawQuestion, 6);
      if (matched.length > 0) {
        const context = matched
          .map((s, idx) => {
            const metaParts: string[] = [];
            if (s.juan) metaParts.push(`卷：${s.juan}`);
            if (s.month) metaParts.push(`月份：${s.month}`);
            const meta = metaParts.length ? `（${metaParts.join('，')}）` : '';
            return `【段落 ${idx + 1}】${s.title}${meta}\n${s.content}`;
          })
          .join('\n\n');

        messages = [
          { role: 'system', content: FOLKLORE_SYSTEM },
          {
            role: 'user',
            content: [
              '读者的问题：',
              augmentedQuestion,
              '',
              '系统已在本地《清嘉录》全文中检索到若干可能相关的原文片段，仅作为回答依据的一部分提供给你。',
              '这些片段不一定完全覆盖读者问题，但通常与其中提到的节令、习俗或地名有一定关联。',
              '请在回答时优先参考这些原文，并结合你的民俗知识进行解释和翻译。',
              '',
              context,
            ].join('\n'),
          },
        ];
      } else {
        messages = [
          { role: 'system', content: FOLKLORE_SYSTEM },
          {
            role: 'user',
            content: [
              '读者的问题：',
              augmentedQuestion,
              '',
              '系统暂未在本地《清嘉录》数据中检索到特别明确对应的条目，请你根据自己对清代苏州民俗和《清嘉录》的理解，审慎作答。',
              '如有不确定之处，请用更温和的语气表达（例如“可能”“大致”“据一般记载”等），避免断言具体条文内容。',
            ].join('\n'),
          },
        ];
      }
    } catch {
      messages = [
        { role: 'system', content: FOLKLORE_SYSTEM },
        { role: 'user', content: augmentedQuestion },
      ];
    }

    const reply = await dashscopeChat(apiKey, messages, modelText, urlText);
    res.json({ text: reply });
  } catch (e) {
    console.error('LLM chat error:', e);
    res.status(500).json({
      error: e instanceof Error ? e.message : '服务暂时不可用，请稍后再试。',
    });
  }
});

// POST /api/tts/edge — 仅用于解析模块的语音合成
router.post('/tts/edge', async (req, res) => {
  try {
    const { text, voice } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: '请提供 text 字段' });
    }

    // 默认使用一个通用的简体中文女声，可按需调整或通过前端传入 voice
    const voiceName = typeof voice === 'string' && voice.trim()
      ? voice.trim()
      : 'zh-CN-XiaoxiaoNeural';

    const tts = new EdgeTTS({
      voice: voiceName,
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    });

    const tmpPath = join(tmpdir(), `edge-tts-${randomUUID()}.mp3`);
    await tts.ttsPromise(text, tmpPath);

    const audioBuffer = readFileSync(tmpPath);
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', String(audioBuffer.length));
    res.send(audioBuffer);
  } catch (e) {
    console.error('Edge TTS error:', e);
    res.status(500).json({
      error: e instanceof Error ? e.message : '语音合成失败，请稍后再试。',
    });
  }
});

// POST /api/llm/month-data — 按月份获取结构化民俗数据（有缓存则直接返回，避免每次选月都调 LLM）
router.post('/llm/month-data', async (req, res) => {
  try {
    const { month, refresh } = req.body || {};
    if (!month || typeof month !== 'string') {
      return res.status(400).json({ error: '请提供 month 字段' });
    }
    const monthTrimmed = month.trim();
    const sections = getSectionsByMonth(monthTrimmed);
    const sourceKey =
      sections.length > 0
        ? monthDataSourceKey(sections.map((s) => s.id))
        : `noground:${monthTrimmed}`;

    // 未要求刷新且缓存命中且原文未变 → 直接返回，不再「翻阅」大模型
    if (refresh !== true) {
      const cached = await getMonthDataCache(monthTrimmed);
      if (cached && cached.sourceKey === sourceKey) {
        try {
          const parsed = JSON.parse(cached.payloadJson) as Record<string, unknown>;
          return res.json(parsed);
        } catch {
          // 缓存损坏则继续走生成
        }
      }
    }

    const apiKey = requireDashScope();
    const { modelText, urlText } = getLlmModels();
    if (!urlText) return res.status(400).json({ error: '请先在「大模型配置」→ 文本模型中填写 URL' });
    if (!modelText) return res.status(400).json({ error: '请先在「大模型配置」→ 文本模型中填写模型名称' });

    if (!sections.length) {
      // 如果该月在本地原文中没有找到，仍然允许模型自由回答，避免前端直接报错
      const data = await dashscopeChatJson<MonthData>(
        apiKey,
        MONTH_JSON_SYSTEM,
        `请提取《清嘉录》中关于“${monthTrimmed}”的核心民俗活动。`,
        modelText,
        urlText
      );
      const payload = { ...data, _meta: { grounded: false, sectionCount: 0, sectionTitles: [] as string[] } };
      await saveMonthDataCache(monthTrimmed, payload, sourceKey);
      return res.json(payload);
    }

    const sourceText = sections
      .map((s) => `【${s.title}】\n${s.content}`)
      .join('\n\n');

    const systemPrompt =
      MONTH_JSON_SYSTEM +
      '\n\n你只能根据下面提供的《清嘉录》原文来提取信息，不得编造原文中没有提到的习俗名称或内容。';

    const userPrompt = [
      `请仅基于下方《清嘉录》中关于“${monthTrimmed}”的原文，提取该月份的核心民俗活动并整理为结构化数据。`,
      '',
      '《清嘉录》原文：',
      sourceText,
    ].join('\n');

    const data = await dashscopeChatJson<MonthData>(
      apiKey,
      systemPrompt,
      userPrompt,
      modelText,
      urlText
    );
    const payload = {
      ...data,
      _meta: {
        grounded: true,
        sectionCount: sections.length,
        sectionTitles: sections.map((s) => s.title),
      },
    };
    await saveMonthDataCache(monthTrimmed, payload, sourceKey);
    return res.json(payload);
  } catch (e) {
    console.error('LLM month-data error:', e);
    res.status(500).json({
      error: e instanceof Error ? e.message : '获取月份数据失败，请稍后再试。',
    });
  }
});

// POST /api/geo/month-data — 地理模块按月在线抽取 + RAG 对照（缓存）
router.post('/geo/month-data', async (req, res) => {
  try {
    const { month, refresh } = req.body || {};
    if (!month || typeof month !== 'string') return res.status(400).json({ error: '请提供 month 字段' });
    const monthTrimmed = month.trim();
    const sections = getSectionsByMonth(monthTrimmed);
    const sourceKey = sections.length > 0 ? monthDataSourceKey(sections.map((s) => s.id)) : `noground:${monthTrimmed}`;

    if (refresh !== true) {
      const cached = await getGeoMonthDataCache(monthTrimmed);
      if (cached) {
        try {
          const parsed = JSON.parse(cached.payloadJson) as Record<string, unknown>;
          const cacheMismatch = cached.sourceKey !== sourceKey;
          if (!cacheMismatch) {
            return res.json(parsed);
          }

          // 原文索引变更：尝试自动重算；失败则返回旧数据并标记 stale
          try {
            const apiKey = requireDashScope();
            const { modelText, urlText } = getLlmModels();
            if (!urlText || !modelText) throw new Error('missing_llm_config');
            const rebuilt = await buildGeoMonthPayloadCore(monthTrimmed, sections, apiKey, modelText, urlText);
            return res.json(rebuilt.payload);
          } catch (e) {
            console.warn('[geo/month-data] cache stale, regeneration failed:', e);
            const meta = (typeof parsed._meta === 'object' && parsed._meta) ? (parsed._meta as Record<string, unknown>) : {};
            return res.json({
              ...parsed,
              _meta: {
                ...meta,
                grounded: sections.length > 0,
                sectionCount: sections.length,
                sourceKey,
                cachedSourceKey: cached.sourceKey,
                stale: true,
                cacheMismatch: true,
                regenerated: false,
              },
            });
          }
        } catch {
          // ignore broken cache and regenerate
        }
      }
    }

    const apiKey = requireDashScope();
    const { modelText, urlText } = getLlmModels();
    if (!urlText) return res.status(400).json({ error: '请先在「大模型配置」→ 文本模型中填写 URL' });
    if (!modelText) return res.status(400).json({ error: '请先在「大模型配置」→ 文本模型中填写模型名称' });

    const rebuilt = await buildGeoMonthPayloadCore(monthTrimmed, sections, apiKey, modelText, urlText);
    return res.json(rebuilt.payload);
  } catch (e) {
    console.error('Geo month-data error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '获取地理数据失败' });
  }
});

// GET /api/geo/glossary — 制度性地点等术语短注解（静态表，含来源标注）
router.get('/geo/glossary', (_req, res) => {
  try {
    const raw = readFileSync(resolve(process.cwd(), 'server/data/geo-glossary.v1.json'), 'utf8');
    const entries = JSON.parse(raw) as unknown[];
    res.json({ entries });
  } catch (e) {
    console.error('geo glossary', e);
    res.status(500).json({ error: '读取术语表失败' });
  }
});

// GET /api/geo/export?month=正月&format=json|md — 导出当月缓存（研究/课件）
router.get('/geo/export', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin', 'editor', 'viewer']);
    if (!auth) return;
    const month = typeof req.query.month === 'string' ? req.query.month.trim() : '';
    if (!month) return res.status(400).json({ error: '请提供 query 参数 month' });
    const format = req.query.format === 'md' ? 'md' : 'json';
    const cached = await getGeoMonthDataCache(month);
    if (!cached) return res.status(404).json({ error: '该月尚无在线缓存，可先「重新抽取」' });
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="geo-${encodeURIComponent(month)}.json"`);
      return res.send(cached.payloadJson);
    }
    const payload = JSON.parse(cached.payloadJson) as { places?: GeoPlace[]; _meta?: unknown };
    const places = payload.places || [];
    const lines: string[] = [`# 清嘉录 · 古今地理对照导出`, ``, `- 月份：${month}`, `- 导出时间（UTC）：${new Date().toISOString()}`, ``];
    for (const p of places) {
      lines.push(`## ${p.name}`, '');
      if (p.aliases?.length) lines.push(`- 别名：${p.aliases.join('、')}`, '');
      if (p.ancientEvidence) lines.push(`### 文献可证`, p.ancientEvidence, '');
      lines.push(`### 清代侧综述`, p.ancientSummary, '');
      if (p.modernFactual) lines.push(`### 现代（可核对）`, p.modernFactual, '');
      if (p.modernInterpretation) lines.push(`### 现代（推断）`, p.modernInterpretation, '');
      lines.push(`### 现代总述`, p.modernSummary, '');
      lines.push(`### 原文引用`, '');
      for (const c of p.citations || []) {
        lines.push(`- 《${c.chapterTitle}》 sectionId=\`${c.sectionId}\` 证据：${c.evidenceStrength || 'inferred'}`, `  > ${c.quoteText}`, '');
      }
      lines.push('---', '');
    }
    const md = lines.join('\n');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="geo-${encodeURIComponent(month)}.md"`);
    return res.send(md);
  } catch (e) {
    console.error('geo export', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '导出失败' });
  }
});

// GET /api/geo/admin/reviews?month= — 人工校审列表（需 admin/editor）
router.get('/geo/admin/reviews', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin', 'editor']);
    if (!auth) return;
    const month = typeof req.query.month === 'string' ? req.query.month.trim() : '';
    const reviews = await listGeoPlaceReviews(month || undefined);
    res.json({ reviews });
  } catch (e) {
    console.error('geo admin reviews list', e);
    res.status(500).json({ error: '读取校审记录失败' });
  }
});

// POST /api/geo/admin/reviews — body: { month, placeKey, status: pending|reviewed|locked }（需 admin/editor）
router.post('/geo/admin/reviews', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin', 'editor']);
    if (!auth) return;
    const { month, placeKey, status, placeSnapshot } = (req.body || {}) as {
      month?: string;
      placeKey?: string;
      status?: string;
      placeSnapshot?: GeoPlace;
      reviewNote?: string;
    };
    if (!month?.trim() || !placeKey?.trim() || !status?.trim()) {
      return res.status(400).json({ error: '请提供 month、placeKey、status' });
    }
    const st = status.trim() as 'pending' | 'reviewed' | 'locked';
    if (st !== 'pending' && st !== 'reviewed' && st !== 'locked') {
      return res.status(400).json({ error: 'status 须为 pending | reviewed | locked' });
    }
    const m = month.trim();
    const pk = normalizeGeoName(placeKey.trim());
    const note = typeof (req.body as { reviewNote?: unknown }).reviewNote === 'string'
      ? (req.body as { reviewNote?: string }).reviewNote!.trim().slice(0, 500)
      : null;
    const cached = await getGeoMonthDataCache(m);
    let place: GeoPlace | null = null;
    if (cached) {
      const payload = JSON.parse(cached.payloadJson) as { places?: GeoPlace[] };
      place = (payload.places || []).find((p) => normalizeGeoName(p.name) === pk) || null;
    }
    if (!place && placeSnapshot && typeof placeSnapshot === 'object' && normalizeGeoName(placeSnapshot.name || '') === pk) {
      place = placeSnapshot;
    }
    if (!place) {
      return res.status(404).json({ error: '当月缓存中找不到该地名，请先执行该月份「重新抽取」后再校审' });
    }
    const snapshotSource = placeSnapshot && typeof placeSnapshot === 'object' ? placeSnapshot : place;
    const snapshotJson = snapshotSource ? JSON.stringify(snapshotSource) : null;
    await upsertGeoPlaceReview(m, pk, st, snapshotJson, auth.username, note);
    await writeAudit(auth, 'geo.review.upsert', 'geo_place_review', `${m}:${pk}`, { month: m, placeKey: pk, status: st, note });
    res.json({ ok: true, month: m, placeKey: pk, status: st });
  } catch (e) {
    console.error('geo admin reviews upsert', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '写入失败' });
  }
});

// DELETE /api/geo/admin/reviews?month=&placeKey=
router.delete('/geo/admin/reviews', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin']);
    if (!auth) return;
    const month = typeof req.query.month === 'string' ? req.query.month.trim() : '';
    const placeKey = typeof req.query.placeKey === 'string' ? req.query.placeKey.trim() : '';
    if (!month || !placeKey) return res.status(400).json({ error: '请提供 month、placeKey' });
    await deleteGeoPlaceReview(month, normalizeGeoName(placeKey));
    await writeAudit(auth, 'geo.review.delete', 'geo_place_review', `${month}:${normalizeGeoName(placeKey)}`, { month, placeKey: normalizeGeoName(placeKey) });
    res.json({ ok: true });
  } catch (e) {
    console.error('geo admin reviews delete', e);
    res.status(500).json({ error: '删除失败' });
  }
});

// POST /api/geo/admin/rebuild-preview — body: { month } 重算预览 + diff（不写库，需 admin/editor）
router.post('/geo/admin/rebuild-preview', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin', 'editor']);
    if (!auth) return;
    const { month } = (req.body || {}) as { month?: string };
    if (!month?.trim()) return res.status(400).json({ error: '请提供 month' });
    const m = month.trim();
    const sections = getSectionsByMonth(m);
    const apiKey = requireDashScope();
    const { modelText, urlText } = getLlmModels();
    if (!urlText || !modelText) return res.status(400).json({ error: '请先配置文本模型' });
    const beforeRow = await getGeoMonthDataCache(m);
    const beforePlaces = beforeRow
      ? ((JSON.parse(beforeRow.payloadJson) as { places?: GeoPlace[] }).places || [])
      : [];
    const enrichedRaw = await generateGeoMonthPlacesFromSections(m, sections, apiKey, modelText, urlText);
    const lockedRows = await getLockedGeoReviewRows(m);
    const afterPlaces = mergeWithLockedGeoPlaces(enrichedRaw, lockedRows);
    const diff = computeGeoPlacesDiff(beforePlaces, afterPlaces);
    await writeAudit(auth, 'geo.rebuild.preview', 'geo_month_cache', m, {
      beforeCount: beforePlaces.length,
      afterCount: afterPlaces.length,
      diff,
    });
    res.json({
      month: m,
      dryRun: true,
      beforeCount: beforePlaces.length,
      afterCount: afterPlaces.length,
      diff,
      afterPlaces,
    });
  } catch (e) {
    console.error('geo admin rebuild-preview', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '预览失败' });
  }
});

// GET /api/geo/admin/audit-logs?limit=100
router.get('/geo/admin/audit-logs', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin', 'editor', 'viewer']);
    if (!auth) return;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 100;
    const logs = await listGeoAuditLogs(Number.isFinite(limit) ? limit : 100);
    res.json({ logs });
  } catch (e) {
    console.error('geo admin audit-logs', e);
    res.status(500).json({ error: '读取审计日志失败' });
  }
});

// GET /api/geo/admin/metrics — 质量指标（需 admin/editor/viewer）
router.get('/geo/admin/metrics', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin', 'editor', 'viewer']);
    if (!auth) return;
    const reviews = await listGeoPlaceReviews();
    const lockedCount = reviews.filter((r) => r.status === 'locked').length;
    const metrics = await computeGeoQualityMetrics(lockedCount);
    res.json(metrics);
  } catch (e) {
    console.error('geo admin metrics', e);
    res.status(500).json({ error: '计算指标失败' });
  }
});

// GET /api/geo/admin/rebuild-logs?month=正月&limit=20
router.get('/geo/admin/rebuild-logs', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin', 'editor', 'viewer']);
    if (!auth) return;
    const month = typeof req.query.month === 'string' ? req.query.month.trim() : '';
    if (!month) return res.status(400).json({ error: '请提供 month' });
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 20;
    const logs = await listGeoRebuildLogs(month, Number.isFinite(limit) ? limit : 20);
    res.json({ logs });
  } catch (e) {
    console.error('geo admin rebuild-logs', e);
    res.status(500).json({ error: '读取日志失败' });
  }
});

// POST /api/geo/search — 地名/全文检索（含别名扩展），聚合在线缓存 + 离线兜底数据
router.post('/geo/search', async (req, res) => {
  try {
    const { query, month, customTitle, limit } = (req.body || {}) as {
      query?: string;
      month?: string;
      customTitle?: string;
      limit?: number;
    };
    if (!query || typeof query !== 'string') return res.status(400).json({ error: '请提供 query 字段' });
    const tokens = expandGeoQueryTokens(query);
    const max = typeof limit === 'number' && limit > 0 ? Math.min(limit, 500) : 200;

    const hits: GeoPlace[] = [];
    const pushUnique = (p: GeoPlace) => {
      if (hits.length >= max) return;
      if (!hits.some((x) => x.id === p.id)) hits.push(p);
    };

    // 离线兜底
    for (const p of listGeoPlaces()) {
      if (!placeMatchesQuery(p, tokens)) continue;
      pushUnique(enrichGeoPlace(p));
    }

    const monthFilter = typeof month === 'string' && month.trim() ? month.trim() : '';
    const custom = typeof customTitle === 'string' && customTitle.trim() ? customTitle.trim() : '';

    const rows = await listGeoMonthCacheRows();
    for (const row of rows) {
      if (monthFilter && row.month !== monthFilter) continue;
      let payload: { places?: GeoPlace[] } = {};
      try {
        payload = JSON.parse(row.payloadJson) as { places?: GeoPlace[] };
      } catch {
        continue;
      }
      const places = Array.isArray(payload.places) ? payload.places : [];
      const sectionScope = monthFilter ? getSectionsByMonth(monthFilter) : getSectionsByMonth(row.month);
      for (const p of places) {
        const placeOk = placeMatchesQuery(p, tokens);
        const customOk =
          !custom ||
          (p.citations || []).some((c) => {
            const sec = sectionScope.find((s) => s.id === c.sectionId);
            return sec && sec.title.includes(custom);
          });
        if (placeOk && customOk) pushUnique(enrichGeoPlace(p));
      }
    }

    // 全文：在 sections 中命中 token 的月份，尝试返回该月缓存中的地点（若存在）
    if (hits.length < max) {
      const allSections = getAllSections();
      const monthsToScan = monthFilter ? [monthFilter] : Array.from(new Set(allSections.map((s) => s.month).filter(Boolean))) as string[];
      for (const m of monthsToScan) {
        const secs = getSectionsByMonth(m);
        const matchedSections = secs.filter((s) => sectionMatchesQuery(s, tokens));
        if (!matchedSections.length) continue;
        const cached = await getGeoMonthDataCache(m);
        if (!cached) continue;
        try {
          const payload = JSON.parse(cached.payloadJson) as { places?: GeoPlace[] };
          const places = Array.isArray(payload.places) ? payload.places : [];
          for (const p of places) {
            const related = (p.citations || []).some((c) => matchedSections.some((s) => s.id === c.sectionId));
            if (!related) continue;
            if (custom && !(p.citations || []).some((c) => {
              const sec = secs.find((s) => s.id === c.sectionId);
              return sec && sec.title.includes(custom);
            })) {
              continue;
            }
            pushUnique(enrichGeoPlace(p));
          }
        } catch {
          // ignore
        }
      }
    }

    res.json({
      query: query.trim(),
      tokens,
      month: monthFilter || null,
      customTitle: custom || null,
      count: hits.length,
      places: hits,
    });
  } catch (e) {
    console.error('Geo search error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '搜索失败' });
  }
});

// ---------- 《清嘉录》原文（sections.json）----------
// GET /api/geo/places?month=正月 — 地理卡片（按月动态）
router.get('/geo/places', (req, res) => {
  try {
    const month = typeof req.query.month === 'string' ? req.query.month.trim() : '';
    const places = listGeoPlaces(month || undefined);
    res.json({
      month: month || null,
      count: places.length,
      places,
    });
  } catch (e) {
    console.error('Geo places error:', e);
    res.status(500).json({ error: '读取地理数据失败' });
  }
});

// GET /api/geo/places/aggregate?name=玄妙观 — 同名地点跨月聚合（基于在线缓存 + 离线兜底）
router.get('/geo/places/aggregate', async (req, res) => {
  try {
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    if (!name) return res.status(400).json({ error: '请提供 query 参数 name' });
    const tokens = expandGeoQueryTokens(name);

    const normalizeQuoteForMerge = (q: string) => (q || '').replace(/[。；，、：:“”"'\s]/g, '').trim();
    const citationScore = (c: { sectionId?: string; chapterTitle: string; quoteText: string }) =>
      (c.sectionId ? 10 : 0) + (c.chapterTitle?.trim().length || 0);
    const merged = new Map<string, GeoPlace>();
    const upsert = (p: GeoPlace) => {
      const key = normalizeGeoName(p.name);
      const cur = merged.get(key);
      if (!cur) {
        merged.set(key, { ...p, months: Array.from(new Set(p.months)) });
        return;
      }
      cur.months = Array.from(new Set([...cur.months, ...p.months]));
      const citeMap = new Map<string, GeoPlace['citations'][number]>();
      for (const c of cur.citations) {
        const k = `${c.sectionId || ''}|${normalizeQuoteForMerge(c.quoteText)}`;
        citeMap.set(k, c);
      }
      for (const c of p.citations) {
        const strictKey = `${c.sectionId || ''}|${normalizeQuoteForMerge(c.quoteText)}`;
        const looseKey = `|${normalizeQuoteForMerge(c.quoteText)}`;
        const existed = citeMap.get(strictKey) || citeMap.get(looseKey);
        if (!existed) {
          citeMap.set(strictKey, c);
          cur.citations.push(c);
          continue;
        }
        // 同一句引文（仅标点差异）出现多个标题版本时，保留更可信的一条
        if (citationScore(c) > citationScore(existed)) {
          const idx = cur.citations.findIndex((x) =>
            (x.sectionId || '') === (existed.sectionId || '') &&
            normalizeQuoteForMerge(x.quoteText) === normalizeQuoteForMerge(existed.quoteText)
          );
          if (idx >= 0) cur.citations[idx] = c;
          citeMap.set(strictKey, c);
        }
      }
    };

    const rows = await listGeoMonthCacheRows();
    for (const row of rows) {
      let payload: { places?: GeoPlace[] } = {};
      try {
        payload = JSON.parse(row.payloadJson) as { places?: GeoPlace[] };
      } catch {
        continue;
      }
      const places = Array.isArray(payload.places) ? payload.places : [];
      for (const p of places) {
        if (!placeMatchesQuery(p, tokens)) continue;
        upsert(enrichGeoPlace({ ...p, months: Array.from(new Set([...(p.months || []), row.month])) }));
      }
    }

    const list = Array.from(merged.values()).sort((a, b) => a.months.join(',').localeCompare(b.months.join(',')));
    res.json({ name, count: list.length, places: list });
  } catch (e) {
    console.error('Geo aggregate error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '聚合失败' });
  }
});

// GET /api/geo/places/:id — 地理详情
router.get('/geo/places/:id', (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: '请提供有效的地点 id' });
    const place = getGeoPlaceById(id);
    if (!place) return res.status(404).json({ error: '未找到该地点' });
    res.json(place);
  } catch (e) {
    console.error('Geo place detail error:', e);
    res.status(500).json({ error: '读取地点详情失败' });
  }
});

function parseCanonicalGraphPayload(raw: unknown): CanonicalGraph | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { entities?: unknown; relations?: unknown };
  if (!Array.isArray(o.entities) || !Array.isArray(o.relations)) return null;
  return raw as CanonicalGraph;
}

// ---------- 民俗知识图谱（只读 canonical graph）----------
router.get('/graph', (_req, res) => {
  try {
    const g = getFolkloreGraph();
    const evidence = getFolkloreEvidenceStats(g);
    const meta = getFolkloreGraphMeta();
    res.json({
      version: 1,
      meta,
      evidence,
      entities: g.entities,
      relations: g.relations,
    });
  } catch (e) {
    console.error('Folklore graph GET error:', e);
    res.status(500).json({ error: '读取图谱数据失败' });
  }
});

// POST /api/graph/reload — 重新从磁盘加载图谱 JSON（admin/editor，用于更新数据后免重启）
router.post('/graph/reload', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin', 'editor']);
    if (!auth) return;
    const meta = reloadFolkloreGraphCache();
    const g = getFolkloreGraph();
    const evidence = getFolkloreEvidenceStats(g);
    await writeAudit(auth, 'folklore.graph.reload', 'folklore_graph', meta.contentSha256.slice(0, 16), {
      contentSha256: meta.contentSha256,
      fileMtimeMs: meta.fileMtimeMs,
      entityCount: meta.entityCount,
      relationCount: meta.relationCount,
    });
    res.json({ ok: true, meta, evidence });
  } catch (e) {
    console.error('Folklore graph reload error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '图谱热重载失败' });
  }
});

// POST /api/graph/admin/merge-from-qjl — 按《清嘉录》小节补全缺口（dryRun 仅统计）
router.post('/graph/admin/merge-from-qjl', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin', 'editor']);
    if (!auth) return;
    const dryRun = Boolean((req.body as { dryRun?: boolean } | undefined)?.dryRun);
    const base = getFolkloreGraph();
    const sections = getAllSections();
    const { graph: merged, addedPractices, skippedNoMonth, skippedNoTimeNode } = mergeQjlSectionsIntoGraph(
      base,
      sections
    );
    const evidenceMerged = getFolkloreEvidenceStats(merged);
    if (dryRun) {
      res.json({
        dryRun: true,
        sectionCount: sections.length,
        addedPractices,
        skippedNoMonth,
        skippedNoTimeNode,
        entityCount: merged.entities.length,
        relationCount: merged.relations.length,
        evidence: evidenceMerged,
      });
      return;
    }
    const meta = writeFolkloreGraphFile(merged);
    const evidence = getFolkloreEvidenceStats(getFolkloreGraph());
    await writeAudit(auth, 'folklore.graph.mergeFromQjl', 'folklore_graph', meta.contentSha256.slice(0, 16), {
      addedPractices,
      skippedNoMonth,
      skippedNoTimeNode,
      contentSha256: meta.contentSha256,
    });
    await insertFolkloreGraphPublishLog({
      contentSha256: meta.contentSha256,
      entityCount: meta.entityCount,
      relationCount: meta.relationCount,
      note: `merge-from-qjl +${addedPractices}`,
      actorUsername: auth.username,
    });
    res.json({
      ok: true,
      meta,
      addedPractices,
      skippedNoMonth,
      skippedNoTimeNode,
      sectionCount: sections.length,
      evidence,
    });
  } catch (e) {
    console.error('Folklore graph merge-from-qjl error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '图谱合并失败' });
  }
});

// GET /api/graph/admin/drafts — 图谱草稿列表
router.get('/graph/admin/drafts', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin', 'editor']);
    if (!auth) return;
    const drafts = await listFolkloreGraphDrafts(80);
    res.json({ drafts });
  } catch (e) {
    console.error('Folklore graph drafts list error:', e);
    res.status(500).json({ error: '读取草稿失败' });
  }
});

// POST /api/graph/admin/drafts — 保存当前图谱或 body.payload 为草稿
router.post('/graph/admin/drafts', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin', 'editor']);
    if (!auth) return;
    const body = (req.body || {}) as { title?: string; payload?: unknown };
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return res.status(400).json({ error: '请提供 title' });
    let graph: CanonicalGraph;
    if (body.payload !== undefined) {
      const parsed = parseCanonicalGraphPayload(body.payload);
      if (!parsed) return res.status(400).json({ error: 'payload 不是有效的图谱对象' });
      graph = parsed;
    } else {
      graph = getFolkloreGraph();
    }
    const id = await insertFolkloreGraphDraft({
      title: title.slice(0, 200),
      payloadJson: JSON.stringify(graph),
      createdByUsername: auth.username,
    });
    res.json({ ok: true, id });
  } catch (e) {
    console.error('Folklore graph draft save error:', e);
    res.status(500).json({ error: '保存草稿失败' });
  }
});

// POST /api/graph/admin/publish-draft/:id — 将草稿写回 folklore-graph.v1.json 并热重载
router.post('/graph/admin/publish-draft/:id', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin', 'editor']);
    if (!auth) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: '无效草稿 id' });
    const row = await getFolkloreGraphDraftById(id);
    if (!row) return res.status(404).json({ error: '草稿不存在' });
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payloadJson) as unknown;
    } catch {
      return res.status(400).json({ error: '草稿 JSON 损坏' });
    }
    const graph = parseCanonicalGraphPayload(parsed);
    if (!graph) return res.status(400).json({ error: '草稿不是有效图谱' });
    const meta = writeFolkloreGraphFile(graph);
    const evidence = getFolkloreEvidenceStats(getFolkloreGraph());
    await writeAudit(auth, 'folklore.graph.publishDraft', 'folklore_graph', meta.contentSha256.slice(0, 16), {
      draftId: id,
      draftTitle: row.title,
      contentSha256: meta.contentSha256,
    });
    await insertFolkloreGraphPublishLog({
      contentSha256: meta.contentSha256,
      entityCount: meta.entityCount,
      relationCount: meta.relationCount,
      note: `publish-draft:${id} ${row.title}`,
      actorUsername: auth.username,
    });
    res.json({ ok: true, meta, evidence });
  } catch (e) {
    console.error('Folklore graph publish-draft error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '发布草稿失败' });
  }
});

// DELETE /api/graph/admin/drafts/:id
router.delete('/graph/admin/drafts/:id', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin', 'editor']);
    if (!auth) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: '无效草稿 id' });
    const ok = await deleteFolkloreGraphDraftById(id);
    if (!ok) return res.status(404).json({ error: '草稿不存在' });
    await writeAudit(auth, 'folklore.graph.draft.delete', 'folklore_graph_draft', String(id), {});
    res.json({ ok: true });
  } catch (e) {
    console.error('Folklore graph draft delete error:', e);
    res.status(500).json({ error: '删除草稿失败' });
  }
});

// GET /api/graph/evidence-metrics — 图谱关系证据覆盖率
router.get('/graph/evidence-metrics', (_req, res) => {
  try {
    const g = getFolkloreGraph();
    const evidence = getFolkloreEvidenceStats(g);
    const meta = getFolkloreGraphMeta();
    res.json({ version: 1, meta, evidence });
  } catch (e) {
    console.error('Folklore graph evidence metrics GET error:', e);
    res.status(500).json({ error: '读取图谱证据指标失败' });
  }
});

// GET /api/graph/subgraph?preset=...&month=正月
router.get('/graph/subgraph', (req, res) => {
  try {
    const graph = getFolkloreGraph();
    const month = typeof req.query.month === 'string' ? req.query.month.trim() : '';
    const presetRaw = typeof req.query.preset === 'string' ? req.query.preset.trim() : '';
    const preset =
      presetRaw === 'month_custom_role' ||
      presetRaw === 'time_place_practice' ||
      presetRaw === 'narrative_practice_concept_experience'
        ? presetRaw
        : null;

    const parseCsv = (v: unknown): string[] => {
      if (typeof v !== 'string') return [];
      return v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    };

    const entityTypesRaw = parseCsv(req.query.entityTypes);
    const relationTypesRaw = parseCsv(req.query.relationTypes);
    const onlyWithSourcesRaw = typeof req.query.onlyWithSources === 'string' ? req.query.onlyWithSources.trim() : '';
    const onlyWithSources = onlyWithSourcesRaw === '1' || onlyWithSourcesRaw === 'true';
    const allEntityTypes = new Set(['time', 'practice', 'actor', 'place', 'artifact', 'source', 'concept', 'experience']);
    const allRelationTypes = new Set(GRAPH_RELATION_TYPES);

    const presetOptions = preset ? getPresetSliceOptions(preset) : {};
    const entityTypes =
      entityTypesRaw.length > 0
        ? entityTypesRaw.filter((t) => allEntityTypes.has(t)) as typeof presetOptions.entityTypes
        : presetOptions.entityTypes;
    const relationTypes =
      relationTypesRaw.length > 0
        ? relationTypesRaw.filter((t) => allRelationTypes.has(t as any)) as typeof presetOptions.relationTypes
        : presetOptions.relationTypes;

    const byMonth = month ? sliceCanonicalGraphByMonthLabel(graph, month) : graph;
    const sliced = sliceCanonicalGraph(byMonth, { entityTypes, relationTypes });
    const sub = (() => {
      if (!onlyWithSources) return sliced;
      const idsWithSources = new Set(
        sliced.entities
          .filter((e) => listSourceCitationsForEntity(sliced, e.id).length > 0)
          .map((e) => e.id)
      );
      const entities = sliced.entities.filter((e) => idsWithSources.has(e.id));
      const entityIdSet = new Set(entities.map((e) => e.id));
      const relations = sliced.relations.filter(
        (r) => entityIdSet.has(r.source) && entityIdSet.has(r.target)
      );
      return { entities, relations };
    })();
    const meta = getFolkloreGraphMeta();
    res.json({
      version: 1,
      meta,
      preset: preset ?? null,
      applied: {
        month: month || null,
        entityTypes: entityTypes ?? null,
        relationTypes: relationTypes ?? null,
        onlyWithSources,
      },
      entities: sub.entities,
      relations: sub.relations,
    });
  } catch (e) {
    console.error('Folklore graph subgraph GET error:', e);
    res.status(500).json({ error: '读取图谱子图失败' });
  }
});

// ---------- 《清嘉录》原文（sections.json）----------
// GET /api/qjl/months — 有原文的月份列表
router.get('/qjl/months', (_req, res) => {
  try {
    res.json({ months: getAvailableMonths() });
  } catch (e) {
    console.error('QJL months error:', e);
    res.status(500).json({ error: '读取原文索引失败' });
  }
});

// GET /api/qjl/sections?month=正月 — 该月小节目录（无正文）
router.get('/qjl/sections', (req, res) => {
  try {
    const month = typeof req.query.month === 'string' ? req.query.month.trim() : '';
    if (!month) return res.status(400).json({ error: '请提供 query 参数 month' });
    const sections = getSectionSummariesByMonth(month);
    res.json({ month, count: sections.length, sections });
  } catch (e) {
    console.error('QJL sections list error:', e);
    res.status(500).json({ error: '读取小节列表失败' });
  }
});

/** 为搜索列表生成短引文（保留原文位置，便于用户辨认） */
function qjlSearchSnippet(section: { title: string; content: string }, needleLower: string): string {
  const full = `${section.title}\n${section.content}`;
  const low = full.toLowerCase();
  const idx = low.indexOf(needleLower);
  if (idx < 0) {
    const t = section.title.replace(/\s+/g, ' ').trim();
    return t.length > 96 ? `${t.slice(0, 96)}…` : t;
  }
  const start = Math.max(0, idx - 32);
  const end = Math.min(full.length, idx + needleLower.length + 80);
  let s = full.slice(start, end).replace(/\s+/g, ' ');
  if (start > 0) s = `…${s.trimStart()}`;
  if (end < full.length) s = `${s.trimEnd()}…`;
  return s.trim();
}

// GET /api/qjl/search-months?q=闹元宵 — 按关键词反查月份 + 命中小节列表（时令页展示）
router.get('/qjl/search-months', (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      return res.json({
        query: '',
        months: [] as { month: string; count: number }[],
        hits: [] as { id: string; month: string; title: string; snippet: string }[],
        totalMatches: 0,
      });
    }
    const key = q.toLowerCase();
    const byMonth = new Map<string, number>();
    const hits: { id: string; month: string; title: string; snippet: string }[] = [];
    const maxHits = 60;
    let totalMatches = 0;

    for (const s of getAllSections()) {
      const month = (s.month || '').trim();
      if (!month) continue;
      const haystack = `${s.title}\n${s.content}`.toLowerCase();
      if (!haystack.includes(key)) continue;
      byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
      totalMatches += 1;
      if (hits.length < maxHits) {
        hits.push({
          id: s.id,
          month,
          title: s.title,
          snippet: qjlSearchSnippet(s, key),
        });
      }
    }
    const months = Array.from(byMonth.entries())
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => b.count - a.count);
    res.json({ query: q, months, hits, totalMatches });
  } catch (e) {
    console.error('QJL search months error:', e);
    res.status(500).json({ error: '搜索月份失败' });
  }
});

// GET /api/qjl/ground-topic?q=… — 判断用户描述是否在《清嘉录》原文中有民俗依据（绘本生成前校验）
router.get('/qjl/ground-topic', (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      return res.status(400).json({ error: '请提供 query 参数 q' });
    }
    const soft = searchSectionsSoft(q, 8);
    if (soft.length > 0) {
      return res.json({
        grounded: true,
        mode: 'soft',
        matchCount: soft.length,
      });
    }
    const key = q.toLowerCase();
    let literalHits = 0;
    for (const s of getAllSections()) {
      const hay = `${s.title}\n${s.content}`.toLowerCase();
      if (hay.includes(key)) literalHits += 1;
    }
    if (literalHits > 0) {
      return res.json({
        grounded: true,
        mode: 'literal',
        matchCount: literalHits,
      });
    }
    return res.json({
      grounded: false,
      mode: 'none',
      matchCount: 0,
      message:
        '未在《清嘉录》原文中找到与这句描述相关的民俗内容。请围绕苏州传统节令、庙会、饮食、游艺等改写，或先用更具体的习俗名（如「轧神仙」「荷花生日」）再试。',
    });
  } catch (e) {
    console.error('QJL ground-topic error:', e);
    res.status(500).json({ error: '原文校验失败' });
  }
});

// GET /api/qjl/sections/:id — 单条全文
router.get('/qjl/sections/:id', (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id || '');
    const section = getSectionById(id);
    if (!section) return res.status(404).json({ error: '未找到该小节' });
    res.json(section);
  } catch (e) {
    console.error('QJL section get error:', e);
    res.status(500).json({ error: '读取小节失败' });
  }
});

// GET /api/qjl/sections/:id/translation — 原文白话翻译（带缓存）
router.get('/qjl/sections/:id/translation', async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: '请提供有效 section id' });
    const section = getSectionById(id);
    if (!section) return res.status(404).json({ error: '未找到该小节' });

    const content = (section.content || '').trim();
    if (!content) return res.status(400).json({ error: '该小节正文为空，无法翻译' });

    const sourceKey = createHash('sha256')
      .update(`${section.id}\n${section.title}\n${content}`)
      .digest('hex')
      .slice(0, 32);

    const cached = await getQjlTranslationCache(section.id, sourceKey);
    if (cached?.translation?.trim()) {
      return res.json({
        sectionId: section.id,
        sourceKey,
        cached: true,
        translation: cached.translation,
      });
    }

    const apiKey = requireDashScope();
    const { modelText, urlText } = getLlmModels();
    if (!urlText) return res.status(400).json({ error: '请先在「大模型配置」→ 文本模型中填写 URL' });
    if (!modelText) return res.status(400).json({ error: '请先在「大模型配置」→ 文本模型中填写模型名称' });

    const maxChars = 12000;
    const body =
      content.length > maxChars
        ? content.slice(0, maxChars) + '\n\n（以下略，原文较长已截断）'
        : content;

    const messages: { role: 'system' | 'user'; content: string }[] = [
      {
        role: 'system',
        content:
          '你是《清嘉录》古文白话翻译助手。请忠实、通顺地将用户提供的小节译为现代汉语白话，不添加原文没有的信息。',
      },
      {
        role: 'user',
        content: [
          '请将下列《清嘉录》原文译为白话。要求：',
          '1. 保留人名、地名、书名；',
          '2. 不删减信息，适当分段；',
          '3. 「案：」可译作「按：」并与正文分段；',
          '4. 仅输出白话译文，不要重复粘贴原文。',
          '',
          `【篇目】${section.title || '本篇'}`,
          '',
          body,
        ].join('\n'),
      },
    ];

    const translation = await dashscopeChat(apiKey, messages, modelText, urlText);
    const finalText = (translation || '').trim() || '（未返回内容）';
    await saveQjlTranslationCache(section.id, sourceKey, finalText);

    res.json({
      sectionId: section.id,
      sourceKey,
      cached: false,
      translation: finalText,
    });
  } catch (e) {
    console.error('QJL translation error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : '白话翻译失败' });
  }
});

// POST /api/picture-book/generate — 根据用户一句话生成绘本（服务端组装《清嘉录》参考，防漂移）
router.post('/picture-book/generate', async (req, res) => {
  try {
    const { topic, generateImage, source } = req.body ?? {};
    if (!topic || typeof topic !== 'string') {
      return res.status(400).json({ error: '请提供 topic 字段' });
    }
    const topicTrim = topic.trim();
    let folkloreContext: string | undefined;

    const src = source as { type?: string; month?: string; customName?: string; sectionId?: string } | undefined;
    if (src?.type === 'card' && typeof src.month === 'string' && typeof src.customName === 'string') {
      const month = src.month.trim();
      const customName = src.customName.trim();
      let section: QingJiaLuSection | null = null;
      const sid = typeof src.sectionId === 'string' ? src.sectionId.trim() : '';
      if (sid) {
        const byId = getSectionById(sid);
        if (byId && (byId.month || '').trim() === month) {
          section = byId;
        }
      }
      if (!section) {
        section = findSectionForMonthCustom(month, customName);
      }
      if (!section) {
        return res.status(400).json({
          error: `未在《清嘉录》「${month}」的原文小节中定位到「${customName}」。请刷新时令卡片或改用灵感输入。`,
        });
      }
      folkloreContext = formatQjlSectionsForPictureBookPrompt([section], 'single_card');
    } else {
      if (!isTopicGroundedInQjl(topicTrim)) {
        return res.status(400).json({
          error:
            '未在《清嘉录》原文中找到与该描述相关的民俗内容。请改写为书中可能出现的节令、习俗名或更具体的苏州民俗后再试。',
        });
      }
      const sections = collectSectionsForPictureBookTopic(topicTrim, 6);
      if (!sections.length) {
        return res.status(400).json({ error: '无法在原文中聚合到可用的参考条目，请改写关键词后重试。' });
      }
      folkloreContext = formatQjlSectionsForPictureBookPrompt(sections, 'multi_inspiration');
    }

    const book = await generatePictureBook({
      topic: topicTrim,
      generateImage: generateImage !== false,
      folkloreContext,
    });
    res.json(book);
  } catch (e) {
    console.error('Picture book generate error:', e);
    res.status(500).json({
      error: e instanceof Error ? e.message : '绘本生成失败，请稍后再试。',
    });
  }
});

// POST /api/picture-book/tts — 绘本页语音合成（使用配置的 TTS，如 DashScope 千问 TTS）
router.post('/picture-book/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: '请提供 text 字段' });
    }
    const { urlTts, modelTts, voiceTts, apiKeyTts } = getLlmModels();
    if (!urlTts || !apiKeyTts) {
      return res.status(400).json({ error: '请先在「大模型配置」→ 语音模型中配置 URL 和 API Key' });
    }
    const defaultInstructions = '请用温柔、富有感情的语调朗读，语速适中，适合给儿童讲绘本。';
    const result = await generatePictureBookSpeech(text.trim(), {
      url: urlTts,
      model: modelTts,
      apiKey: apiKeyTts,
      instructions: voiceTts?.trim() || defaultInstructions,
    });
    if (!result) {
      return res.status(500).json({ error: '语音合成失败，请检查 TTS 配置或稍后再试' });
    }
    res.json({ audioBase64: result.audioBase64, mimeType: result.mimeType });
  } catch (e) {
    console.error('Picture book TTS error:', e);
    res.status(500).json({
      error: e instanceof Error ? e.message : '语音合成失败',
    });
  }
});

/** 单页插图重生成（在 server/index.ts 顶层也会注册，避免子路由未命中时出现 404） */
export async function handleRegeneratePictureBookPageImage(req: import('express').Request, res: import('express').Response) {
  try {
    const { topic, text, imagePrompt } = req.body || {};
    if (!topic || typeof topic !== 'string' || !text || typeof text !== 'string') {
      return res.status(400).json({ error: '请提供 topic、text' });
    }
    const imageBase64 = await generatePictureBookPageImage({
      topic: topic.trim(),
      text: text.trim(),
      imagePrompt: typeof imagePrompt === 'string' ? imagePrompt : undefined,
    });
    res.json({ imageBase64 });
  } catch (e) {
    console.error('Picture book regenerate page image error:', e);
    res.status(500).json({
      error: e instanceof Error ? e.message : '插图生成失败',
    });
  }
}

router.post('/picture-book/regenerate-page-image', handleRegeneratePictureBookPageImage);
router.post('/picture-book/page-image', handleRegeneratePictureBookPageImage);

// POST /api/picture-book/export-mp4 — 导出绘本为 MP4（自动翻页 + 自动朗读）
router.post('/picture-book/export-mp4', async (req, res) => {
  try {
    const { title, pages } = req.body || {};
    if (!title || typeof title !== 'string' || !Array.isArray(pages)) {
      return res.status(400).json({ error: '请提供 title、pages' });
    }
    const result = await exportPictureBookMp4({
      title: title.trim(),
      pages,
      width: 1080,
      height: 1920,
      fallbackSeconds: 6,
    });
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`);
    res.setHeader('Content-Length', String(result.videoBuffer.length));
    res.send(result.videoBuffer);
  } catch (e) {
    console.error('Picture book export mp4 error:', e);
    res.status(500).json({
      error: e instanceof Error ? e.message : '导出 MP4 失败',
    });
  }
});

// GET /api/picture-book — 绘本列表
router.get('/picture-book', async (_req, res) => {
  try {
    const list = await listPictureBooks();
    res.json(list);
  } catch (e) {
    console.error('List picture books error:', e);
    res.status(500).json({ error: '获取列表失败' });
  }
});

// GET /api/picture-book/:id — 单本绘本详情
router.get('/picture-book/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: '无效的 id' });
    const book = await getPictureBook(id);
    if (!book) return res.status(404).json({ error: '绘本不存在' });
    res.json(book);
  } catch (e) {
    console.error('Get picture book error:', e);
    res.status(500).json({ error: '获取绘本失败' });
  }
});

// PATCH /api/picture-book/:id — 更新绘本页数据（如补全插图）
router.patch('/picture-book/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: '无效的 id' });
    const { pages } = req.body || {};
    if (!Array.isArray(pages)) {
      return res.status(400).json({ error: '请提供 pages 数组' });
    }
    await updatePictureBookPages(id, pages);
    res.json({ ok: true });
  } catch (e) {
    console.error('Update picture book error:', e);
    res.status(500).json({
      error: e instanceof Error ? e.message : '更新失败',
    });
  }
});

// POST /api/picture-book — 保存绘本
router.post('/picture-book', async (req, res) => {
  try {
    const { title, topic, pages } = req.body;
    if (!title || !topic || !Array.isArray(pages)) {
      return res.status(400).json({ error: '请提供 title、topic、pages' });
    }
    const id = await savePictureBook({ title, topic, pages });
    res.json({ id, message: '保存成功' });
  } catch (e) {
    console.error('Save picture book error:', e);
    res.status(500).json({ error: '保存失败' });
  }
});

// DELETE /api/picture-book/:id — 删除绘本
router.delete('/picture-book/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: '无效的 id' });
    }
    await deletePictureBook(id);
    res.json({ ok: true });
  } catch (e) {
    console.error('Delete picture book error:', e);
    res.status(500).json({ error: '删除失败' });
  }
});

// ---------- 解析会话（类似 ChatGPT 会话列表）----------
router.get('/chat/sessions', async (_req, res) => {
  try {
    const rows = await listChatSessions();
    const sessions = rows.map((r) => ({
      id: r.id,
      title: r.title,
      messages: JSON.parse(r.messagesJson || '[]'),
      feedback: JSON.parse(r.feedbackJson || '{}'),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
    res.json({ sessions });
  } catch (e) {
    console.error('List chat sessions error:', e);
    res.status(500).json({ error: '读取会话失败' });
  }
});

router.post('/chat/sessions/create', async (_req, res) => {
  try {
    const id = `chat-${randomUUID()}`;
    await createChatSession({
      id,
      title: '新对话',
      messagesJson: '[]',
      feedbackJson: '{}',
    });
    const row = await getChatSessionById(id);
    if (!row) return res.status(500).json({ error: '创建会话失败' });
    res.json({
      session: {
        id: row.id,
        title: row.title,
        messages: JSON.parse(row.messagesJson || '[]'),
        feedback: JSON.parse(row.feedbackJson || '{}'),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    });
  } catch (e) {
    console.error('Create chat session error:', e);
    res.status(500).json({ error: '创建会话失败' });
  }
});

router.post('/chat/sessions/:id/messages', async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id || '').trim();
    const { role, content } = req.body || {};
    if (!id) return res.status(400).json({ error: '无效的会话 id' });
    if (role !== 'user' && role !== 'assistant') {
      return res.status(400).json({ error: 'role 仅支持 user 或 assistant' });
    }
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: '请提供 content 字段' });
    }

    const row = await getChatSessionById(id);
    if (!row) return res.status(404).json({ error: '会话不存在' });
    const messages = JSON.parse(row.messagesJson || '[]');
    const nextMessages = [...(Array.isArray(messages) ? messages : []), { role, content }];
    await upsertChatSession({
      id,
      title: row.title || '新对话',
      messagesJson: JSON.stringify(nextMessages),
      feedbackJson: row.feedbackJson || '{}',
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('Append chat message error:', e);
    res.status(500).json({ error: '追加消息失败' });
  }
});

router.post('/chat/sessions', async (req, res) => {
  try {
    const { id, title, messages, feedback } = req.body || {};
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: '请提供 id 字段' });
    }
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: '请提供 title 字段' });
    }
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: '请提供 messages 数组' });
    }
    await upsertChatSession({
      id: id.trim(),
      title: title.trim() || '新对话',
      messagesJson: JSON.stringify(messages),
      feedbackJson: JSON.stringify(feedback && typeof feedback === 'object' ? feedback : {}),
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('Upsert chat session error:', e);
    res.status(500).json({ error: '保存会话失败' });
  }
});

router.delete('/chat/sessions/:id', async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: '无效的 id' });
    await deleteChatSessionById(id);
    res.json({ ok: true });
  } catch (e) {
    console.error('Delete chat session error:', e);
    res.status(500).json({ error: '删除会话失败' });
  }
});

// ---------- 大模型配置（脱敏返回，Key 仅存于服务端 DB）----------

// GET /api/config/llm — 获取配置（API Key 脱敏，仅 admin）
router.get('/config/llm', (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin']);
    if (!auth) return;
    const config = getLlmConfigForDisplay();
    res.json(config);
  } catch (e) {
    console.error('Get LLM config error:', e);
    res.status(500).json({ error: '获取配置失败' });
  }
});

// 以下“更具体”路径必须写在 POST /config/llm 之前，否则可能被误匹配
// GET /api/config/llm/testimage — 调试用
router.get('/config/llm/testimage', (_req, res) => {
  res.json({ ok: true, message: 'image test endpoint, use POST to test' });
});
// POST /api/config/llm/testimage — 图像大模型连接测试
router.post('/config/llm/testimage', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin']);
    if (!auth) return;
    const { apiKey, modelImage: bodyModel, url: bodyUrl } = req.body || {};
    const keyToTest = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : getDashScopeApiKeyImage();
    if (!keyToTest) {
      return res.status(400).json({ ok: false, error: '请先填写 API Key 或保存后再测试' });
    }
    const cfg = getLlmConfig();
    const models = getLlmModels();
    const model = (typeof bodyModel === 'string' && bodyModel.trim()) ? bodyModel.trim() : (models.modelImage || (cfg?.model_image ?? ''));
    const imageApiUrl = (typeof bodyUrl === 'string' && bodyUrl.trim()) ? bodyUrl.trim() : (cfg?.url_image?.trim() || models.urlImage || '');
    if (!imageApiUrl) return res.status(400).json({ ok: false, error: '请先配置图像模型的 URL' });
    if (!model) return res.status(400).json({ ok: false, error: '请先配置图像模型名称' });
    await dashscopeTextToImage(keyToTest, '一只小猫', { size: '1024*1024', n: 1, model, imageApiUrl });
    res.json({ ok: true, message: '连接成功' });
  } catch (e) {
    console.error('LLM image test error:', e);
    res.status(200).json({
      ok: false,
      error: e instanceof Error ? e.message : '连接失败',
    });
  }
});
// POST /api/config/llm/testtts — 语音模型（TTS）连接测试（通过 instructions 控制朗读风格）
router.post('/config/llm/testtts', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin']);
    if (!auth) return;
    const { apiKey, modelTts: bodyModel, url: bodyUrl, voice: bodyVoice } = req.body || {};
    const keyToTest = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : getDashScopeApiKeyTts();
    if (!keyToTest) {
      return res.status(400).json({ ok: false, error: '请先填写 API Key 或保存后再测试' });
    }
    const cfg = getLlmConfig();
    const models = getLlmModels();
    const urlTts = (typeof bodyUrl === 'string' && bodyUrl.trim()) ? bodyUrl.trim() : (cfg?.url_tts?.trim() || models.urlTts || '');
    const modelTts = (typeof bodyModel === 'string' && bodyModel.trim()) ? bodyModel.trim() : (models.modelTts || (cfg?.model_tts ?? ''));
    const voiceTts = (typeof bodyVoice === 'string' && bodyVoice.trim()) ? bodyVoice.trim() : (models.voiceTts || cfg?.voice_tts?.trim() || '');
    if (!urlTts) return res.status(400).json({ ok: false, error: '请先配置语音模型的 URL' });
    const defaultInstructions = '请用温柔、富有感情的语调朗读，语速适中，适合给儿童讲绘本。';
    const result = await generatePictureBookSpeech('测试', {
      url: urlTts,
      model: modelTts || 'qwen3-tts-instruct-flash',
      apiKey: keyToTest,
      instructions: voiceTts || defaultInstructions,
    });
    if (result) {
      return res.json({ ok: true, message: '连接成功' });
    }
    res.status(200).json({ ok: false, error: '语音合成无返回，请检查模型与音色' });
  } catch (e) {
    console.error('LLM TTS test error:', e);
    res.status(200).json({
      ok: false,
      error: e instanceof Error ? e.message : '连接失败',
    });
  }
});
// POST /api/config/llm/test — 文本大模型连接测试
router.post('/config/llm/test', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin']);
    if (!auth) return;
    const { apiKey, modelText: bodyModel, url: bodyUrl } = req.body || {};
    const keyToTest = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : getDashScopeApiKeyText();
    if (!keyToTest) {
      return res.status(400).json({ ok: false, error: '请先填写 API Key 或保存后再测试' });
    }
    const models = getLlmModels();
    const model = (typeof bodyModel === 'string' && bodyModel.trim()) ? bodyModel.trim() : (models.modelText || '');
    const urlText = (typeof bodyUrl === 'string' && bodyUrl.trim()) ? bodyUrl.trim() : (models.urlText || '');
    if (!urlText) return res.status(400).json({ ok: false, error: '请先配置文本模型的 URL' });
    if (!model) return res.status(400).json({ ok: false, error: '请先配置文本模型名称' });
    const reply = await dashscopeChat(keyToTest, [{ role: 'user', content: 'Hi' }], model, urlText);
    res.json({ ok: true, message: '连接成功' });
  } catch (e) {
    console.error('LLM test error:', e);
    res.status(200).json({
      ok: false,
      error: e instanceof Error ? e.message : '连接失败',
    });
  }
});

// POST /api/config/llm — 保存配置（text/image/tts 各含 provider, model, url, apiKey；留空不修改；仅 admin）
router.post('/config/llm', async (req, res) => {
  try {
    const auth = requireRole(req, res, ['admin']);
    if (!auth) return;
    const body = req.body || {};
    const text = body.text;
    const image = body.image;
    const tts = body.tts;
    await saveLlmConfig({
      text: text && typeof text === 'object' ? {
        provider: typeof text.provider === 'string' ? text.provider : undefined,
        model: typeof text.model === 'string' ? text.model : undefined,
        url: typeof text.url === 'string' ? text.url : undefined,
        apiKey: text.apiKey !== undefined ? (text.apiKey === '' ? null : text.apiKey) : undefined,
      } : undefined,
      image: image && typeof image === 'object' ? {
        provider: typeof image.provider === 'string' ? image.provider : undefined,
        model: typeof image.model === 'string' ? image.model : undefined,
        url: typeof image.url === 'string' ? image.url : undefined,
        apiKey: image.apiKey !== undefined ? (image.apiKey === '' ? null : image.apiKey) : undefined,
      } : undefined,
      tts: tts && typeof tts === 'object' ? {
        provider: typeof tts.provider === 'string' ? tts.provider : undefined,
        model: typeof tts.model === 'string' ? tts.model : undefined,
        url: typeof tts.url === 'string' ? tts.url : undefined,
        apiKey: tts.apiKey !== undefined ? (tts.apiKey === '' ? null : tts.apiKey) : undefined,
        voice: tts.voice !== undefined ? (tts.voice === '' ? null : tts.voice) : undefined,
      } : undefined,
      apiKey: body.apiKey !== undefined ? (body.apiKey === '' ? null : body.apiKey) : undefined,
      modelText: typeof body.modelText === 'string' ? body.modelText : undefined,
      modelImage: typeof body.modelImage === 'string' ? body.modelImage : undefined,
    });
    res.json({ message: '保存成功' });
  } catch (e) {
    console.error('Save LLM config error:', e);
    res.status(500).json({ error: '保存失败' });
  }
});

/** 供 server/index.ts 顶层注册的路由做与 router 内一致的鉴权 */
export function requireApiUser(req: Request, res: Response): AuthPayload | null {
  return requireRole(req, res, ['admin', 'editor', 'viewer']);
}

export function requireApiAdmin(req: Request, res: Response): AuthPayload | null {
  return requireRole(req, res, ['admin']);
}

export default router;
