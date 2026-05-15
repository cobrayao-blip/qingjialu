import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Book, MapPin, MessageSquare, BarChart3, ChevronRight, Sparkles, Loader2, Volume2, Square, BookOpen, X, Copy, RotateCcw, ThumbsUp, ThumbsDown, Share2, Plus, Trash2, Pencil, Search } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  analyzeFolklore,
  getStructuredMonthData,
  listQingJiaLuSections,
  searchQingJiaLuMonths,
  getQingJiaLuSection,
  getQingJiaLuSectionTranslation,
  listGeoPlaces,
  getGeoMonthData,
  aggregateGeoByName,
  getGeoGlossary,
  createChatSessionApi,
  appendChatSessionMessageApi,
  listChatSessionsApi,
  saveChatSessionApi,
  deleteChatSessionApi,
  type MonthData,
  type MonthCustom,
  type MonthDataMeta,
  type GeoPlace,
  type GeoGlossaryEntry,
  type GeoChatContextPayload,
  type QjlSearchMonthHit,
  type PictureBookGenerateSource,
} from './services/api';
import { MONTHS, INITIAL_HIGHLIGHTS } from './constants';

import FolkloreGraph from './components/FolkloreGraph';
import ResearchWorkbench from './components/ResearchWorkbench';
import PictureBookView from './components/PictureBookView';
import AdminApp from './components/AdminApp';
import { UserLoginForm } from './components/UserLoginForm';
import { useAdminController } from './hooks/useAdminController';
import { useMediaQuery } from './hooks/useMediaQuery';
import { authFetchHeaders } from './services/api';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normCompact(s: string) {
  return s.replace(/\s+/g, '');
}

function normTitleForMatch(s: string) {
  return (s || '').replace(/[《》〈〉「」『』\s：:·•]/g, '').trim();
}

function extractJuanFromSectionId(sectionId?: string) {
  if (!sectionId) return '';
  const m = sectionId.match(/^(卷[一二三四五六七八九十百零〇0-9]+)/);
  return m?.[1] || '';
}

function glossaryMatchesForPlace(place: GeoPlace, entries: GeoGlossaryEntry[]) {
  return entries.filter((e) => {
    if (normCompact(place.name).includes(normCompact(e.term))) return true;
    if (place.aliases?.some((a) => normCompact(a).includes(normCompact(e.term)))) return true;
    for (const al of e.aliases || []) {
      if (normCompact(place.name).includes(normCompact(al))) return true;
      if (place.aliases?.some((a) => normCompact(a).includes(normCompact(al)))) return true;
    }
    return false;
  });
}

function formatGeoCitationLine(place: GeoPlace, cite: { chapterTitle: string; quoteText: string; sectionId: string }) {
  return `顾禄：《清嘉录》${cite.chapterTitle}：「${cite.quoteText}」（小节 id：${cite.sectionId}；地名列：${place.name}）`;
}

function formatAllGeoCitations(place: GeoPlace) {
  return (place.citations || []).map((c) => formatGeoCitationLine(place, c)).join('\n\n');
}

async function copyTextToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    window.prompt('请手动复制：', text);
  }
}

function highlightHtml(content: string, needle?: string | null) {
  const n = needle?.trim();
  if (!n) return escapeHtml(content);
  const safeContent = escapeHtml(content);
  const safeNeedle = escapeHtml(n);
  if (!safeNeedle) return safeContent;
  const parts = safeContent.split(safeNeedle);
  if (parts.length === 1) return safeContent;
  return parts.join(`<mark class="bg-amber-200/80 text-ink rounded px-0.5">${safeNeedle}</mark>`);
}

const QJL_SECTION_PARAM = 'qjlSection';
const QJL_HIGHLIGHT_PARAM = 'qjlHighlight';
const GRAPH_MODE_PARAM = 'graphMode';
/** 避免引文过长撑爆 URL（仍可在正文内完整高亮，仅当次打开时内存中有全文） */
const MAX_QJL_HIGHLIGHT_URL = 800;

type MainTab = 'explorer' | 'chat' | 'graph' | 'geo' | 'book';
type GraphMode = 'explore' | 'workbench';

function readInitialTabFromUrl(): MainTab {
  try {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'workbench') return 'graph'; // 兼容旧链接
    if (t === 'explorer' || t === 'chat' || t === 'graph' || t === 'geo' || t === 'book') return t;
  } catch {
    /* ignore */
  }
  return 'explorer';
}

function readInitialGraphModeFromUrl(): GraphMode {
  try {
    const p = new URLSearchParams(window.location.search);
    const tab = p.get('tab')?.trim();
    if (tab === 'workbench') return 'workbench'; // 兼容旧链接
    const gm = p.get(GRAPH_MODE_PARAM)?.trim();
    if (gm === 'workbench' || gm === 'explore') return gm;
  } catch {
    /* ignore */
  }
  return 'explore';
}

function readInitialMonthFromUrl(): string {
  try {
    const m = new URLSearchParams(window.location.search).get('geoMonth')?.trim();
    if (m) return m;
  } catch {
    /* ignore */
  }
  return '正月';
}

function parseQjlParams(search: string): { sectionId: string | null; highlight: string | null } {
  const params = new URLSearchParams(search);
  const sectionId = params.get(QJL_SECTION_PARAM)?.trim() || null;
  const highlightRaw = params.get(QJL_HIGHLIGHT_PARAM)?.trim();
  const highlight = highlightRaw || null;
  return { sectionId, highlight };
}

/** 写入/清除原文相关 query（replaceState，不新增历史栈条目） */
function syncQjlUrl(sectionId: string | null, highlight: string | null) {
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete(QJL_SECTION_PARAM);
    u.searchParams.delete(QJL_HIGHLIGHT_PARAM);
    if (sectionId?.trim()) {
      u.searchParams.set(QJL_SECTION_PARAM, sectionId.trim());
      if (highlight?.trim()) {
        let h = highlight.trim();
        if (h.length > MAX_QJL_HIGHLIGHT_URL) h = h.slice(0, MAX_QJL_HIGHLIGHT_URL);
        u.searchParams.set(QJL_HIGHLIGHT_PARAM, h);
      }
    }
    window.history.replaceState(null, '', u.toString());
  } catch {
    /* ignore */
  }
}

export default function App() {
  type ChatMessage = { role: 'user' | 'assistant'; content: string };
  type ChatSession = {
    id: string;
    title: string;
    messages: ChatMessage[];
    feedback?: Record<number, 'up' | 'down'>;
    createdAt: string;
    updatedAt: string;
  };
  const CHAT_STORAGE_KEY = 'qingjialu.chat.sessions.v1';

  const isAdminRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');
  const [activeTab, setActiveTab] = useState<MainTab>(readInitialTabFromUrl);
  const [graphMode, setGraphMode] = useState<GraphMode>(readInitialGraphModeFromUrl);
  const [graphMonth, setGraphMonth] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(readInitialMonthFromUrl);
  /** 优先由 API 按原文抽取；仅失败时用 INITIAL_HIGHLIGHTS 兜底 */
  const [monthData, setMonthData] = useState<MonthData | null>(null);
  /** 当前月份摘要是否基于本地《清嘉录》原文 */
  const [monthSourceMeta, setMonthSourceMeta] = useState<MonthDataMeta | null>(null);
  /** 当前月份小节目录（来自 sections.json） */
  const [qjlSectionList, setQjlSectionList] = useState<{ id: string; title: string }[]>([]);
  const [explorerSearchQuery, setExplorerSearchQuery] = useState('');
  const [explorerSearchMonthSet, setExplorerSearchMonthSet] = useState<Set<string> | null>(null);
  const [explorerSearchHits, setExplorerSearchHits] = useState<QjlSearchMonthHit[]>([]);
  const [explorerSearchTotalMatches, setExplorerSearchTotalMatches] = useState(0);
  const [explorerSearching, setExplorerSearching] = useState(false);
  const [qjlSectionMonth, setQjlSectionMonth] = useState<string | null>(null);
  const [qjlDrawerOpen, setQjlDrawerOpen] = useState(false);
  const [qjlSectionId, setQjlSectionId] = useState<string | null>(null);
  const [qjlSectionContent, setQjlSectionContent] = useState<{ title: string; content: string } | null>(null);
  const [qjlHighlightQuote, setQjlHighlightQuote] = useState<string | null>(null);
  const [qjlSectionLoading, setQjlSectionLoading] = useState(false);
  /** 原文抽屉内白话翻译结果 */
  const [qjlTranslation, setQjlTranslation] = useState<string | null>(null);
  /** 白话译文是否命中服务端缓存（null=未知/未翻译） */
  const [qjlTranslationCached, setQjlTranslationCached] = useState<boolean | null>(null);
  /** 白话译文是否当前展开（避免收起后内容丢失） */
  const [qjlTranslationVisible, setQjlTranslationVisible] = useState(false);
  const [qjlTranslating, setQjlTranslating] = useState(false);
  const [qjlTranslationError, setQjlTranslationError] = useState<string | null>(null);
  /** 从习俗卡片带入的绘本主题 */
  const [bookInitialTopic, setBookInitialTopic] = useState<string | undefined>(undefined);
  /** 从习俗卡片进入绘本时的原文锚定信息 */
  const [bookCardSource, setBookCardSource] = useState<PictureBookGenerateSource | undefined>(undefined);
  /** 切换顶栏「绘本」时递增，用于重置绘本页内部表单 */
  const [bookViewKey, setBookViewKey] = useState(0);
  const [loading, setLoading] = useState(false);
  /** 是否为「重新生成卡片」触发的加载（文案区分） */
  const [monthDataRefreshing, setMonthDataRefreshing] = useState(false);
  const [geoPlaces, setGeoPlaces] = useState<GeoPlace[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoStaleHint, setGeoStaleHint] = useState<string | null>(null);
  const [geoSearchInput, setGeoSearchInput] = useState('');
  const [geoCustomFilter, setGeoCustomFilter] = useState<string | null>(null);
  /** 习俗卡片是否展开全部（默认只展示前若干条，避免页面过长） */
  const [showAllCustoms, setShowAllCustoms] = useState(false);
  const [chatQuery, setChatQuery] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
  const [chatBootstrapped, setChatBootstrapped] = useState(false);
  const [chatSessionSearch, setChatSessionSearch] = useState('');
  /** 下一次发送解析时附带的地理 RAG 附文（仅传后端，聊天列表中仍只显示用户原句） */
  const [chatGeoContext, setChatGeoContext] = useState<GeoChatContextPayload | null>(null);
  const [geoGlossary, setGeoGlossary] = useState<GeoGlossaryEntry[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [speakingMsgIndex, setSpeakingMsgIndex] = useState<number | null>(null);
  const [ttsAudio, setTtsAudio] = useState<HTMLAudioElement | null>(null);
  const [chatFeedback, setChatFeedback] = useState<Record<number, 'up' | 'down'>>({});
  /** 小屏地理卡「原文依据」折叠，减轻拇指滑动距离 */
  const geoViewportNarrow = useMediaQuery('(max-width: 767px)');
  const [geoCiteExpanded, setGeoCiteExpanded] = useState<Record<string, boolean>>({});
  /** 解析 Tab：虚拟键盘占用高度（visualViewport 与布局视口差值） */
  const [chatComposerLift, setChatComposerLift] = useState(0);

  const admin = useAdminController({ isAdminRoute, selectedMonth });
  const siteReady =
    admin.authBootstrapDone && Boolean(admin.geoAdminToken.trim() && admin.adminRole);
  /** admin / editor 可进地理治理后台；viewer 仅浏览主站 */
  const showGeoAdminNav = admin.adminRole === 'admin' || admin.adminRole === 'editor';

  const markdownToPlainText = (input: string): string => {
    return input
      // fenced code blocks / inline code
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      // images / links
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // headings / blockquotes / list markers
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      // emphasis / hr
      .replace(/[*_~]/g, '')
      .replace(/^\s*---+\s*$/gm, ' ')
      // collapse whitespace
      .replace(/\n{2,}/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  };

  const normalizeForChineseSpeech = (input: string): string => {
    return input
      // URL 简化为“链接”，避免逐字符朗读
      .replace(/https?:\/\/\S+/gi, '链接')
      // 邮箱简化，避免“at dot”逐字符读法
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '邮箱')
      // 常见英文缩写做口语化替换
      .replace(/\bAI\b/g, '人工智能')
      .replace(/\bAPI\b/g, '接口')
      .replace(/\bLLM\b/g, '大语言模型')
      .replace(/\bTTS\b/g, '语音合成')
      .replace(/\bSQL\b/g, '数据库查询')
      // 去掉可能打断语音节奏的成对括号内容（通常是补充说明）
      .replace(/（[^）]{1,40}）/g, ' ')
      .replace(/\([^)]{1,40}\)/g, ' ')
      // 清理冗余标点和空白
      .replace(/[|]+/g, '，')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{2,}/g, '\n')
      .trim();
  };

  const speakWithBrowserTts = (text: string, index: number) => {
    const plainText = normalizeForChineseSpeech(markdownToPlainText(text));
    if (!plainText) return;
    // 先停掉 Edge TTS 播放
    if (ttsAudio) {
      ttsAudio.pause();
    }
    window.speechSynthesis.cancel();
    if (speakingMsgIndex === index) {
      setSpeakingMsgIndex(null);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(plainText);
    utterance.lang = 'zh-CN';
    utterance.onend = () => setSpeakingMsgIndex((current) => (current === index ? null : current));
    utterance.onerror = () => setSpeakingMsgIndex((current) => (current === index ? null : current));
    setSpeakingMsgIndex(index);
    window.speechSynthesis.speak(utterance);
  };

  const speak = async (text: string, index: number) => {
    const plainText = normalizeForChineseSpeech(markdownToPlainText(text));
    if (!plainText) return;
    // 再次点击同一条，停止播放
    if (speakingMsgIndex === index) {
      if (ttsAudio && !ttsAudio.paused) {
        ttsAudio.pause();
        ttsAudio.currentTime = 0;
      } else {
        window.speechSynthesis.cancel();
      }
      setSpeakingMsgIndex(null);
      return;
    }

    setSpeakingMsgIndex(index);

    try {
      // 先停止上一条音频/朗读
      if (ttsAudio) {
        ttsAudio.pause();
      }
      window.speechSynthesis.cancel();

      const res = await fetch('/api/tts/edge', {
        method: 'POST',
        headers: authFetchHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text: plainText }),
      });
      if (!res.ok) {
        throw new Error('TTS 请求失败');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      setTtsAudio(audio);
      audio.onended = () => {
        setSpeakingMsgIndex((current) => (current === index ? null : current));
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        speakWithBrowserTts(plainText, index);
      };
      await audio.play();
    } catch {
      // Edge TTS 失败时回退到浏览器内置 TTS
      speakWithBrowserTts(plainText, index);
    }
  };

  const buildSessionTitle = (messages: ChatMessage[], fallback = '新对话'): string => {
    const firstUser = messages.find((m) => m.role === 'user' && m.content.trim());
    if (!firstUser) return fallback;
    const text = firstUser.content.trim().replace(/\s+/g, ' ');
    return text.length > 20 ? `${text.slice(0, 20)}...` : text;
  };

  const sortSessionsByUpdatedAt = (sessions: ChatSession[]): ChatSession[] =>
    [...sessions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  const createEmptySession = (): ChatSession => {
    const now = new Date().toISOString();
    const id = `chat-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    return { id, title: '新对话', messages: [], feedback: {}, createdAt: now, updatedAt: now };
  };

  const switchChatSession = (id: string) => {
    const target = chatSessions.find((s) => s.id === id);
    if (!target) return;
    setActiveChatSessionId(id);
    setChatHistory(target.messages);
    setChatFeedback(target.feedback ?? {});
    setSpeakingMsgIndex(null);
  };

  const createNewChatSession = async () => {
    try {
      const { session } = await createChatSessionApi();
      const normalized = normalizeSession(session) || createEmptySession();
      setChatSessions((prev) => sortSessionsByUpdatedAt([normalized, ...prev.filter((s) => s.id !== normalized.id)]));
      setActiveChatSessionId(normalized.id);
      setChatHistory(normalized.messages);
      setChatQuery('');
      setChatFeedback(normalized.feedback ?? {});
      setSpeakingMsgIndex(null);
      return;
    } catch {
      // 服务端不可用时回退到本地创建
    }

    const session = createEmptySession();
    setChatSessions((prev) => sortSessionsByUpdatedAt([session, ...prev]));
    setActiveChatSessionId(session.id);
    setChatHistory([]);
    setChatQuery('');
    setChatFeedback(session.feedback ?? {});
    setSpeakingMsgIndex(null);
  };

  const deleteChatSession = (id: string) => {
    deleteChatSessionApi(id).catch(() => {
      // 网络失败时不阻塞本地删除
    });
    setChatSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) {
        const fresh = createEmptySession();
        setActiveChatSessionId(fresh.id);
        setChatHistory([]);
        setChatFeedback(fresh.feedback ?? {});
        return [fresh];
      }
      if (activeChatSessionId === id) {
        const fallback = next[0];
        setActiveChatSessionId(fallback.id);
        setChatHistory(fallback.messages);
        setChatFeedback(fallback.feedback ?? {});
      }
      return sortSessionsByUpdatedAt(next);
    });
  };

  const renameChatSession = (id: string) => {
    const target = chatSessions.find((s) => s.id === id);
    if (!target) return;
    const input = window.prompt('请输入新的会话名称：', target.title || '新对话');
    if (input == null) return;
    const title = input.trim() || '新对话';
    setChatSessions((prev) => prev.map((s) => (
      s.id === id ? { ...s, title, updatedAt: new Date().toISOString() } : s
    )));
  };

  const normalizeSession = (s: Partial<ChatSession>): ChatSession | null => {
    if (!s || typeof s.id !== 'string' || !s.id.trim()) return null;
    return {
      id: s.id,
      title: typeof s.title === 'string' && s.title.trim() ? s.title : '新对话',
      messages: Array.isArray(s.messages) ? s.messages : [],
      feedback: s.feedback && typeof s.feedback === 'object' ? s.feedback : {},
      createdAt: s.createdAt || new Date().toISOString(),
      updatedAt: s.updatedAt || new Date().toISOString(),
    };
  };

  const mergeSessionsByLatest = (localSessions: ChatSession[], serverSessions: ChatSession[]): ChatSession[] => {
    const merged = new Map<string, ChatSession>();
    for (const session of [...serverSessions, ...localSessions]) {
      const prev = merged.get(session.id);
      if (!prev || prev.updatedAt < session.updatedAt) {
        merged.set(session.id, session);
      }
    }
    return sortSessionsByUpdatedAt(Array.from(merged.values()));
  };

  useEffect(() => {
    if (!siteReady) return;
    let localSessions: ChatSession[] = [];
    try {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ChatSession>[];
        if (Array.isArray(parsed)) {
          localSessions = parsed
            .map((s) => normalizeSession(s))
            .filter((s): s is ChatSession => Boolean(s));
        }
      }
    } catch {
      // ignore corrupted local storage
    }

    listChatSessionsApi()
      .then(async (res) => {
        const serverSessionsRaw = Array.isArray(res?.sessions) ? (res.sessions as Partial<ChatSession>[]) : [];
        const serverSessions = serverSessionsRaw
          .map((s) => normalizeSession(s))
          .filter((s): s is ChatSession => Boolean(s));

        let merged = mergeSessionsByLatest(localSessions, serverSessions);
        if (merged.length === 0) {
          merged = [createEmptySession()];
        }

        // 启动即双向对齐：将合并结果回写服务端（失败不阻塞）
        await Promise.all(
          merged.map((s) =>
            saveChatSessionApi({
              id: s.id,
              title: s.title,
              messages: s.messages,
              feedback: s.feedback ?? {},
            }).catch(() => undefined)
          )
        );

        setChatSessions(merged);
        setActiveChatSessionId(merged[0].id);
        setChatHistory(merged[0].messages);
        setChatFeedback(merged[0].feedback ?? {});
      })
      .catch(() => {
        const fallback = localSessions.length > 0 ? sortSessionsByUpdatedAt(localSessions) : [createEmptySession()];
        setChatSessions(fallback);
        setActiveChatSessionId(fallback[0].id);
        setChatHistory(fallback[0].messages);
        setChatFeedback(fallback[0].feedback ?? {});
      })
      .finally(() => setChatBootstrapped(true));
  }, [siteReady]);

  useEffect(() => {
    if (!chatBootstrapped) return;
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatSessions));
    } catch {
      // ignore quota/storage errors
    }
  }, [chatSessions, chatBootstrapped]);

  useEffect(() => {
    if (!siteReady || !chatBootstrapped || !activeChatSessionId) return;
    const active = chatSessions.find((s) => s.id === activeChatSessionId);
    if (!active) return;
    const timer = window.setTimeout(() => {
      saveChatSessionApi({
        id: active.id,
        title: active.title || '新对话',
        messages: active.messages,
        feedback: active.feedback ?? {},
      }).catch(() => {
        // 网络失败时保留本地，稍后继续自动重试
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [chatSessions, activeChatSessionId, chatBootstrapped, siteReady]);

  useEffect(() => {
    if (!chatBootstrapped || !activeChatSessionId) return;
    setChatSessions((prev) => {
      const updated = prev.map((session) => {
        if (session.id !== activeChatSessionId) return session;
        return {
          ...session,
          messages: chatHistory,
          title: buildSessionTitle(chatHistory, session.title || '新对话'),
          updatedAt: new Date().toISOString(),
        };
      });
      return sortSessionsByUpdatedAt(updated);
    });
  }, [chatHistory, activeChatSessionId, chatBootstrapped]);

  useEffect(() => {
    if (!chatBootstrapped || !activeChatSessionId) return;
    setChatSessions((prev) => prev.map((session) => {
      if (session.id !== activeChatSessionId) return session;
      return { ...session, feedback: chatFeedback };
    }));
  }, [chatFeedback, activeChatSessionId, chatBootstrapped]);

  const copyChatMessage = async (text: string) => {
    try {
      await navigator.clipboard.writeText(markdownToPlainText(text) || text);
    } catch {
      // ignore
    }
  };

  const shareChatMessage = async (text: string) => {
    const plain = markdownToPlainText(text) || text;
    try {
      if (navigator.share) {
        await navigator.share({ text: plain });
        return;
      }
      await navigator.clipboard.writeText(plain);
    } catch {
      // ignore
    }
  };

  const regenerateAssistantReply = async (assistantIndex: number) => {
    let userMessage = '';
    for (let i = assistantIndex - 1; i >= 0; i -= 1) {
      if (chatHistory[i]?.role === 'user') {
        userMessage = chatHistory[i].content;
        break;
      }
    }
    if (!userMessage.trim()) return;

    setIsChatLoading(true);
    try {
      const aiResponse = await analyzeFolklore(userMessage, null);
      setChatHistory((prev) => prev.map((msg, idx) => {
        if (idx === assistantIndex && msg.role === 'assistant') {
          return { ...msg, content: aiResponse || '抱歉，我暂时无法生成新的回答。' };
        }
        return msg;
      }));
    } catch {
      setChatHistory((prev) => prev.map((msg, idx) => {
        if (idx === assistantIndex && msg.role === 'assistant') {
          return { ...msg, content: '重试失败，请稍后再试。' };
        }
        return msg;
      }));
    } finally {
      setIsChatLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      if (ttsAudio) {
        ttsAudio.pause();
      }
      window.speechSynthesis.cancel();
    };
  }, [ttsAudio]);

  useEffect(() => {
    if (activeTab !== 'geo') setGeoCiteExpanded({});
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'chat') {
      setChatComposerLift(0);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      setChatComposerLift(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, [activeTab]);

  // 时令 Tab：所有月份统一先拉 API（有 sections 则 grounded），失败再用静态兜底
  useEffect(() => {
    if (!siteReady || activeTab !== 'explorer' || !selectedMonth) return;
    fetchMonthData(selectedMonth);
  }, [selectedMonth, activeTab, siteReady]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const geoCustom = params.get('geoCustom');
    if (geoCustom) {
      setGeoSearchInput(geoCustom);
      setGeoCustomFilter(geoCustom);
      // 一次性消费：本次跳转生效后即从 URL 移除，避免刷新后继续保留旧筛选
      try {
        const u = new URL(window.location.href);
        u.searchParams.delete('geoCustom');
        window.history.replaceState(null, '', u.toString());
      } catch {
        // ignore
      }
    }
  }, []);

  const resetQjlDrawerUi = useCallback(() => {
    setQjlDrawerOpen(false);
    setQjlSectionId(null);
    setQjlSectionContent(null);
    setQjlHighlightQuote(null);
    setQjlTranslation(null);
    setQjlTranslationCached(null);
    setQjlTranslationVisible(false);
    setQjlTranslationError(null);
    setQjlSectionLoading(false);
  }, []);

  /** 用户主动关闭：清空 UI 并去掉原文 deep link */
  const closeQjlDrawerAndUrl = useCallback(() => {
    resetQjlDrawerUi();
    syncQjlUrl(null, null);
  }, [resetQjlDrawerUi]);

  /** 主导航切换时同步 `tab=`，便于分享与刷新后落在同一模块 */
  const goTab = useCallback((tab: MainTab) => {
    setActiveTab(tab);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('tab', tab);
      if (tab !== 'graph') u.searchParams.delete(GRAPH_MODE_PARAM);
      window.history.replaceState(null, '', u.toString());
    } catch {
      /* ignore */
    }
  }, []);

  const goGraphMode = useCallback((mode: GraphMode) => {
    setActiveTab('graph');
    setGraphMode(mode);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('tab', 'graph');
      u.searchParams.set(GRAPH_MODE_PARAM, mode);
      window.history.replaceState(null, '', u.toString());
    } catch {
      /* ignore */
    }
  }, []);

  const fetchGeoPlaces = async (month: string, refresh = false) => {
    setGeoLoading(true);
    setGeoError(null);
    setGeoStaleHint(null);
    try {
      // 二期优先：按月在线抽取 + RAG；若后端尚未升级则回退旧接口
      const onlineRes = await getGeoMonthData(month, { refresh });
      if (onlineRes) {
        setGeoPlaces(onlineRes.places ?? []);
        const meta = onlineRes._meta;
        if (meta?.stale) {
          setGeoStaleHint('提示：当前展示的是旧缓存（原文索引已变更且自动重算失败）。请点击「重新抽取」或检查大模型配置。');
        }
      } else {
        const fallback = await listGeoPlaces(month);
        if (!fallback) {
          setGeoPlaces([]);
          setGeoError('地理接口暂不可用，请确认后端已重启并包含 /api/geo/month-data 路由。');
        } else {
          setGeoPlaces(fallback.places ?? []);
          setGeoError('当前为离线数据（后端未启用在线抽取接口时自动回退）。');
        }
      }
    } catch (e) {
      setGeoPlaces([]);
      setGeoError(e instanceof Error ? e.message : '读取地理数据失败');
    } finally {
      setGeoLoading(false);
    }
  };

  const runGeoSearch = async () => {
    const q = geoSearchInput.trim();
    if (!q) {
      fetchGeoPlaces(selectedMonth);
      return;
    }
    setGeoLoading(true);
    setGeoError(null);
    setGeoStaleHint(null);
    const res = await aggregateGeoByName(q);
    if (!res) {
      setGeoPlaces([]);
      setGeoError('聚合接口不可用，请确认后端已更新。');
    } else {
      setGeoPlaces(res.places ?? []);
    }
    setGeoLoading(false);
  };

  useEffect(() => {
    if (!siteReady || (activeTab !== 'geo' && !isAdminRoute)) return;
    if (geoCustomFilter) {
      void runGeoSearch();
      return;
    }
    void fetchGeoPlaces(selectedMonth);
  }, [activeTab, selectedMonth, geoCustomFilter, siteReady]);

  useEffect(() => {
    if (!siteReady || (activeTab !== 'geo' && !isAdminRoute) || geoGlossary.length > 0) return;
    getGeoGlossary().then((res) => {
      if (res?.entries?.length) setGeoGlossary(res.entries);
    });
  }, [activeTab, geoGlossary.length, siteReady]);

  // 时令 Tab：拉取该月《清嘉录》小节目录，供「查看原文」
  useEffect(() => {
    if (!siteReady || activeTab !== 'explorer') return;
    let cancelled = false;
    listQingJiaLuSections(selectedMonth).then((res) => {
      if (!cancelled && res?.sections) {
        setQjlSectionList(res.sections.map((s) => ({ id: s.id, title: s.title })));
        setQjlSectionMonth(selectedMonth);
      } else if (!cancelled) setQjlSectionList([]);
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedMonth, siteReady]);

  // 时令左栏：按习俗关键词反查月份（用于“忘了是几月”的场景）
  useEffect(() => {
    if (!siteReady || activeTab !== 'explorer') return;
    const q = explorerSearchQuery.trim();
    if (!q) {
      setExplorerSearchMonthSet(null);
      setExplorerSearchHits([]);
      setExplorerSearchTotalMatches(0);
      setExplorerSearching(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setExplorerSearching(true);
      const res = await searchQingJiaLuMonths(q);
      if (!cancelled) {
        if (res) {
          setExplorerSearchMonthSet(new Set((res.months ?? []).map((m) => m.month)));
          const hits = Array.isArray(res.hits) ? res.hits : [];
          setExplorerSearchHits(hits);
          const fromMonths = (res.months ?? []).reduce((acc, m) => acc + (typeof m.count === 'number' ? m.count : 0), 0);
          setExplorerSearchTotalMatches(
            typeof res.totalMatches === 'number'
              ? res.totalMatches
              : hits.length > 0
                ? Math.max(fromMonths, hits.length)
                : fromMonths,
          );
        } else {
          setExplorerSearchMonthSet(new Set());
          setExplorerSearchHits([]);
          setExplorerSearchTotalMatches(0);
        }
        setExplorerSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeTab, explorerSearchQuery, siteReady]);

  // 地理左栏搜索：输入关键词时，执行聚合搜索（聚合已覆盖普通搜索）
  useEffect(() => {
    if (!siteReady || activeTab !== 'geo') return;
    const q = geoSearchInput.trim();
    if (!q) return;
    const timer = window.setTimeout(() => {
      void runGeoSearch();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeTab, geoSearchInput, selectedMonth, siteReady]);

  const fetchMonthData = async (month: string, refresh = false) => {
    setLoading(true);
    if (refresh) setMonthDataRefreshing(true);
    // 切月或重新生成时，默认收起「全部习俗」，只展示前若干条
    setShowAllCustoms(false);
    setMonthSourceMeta(null);
    const data = await getStructuredMonthData(month, { refresh });
    if (data) {
      const { _meta, ...rest } = data;
      setMonthData(rest);
      setMonthSourceMeta(_meta ?? null);
      // 同步刷新该月原文小节目录（特别是点击「重新生成卡片」后）
      listQingJiaLuSections(month)
        .then((res) => {
          if (res?.sections) {
            setQjlSectionList(res.sections.map((s) => ({ id: s.id, title: s.title })));
            setQjlSectionMonth(month);
          } else {
            setQjlSectionList([]);
          }
        })
        .catch(() => {
          // 目录获取失败时不影响卡片展示
        });
    } else {
      // 无 Key、网络错误或未配置模型等：用 INITIAL_HIGHLIGHTS 兜底，并标明非基于本地原文
      const fallback = INITIAL_HIGHLIGHTS[month as keyof typeof INITIAL_HIGHLIGHTS] as MonthData | undefined;
      if (fallback) {
        setMonthData(fallback);
        setMonthSourceMeta({
          grounded: false,
          sectionCount: 0,
          sectionTitles: [],
        });
      } else {
        setMonthData(null);
        setMonthSourceMeta(null);
      }
    }
    setMonthDataRefreshing(false);
    setLoading(false);
  };

  const openQjlSection = useCallback(async (id: string, highlightQuote?: string | null, chapterTitle?: string | null) => {
    let targetId = (id || '').trim();
    // 有些地理卡片的 sectionId 可能缺失或失效，兜底按章节标题匹配。
    if (!targetId && chapterTitle?.trim()) {
      const wanted = normTitleForMatch(chapterTitle);
      const currentMatch = qjlSectionList.find((s) => normTitleForMatch(s.title) === wanted || normTitleForMatch(s.title).includes(wanted));
      if (currentMatch) {
        targetId = currentMatch.id;
      } else {
        for (const month of MONTHS) {
          const secRes = await listQingJiaLuSections(month);
          const hit = secRes?.sections?.find((s) => normTitleForMatch(s.title) === wanted || normTitleForMatch(s.title).includes(wanted));
          if (hit?.id) {
            targetId = hit.id;
            break;
          }
        }
      }
    }
    if (!targetId) {
      alert('未找到对应原文小节，请先在「查看原文目录」中手动定位。');
      return;
    }
    const hi = highlightQuote?.trim() || null;
    syncQjlUrl(targetId, hi);
    setQjlDrawerOpen(true);
    setQjlSectionId(targetId);
    setQjlSectionLoading(true);
    setQjlSectionContent(null);
    setQjlHighlightQuote(hi);
    setQjlTranslation(null);
    setQjlTranslationVisible(false);
    setQjlTranslationError(null);
    try {
      const section = await getQingJiaLuSection(targetId);
      if (section) {
        setQjlSectionContent({ title: section.title, content: section.content });
        const m = section.month?.trim();
        if (m) {
          setQjlSectionMonth(m);
          listQingJiaLuSections(m).then((res) => {
            if (res?.sections) {
              setQjlSectionList(res.sections.map((s) => ({ id: s.id, title: s.title })));
            }
          });
        }
      } else {
        syncQjlUrl(null, null);
        resetQjlDrawerUi();
      }
    } catch {
      syncQjlUrl(null, null);
      resetQjlDrawerUi();
    } finally {
      setQjlSectionLoading(false);
    }
  }, [qjlSectionList, resetQjlDrawerUi]);

  const openQjlSectionRef = useRef(openQjlSection);
  openQjlSectionRef.current = openQjlSection;

  /** 切换 Tab 时收起原文层；若 URL 仍带 deep link，在「时令 / 地理」下自动恢复（便于切走再回） */
  useEffect(() => {
    if (!siteReady) return;
    resetQjlDrawerUi();
    const { sectionId, highlight } = parseQjlParams(window.location.search);
    if (!sectionId) return;
    if (activeTab === 'explorer' || activeTab === 'geo' || activeTab === 'graph') {
      void openQjlSectionRef.current(sectionId, highlight);
    }
  }, [activeTab, resetQjlDrawerUi, siteReady]);

  useEffect(() => {
    const onPopState = () => {
      if (!siteReady) return;
      const { sectionId, highlight } = parseQjlParams(window.location.search);
      if (sectionId) void openQjlSectionRef.current(sectionId, highlight);
      else resetQjlDrawerUi();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [resetQjlDrawerUi, siteReady]);

  const jumpGeoFromCustom = (custom: MonthCustom) => {
    const title =
      custom.name?.trim() ||
      (custom.description?.split(/[\n。；]/)[0]?.trim().slice(0, 24) ?? '').trim() ||
      '习俗';
    setGeoSearchInput(title);
    setGeoCustomFilter(title);
    goTab('geo');
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete(QJL_SECTION_PARAM);
      u.searchParams.delete(QJL_HIGHLIGHT_PARAM);
      u.searchParams.set('tab', 'geo');
      u.searchParams.set('geoMonth', selectedMonth);
      u.searchParams.set('geoCustom', title);
      window.history.replaceState(null, '', u.toString());
    } catch {
      // ignore
    }
  };

  const translateQjlSection = async () => {
    if (!qjlSectionId?.trim() || !qjlSectionContent?.content?.trim()) return;
    setQjlTranslating(true);
    setQjlTranslationError(null);
    // 保留旧译文，但在加载期间暂时隐藏，避免闪烁
    setQjlTranslationVisible(false);
    try {
      const payload = await getQingJiaLuSectionTranslation(qjlSectionId);
      if (!payload?.translation?.trim()) {
        setQjlTranslationError('翻译请求失败，请检查大模型配置后重试。');
        return;
      }
      setQjlTranslation(payload.translation);
      setQjlTranslationCached(payload.cached);
      setQjlTranslationVisible(true);
    } catch {
      setQjlTranslationError('翻译请求失败，请检查大模型配置后重试。');
    } finally {
      setQjlTranslating(false);
    }
  };

  const startChatFromGeoPlace = (place: GeoPlace) => {
    setChatGeoContext({
      month: selectedMonth,
      placeName: place.name,
      ancientEvidence: place.ancientEvidence,
      citations: (place.citations || []).map((c) => ({
        sectionId: c.sectionId,
        chapterTitle: c.chapterTitle,
        quoteText: c.quoteText,
      })),
    });
    setChatQuery(
      '请结合卡片所附《清嘉录》引文，说明该地点在礼制或城市空间中的含义，并区分：文献可证部分与推断部分。'
    );
    goTab('chat');
  };

  const handleChat = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!chatQuery.trim()) return;
    if (!activeChatSessionId) return;

    const userMsg = chatQuery;
    const geoCtx = chatGeoContext;
    setChatQuery('');
    setChatGeoContext(null);
    setChatHistory(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsChatLoading(true);

    try {
      appendChatSessionMessageApi(activeChatSessionId, { role: 'user', content: userMsg }).catch(() => {
        // 失败时依赖后续整包同步兜底
      });
      const aiResponse = await analyzeFolklore(userMsg, geoCtx);
      const assistantContent = aiResponse || '抱歉，我无法回答这个问题。';
      setChatHistory(prev => [...prev, { role: 'assistant', content: assistantContent }]);
      appendChatSessionMessageApi(activeChatSessionId, { role: 'assistant', content: assistantContent }).catch(() => {
        // 失败时依赖后续整包同步兜底
      });
    } catch (error) {
      const fallback = '发生错误，请稍后再试。';
      setChatHistory(prev => [...prev, { role: 'assistant', content: fallback }]);
      appendChatSessionMessageApi(activeChatSessionId, { role: 'assistant', content: fallback }).catch(() => {
        // ignore
      });
    } finally {
      setIsChatLoading(false);
    }
  };

  if (!admin.authBootstrapDone && admin.geoAdminToken.trim()) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-paper text-ink gap-3">
        <Loader2 className="animate-spin text-olive" size={36} />
        <p className="text-sm text-ink/60">正在验证登录状态…</p>
      </div>
    );
  }

  if (!admin.geoAdminToken.trim() || !admin.adminRole) {
    return (
      <UserLoginForm
        username={admin.adminUsername}
        password={admin.adminPassword}
        onUsernameChange={admin.setAdminUsername}
        onPasswordChange={admin.setAdminPassword}
        onSubmit={admin.handleAdminLogin}
        footerHint="登录后可浏览清嘉录民俗大观全部内容。"
      />
    );
  }

  if (admin.adminRole === 'viewer' && isAdminRoute) {
    if (typeof window !== 'undefined') {
      window.location.replace('/');
    }
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-paper text-ink gap-3">
        <Loader2 className="animate-spin text-olive" size={36} />
        <p className="text-sm text-ink/60">正在进入首页…</p>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] min-h-screen flex flex-col bg-paper text-ink">
      {/* Header */}
      <header className="border-b border-ink/10 py-4 sm:py-6 px-4 sm:px-8 flex flex-col sm:flex-row justify-between items-center gap-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-olive rounded-full flex items-center justify-center text-white">
            <Book size={20} />
          </div>
          <div>
            <h1 className="serif text-xl sm:text-2xl font-bold tracking-tight text-olive text-center sm:text-left">清嘉录 · 苏州民俗大观</h1>
            <p className="text-xs uppercase tracking-widest opacity-60 font-medium">Folklore Encyclopedia of Qing Suzhou</p>
          </div>
        </div>
        {isAdminRoute ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => admin.handleAdminLogout()}
              className="px-3 py-2 rounded-full border border-ink/15 text-sm text-ink/70 hover:bg-ink/5"
            >
              退出登录
            </button>
            <button
              type="button"
              onClick={() => window.location.assign('/')}
              className="px-3 py-2 rounded-full border border-ink/20 text-sm hover:bg-ink/5"
            >
              返回主站
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-end">
            <button
              type="button"
              onClick={() => admin.handleAdminLogout()}
              className="px-3 py-2 rounded-full border border-ink/15 text-sm text-ink/70 hover:bg-ink/5"
            >
              退出登录
            </button>
            {showGeoAdminNav && (
              <button
                type="button"
                onClick={() => window.location.assign('/admin')}
                className="px-3 py-2 rounded-full border border-olive/30 text-olive text-sm hover:bg-olive/5 transition-colors"
                title="地理治理与校审工作台"
              >
                管理后台
              </button>
            )}
            <nav className="flex gap-1 bg-ink/5 p-1 rounded-full">
              <NavButton active={activeTab === 'explorer'} onClick={() => goTab('explorer')} icon={<Sparkles size={16} />} label="时令" />
              <NavButton active={activeTab === 'chat'} onClick={() => goTab('chat')} icon={<MessageSquare size={16} />} label="解析" />
              <NavButton active={activeTab === 'geo'} onClick={() => goTab('geo')} icon={<MapPin size={16} />} label="地理" />
              <NavButton active={activeTab === 'graph'} onClick={() => goTab('graph')} icon={<BarChart3 size={16} />} label="图谱" />
              <NavButton
                active={activeTab === 'book'}
                onClick={() => {
                  setBookCardSource(undefined);
                  setBookInitialTopic(undefined);
                  setBookViewKey((k) => k + 1);
                  goTab('book');
                }}
                icon={<BookOpen size={16} />}
                label="绘本"
              />
            </nav>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 min-h-0 max-w-7xl mx-auto w-full p-4 sm:p-8 flex flex-col">
        <AnimatePresence mode="wait">
          {!isAdminRoute && activeTab === 'explorer' && (
            <motion.div
              key="explorer"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-8"
            >
              {/* Month Selector：小屏纵向——搜索全宽置顶，月份单独横向滚动 */}
              <div className="flex w-full min-w-0 flex-col gap-3 self-start lg:col-span-3 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-8rem)] lg:pr-1">
                <div className="w-full shrink-0 space-y-1.5">
                  <label htmlFor="explorer-search" className="sr-only">
                    按习俗关键词搜索并反查月份
                  </label>
                  <form
                    className="w-full"
                    onSubmit={(e) => {
                      e.preventDefault();
                    }}
                  >
                    <div className="relative rounded-2xl border border-ink/15 bg-white shadow-sm ring-1 ring-ink/5">
                      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-ink/35" aria-hidden />
                      <input
                        id="explorer-search"
                        type="text"
                        value={explorerSearchQuery}
                        onChange={(e) => setExplorerSearchQuery(e.target.value)}
                        placeholder="习俗关键词，反查月份…"
                        enterKeyHint="search"
                        inputMode="search"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        className="w-full min-h-[48px] rounded-2xl border-0 bg-transparent py-3 pl-11 pr-11 text-base text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-olive/25 touch-manipulation"
                      />
                      {explorerSearchQuery.trim() ? (
                        <button
                          type="button"
                          aria-label="清空搜索"
                          className="absolute right-1.5 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-ink/45 hover:bg-ink/10 hover:text-ink touch-manipulation"
                          onClick={() => setExplorerSearchQuery('')}
                        >
                          <X size={18} />
                        </button>
                      ) : null}
                    </div>
                  </form>
                  <p className="min-h-[1.25rem] px-0.5 text-xs text-ink/50 sm:text-[11px]">
                    {explorerSearchQuery.trim()
                      ? explorerSearching
                        ? '搜索中…'
                        : `命中月份：${explorerSearchMonthSet ? explorerSearchMonthSet.size : 0}`
                      : '输入如：元宵、春牛、轧神仙'}
                  </p>
                </div>
                <div className="-mx-1 flex min-h-0 gap-2 overflow-x-auto px-1 pb-1 scrollbar-hide sm:-mx-0 sm:px-0 lg:mx-0 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:overflow-x-visible lg:px-0 lg:pb-0">
                  {MONTHS
                    .filter((month) => !explorerSearchMonthSet || explorerSearchMonthSet.has(month))
                    .map((month) => (
                      <button
                        key={month}
                        type="button"
                        onClick={() => {
                          setSelectedMonth(month);
                          if (explorerSearchQuery.trim()) setExplorerSearchQuery('');
                        }}
                        className={cn(
                          'shrink-0 rounded-2xl border px-5 py-3 text-left font-serif text-base transition-all sm:px-6 sm:text-lg lg:w-full',
                          selectedMonth === month
                            ? 'scale-[1.02] border-olive bg-olive text-white shadow-lg lg:scale-105'
                            : 'border-ink/5 bg-white/50 hover:bg-white sm:border',
                        )}
                      >
                        {month}
                      </button>
                    ))}
                  {explorerSearchMonthSet && explorerSearchMonthSet.size === 0 && (
                    <p className="w-full shrink-0 self-center px-2 py-2 text-xs text-ink/50 lg:w-auto">
                      未找到匹配月份，请换个关键词
                    </p>
                  )}
                </div>
              </div>

              {/* Month Content */}
              <div className="lg:col-span-9 space-y-6">
                {explorerSearchQuery.trim() ? (
                  <div className="rounded-[24px] border border-olive/25 bg-white p-4 card-shadow sm:p-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <h3 className="font-serif text-lg font-bold text-olive">《清嘉录》原文搜索结果</h3>
                        <p className="mt-1 text-xs text-ink/55 sm:text-sm">
                          {explorerSearching
                            ? '正在检索原文小节…'
                            : explorerSearchTotalMatches > 0
                              ? `「${explorerSearchQuery.trim()}」命中 ${explorerSearchTotalMatches} 条小节${
                                  explorerSearchTotalMatches > explorerSearchHits.length
                                    ? `，下列展示前 ${explorerSearchHits.length} 条`
                                    : ''
                                }。下方时令卡片已暂时隐藏；点某条「查看该月卡片」或左侧月份、或「清除搜索」后可继续浏览卡片。`
                              : '未在本地原文索引中检索到匹配小节，可换个词或检查后端是否已更新。'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExplorerSearchQuery('')}
                        className="shrink-0 self-start rounded-full border border-ink/15 px-4 py-2 text-sm text-ink/70 hover:bg-ink/5 touch-manipulation min-h-[40px]"
                      >
                        清除搜索
                      </button>
                    </div>
                    {!explorerSearching && explorerSearchHits.length === 0 && explorerSearchTotalMatches > 0 ? (
                      <p className="mt-4 rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-3 text-xs text-amber-900 sm:text-sm">
                        已命中 {explorerSearchTotalMatches} 条原文，但当前接口未返回条文列表。请将服务端更新到含「search-months」条文摘要的版本，或先在左侧切换月份阅读卡片。
                      </p>
                    ) : null}
                    {!explorerSearching && explorerSearchHits.length > 0 ? (
                      <ul className="mt-4 max-h-[min(52dvh,520px)] space-y-3 overflow-y-auto overscroll-contain pr-0.5">
                        {explorerSearchHits.map((hit) => (
                          <li
                            key={hit.id}
                            className="rounded-xl border border-ink/10 bg-paper/70 p-3 sm:p-4"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-olive/12 px-2.5 py-0.5 text-xs font-semibold text-olive">
                                {hit.month}
                              </span>
                              <span className="min-w-0 font-serif text-sm font-semibold text-ink sm:text-base">
                                {hit.title}
                              </span>
                            </div>
                            <p
                              className="mt-2 text-xs leading-relaxed text-ink/75 sm:text-sm [&_mark]:rounded [&_mark]:px-0.5"
                              dangerouslySetInnerHTML={{
                                __html: highlightHtml(hit.snippet, explorerSearchQuery.trim()),
                              }}
                            />
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void openQjlSection(hit.id, explorerSearchQuery.trim())}
                                className="rounded-xl border border-olive/40 bg-white px-3 py-2 text-xs font-medium text-olive hover:bg-olive/10 touch-manipulation min-h-[40px] sm:text-sm"
                              >
                                打开原文
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedMonth(hit.month);
                                  setExplorerSearchQuery('');
                                }}
                                className="rounded-xl border border-ink/15 bg-white px-3 py-2 text-xs font-medium text-ink/80 hover:bg-ink/5 touch-manipulation min-h-[40px] sm:text-sm"
                              >
                                查看该月卡片
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                {!explorerSearchQuery.trim() && loading ? (
                  <div className="h-64 flex flex-col items-center justify-center gap-4 text-olive/60">
                    <Loader2 className="animate-spin" size={40} />
                    <p className="serif italic">
                      {monthDataRefreshing
                        ? '正在重新生成卡片…'
                        : '加载中（已生成过则读库，不重复调模型）…'}
                    </p>
                  </div>
                ) : !explorerSearchQuery.trim() ? (
                  <>
                    <div className="bg-white p-5 sm:p-8 rounded-[32px] card-shadow border border-ink/5">
                      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                        <h2 className="serif text-3xl sm:text-4xl font-bold text-olive">{selectedMonth} · 概要</h2>
                        <div className="flex flex-wrap gap-2">
                          {monthSourceMeta?.grounded && (
                            <span className="text-xs bg-olive/10 text-olive px-3 py-1.5 rounded-full font-medium">
                              基于《清嘉录》原文 {monthSourceMeta.sectionCount} 条
                            </span>
                          )}
                          {monthSourceMeta && !monthSourceMeta.grounded && (
                            <span className="text-xs bg-ink/10 text-ink/70 px-3 py-1.5 rounded-full font-medium">
                              本月暂无本地原文，摘要仅供参考
                            </span>
                          )}
                          {qjlSectionList.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                syncQjlUrl(null, null);
                                setQjlDrawerOpen(true);
                              }}
                              className="text-xs border border-olive/40 text-olive px-3 py-1.5 rounded-full font-medium hover:bg-olive/10"
                            >
                              查看原文目录（{qjlSectionList.length}）
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => fetchMonthData(selectedMonth, true)}
                            className="text-xs border border-ink/20 text-ink/80 px-3 py-1.5 rounded-full font-medium hover:bg-ink/5 disabled:opacity-50"
                          >
                            重新生成卡片
                          </button>
                        </div>
                      </div>
                      <p className="text-lg leading-relaxed opacity-80 italic">{monthData?.summary || "暂无概要信息。"}</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {(showAllCustoms ? monthData?.customs ?? [] : monthData?.customs?.slice(0, 8) ?? []).map((custom: MonthCustom, idx: number) => (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: idx * 0.1 }}
                          className="bg-white p-6 rounded-[24px] card-shadow border border-ink/5 flex flex-col gap-4"
                        >
                          <div className="flex justify-between items-start">
                            <h3 className="serif text-2xl font-bold text-vermilion">
                              {custom.name?.trim() || (custom.description?.slice(0, 12).trim() + (custom.description?.length > 12 ? '…' : '')) || '习俗'}
                            </h3>
                            <span className="text-[10px] uppercase tracking-widest bg-olive/10 text-olive px-2 py-1 rounded-full font-bold">习俗</span>
                          </div>
                          <p className="text-sm leading-relaxed opacity-80">{custom.description}</p>
                          
                          {custom.roles && (
                            <div className="flex flex-wrap gap-2 mt-auto pt-4 border-t border-ink/5">
                              {custom.roles.map((role: string) => (
                                <span key={role} className="text-[11px] bg-ink/5 px-2 py-1 rounded-lg opacity-60">#{role}</span>
                              ))}
                            </div>
                          )}
                          
                          {custom.modernStatus && (
                            <div className="mt-2 p-3 bg-paper/50 rounded-xl border border-olive/10">
                              <div className="flex items-center gap-2 text-olive mb-1">
                                <MapPin size={12} />
                                <span className="text-[10px] font-bold uppercase tracking-wider">古今对照</span>
                              </div>
                              <p className="text-xs italic opacity-70">{custom.modernStatus}</p>
                            </div>
                          )}
                          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => jumpGeoFromCustom(custom)}
                              className="w-full py-2.5 rounded-xl border border-olive/40 text-olive text-sm font-medium hover:bg-olive/5 flex items-center justify-center gap-2"
                            >
                              <MapPin size={16} />
                              相关地点（时令）
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const name =
                                  custom.name?.trim() ||
                                  (custom.description?.slice(0, 20).trim() || '该习俗');
                                let sectionId: string | undefined;
                                const exact = qjlSectionList.find((s) => s.title.trim() === name);
                                if (exact) sectionId = exact.id;
                                else {
                                  const cand = qjlSectionList.filter((s) => {
                                    const t = s.title.trim();
                                    return t.includes(name) || name.includes(t);
                                  });
                                  cand.sort(
                                    (a, b) =>
                                      a.title.length - b.title.length || a.title.localeCompare(b.title, 'zh'),
                                  );
                                  sectionId = cand[0]?.id;
                                }
                                setBookInitialTopic(name);
                                setBookCardSource({
                                  type: 'card',
                                  month: selectedMonth,
                                  customName: name,
                                  ...(sectionId ? { sectionId } : {}),
                                });
                                setBookViewKey((k) => k + 1);
                                goTab('book');
                              }}
                              className="w-full py-2.5 rounded-xl bg-olive text-white text-sm font-medium hover:opacity-90 flex items-center justify-center gap-2"
                            >
                              <BookOpen size={16} />
                              生成绘本
                            </button>
                          </div>
                        </motion.div>
                      ))}
                    </div>

                    {monthData?.customs && monthData.customs.length > 8 && (
                      <div className="flex justify-center mt-2">
                        <button
                          type="button"
                          className="text-xs px-4 py-2 rounded-full border border-ink/15 text-ink/70 hover:bg-ink/5"
                          onClick={() => setShowAllCustoms((v) => !v)}
                        >
                          {showAllCustoms
                            ? `收起部分习俗（共 ${monthData.customs.length} 条）`
                            : `仅展示前 8 条，点击展开全部（共 ${monthData.customs.length} 条）`}
                        </button>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            </motion.div>
          )}

          {!isAdminRoute && activeTab === 'chat' && (
            <motion.div
              key="chat"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="max-w-6xl mx-auto w-full min-h-[min(72vh,520px)] h-[calc(100dvh-14rem)] md:h-[72vh] md:max-h-[820px]"
            >
              <div className="h-full grid grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] gap-4 min-h-0">
                <aside className="bg-white/70 border border-ink/10 rounded-2xl p-3 card-shadow flex flex-col min-h-0 max-h-[32vh] md:max-h-none">
                  <button
                    type="button"
                    onClick={createNewChatSession}
                    className="w-full mb-3 px-3 py-2 rounded-xl bg-olive text-white text-sm font-medium hover:opacity-90 flex items-center justify-center gap-2"
                  >
                    <Plus size={16} />
                    新建对话
                  </button>
                  <div className="text-[11px] uppercase tracking-widest text-ink/45 px-1 pb-2">对话列表</div>
                  <input
                    type="text"
                    value={chatSessionSearch}
                    onChange={(e) => setChatSessionSearch(e.target.value)}
                    placeholder="搜索对话..."
                    className="mb-2 w-full px-3 py-2 rounded-xl border border-ink/10 bg-white text-sm focus:outline-none focus:border-olive"
                  />
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                    {chatSessions
                      .filter((session) => {
                        const q = chatSessionSearch.trim().toLowerCase();
                        if (!q) return true;
                        const title = (session.title || '').toLowerCase();
                        const firstUser = (session.messages.find((m) => m.role === 'user')?.content || '').toLowerCase();
                        return title.includes(q) || firstUser.includes(q);
                      })
                      .map((session) => (
                      <div
                        key={session.id}
                        className={cn(
                          "group rounded-xl border px-3 py-2.5 text-left transition-all",
                          activeChatSessionId === session.id
                            ? "border-olive/50 bg-olive/10"
                            : "border-ink/10 hover:border-olive/30 bg-white"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => switchChatSession(session.id)}
                          className="w-full text-left"
                        >
                          <div className="text-sm font-medium text-ink line-clamp-1">
                            {session.title || '新对话'}
                          </div>
                          <div className="text-[11px] text-ink/45 mt-1">
                            {new Date(session.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                          </div>
                        </button>
                        <button
                          type="button"
                          title="重命名对话"
                          onClick={(e) => {
                            e.stopPropagation();
                            renameChatSession(session.id);
                          }}
                          className="mt-2 mr-2 text-ink/40 hover:text-olive transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          title="删除对话"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteChatSession(session.id);
                          }}
                          className="mt-2 text-ink/40 hover:text-vermilion transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </aside>

                <div className="flex flex-col min-h-0">
                  <div
                    className="flex-1 overflow-y-auto space-y-6 p-4 scrollbar-hide bg-white/40 rounded-2xl border border-ink/10 card-shadow"
                    style={{
                      paddingBottom:
                        chatComposerLift > 0 ? `calc(1rem + ${Math.round(chatComposerLift)}px)` : undefined,
                    }}
                  >
                    {chatHistory.length === 0 && (
                      <div className="text-center py-12 space-y-4">
                        <div className="w-16 h-16 bg-olive/10 text-olive rounded-full flex items-center justify-center mx-auto">
                          <MessageSquare size={32} />
                        </div>
                        <h3 className="serif text-2xl font-bold text-olive">文言解析与民俗助手</h3>
                        <p className="opacity-60 max-w-md mx-auto">您可以询问关于《清嘉录》中的难词、习俗背景或要求将某段文字翻译为白话文。</p>
                        <div className="flex flex-wrap justify-center gap-2 mt-6">
                          {["解析‘行春’仪式", "苏州元宵节吃什么？", "翻译：‘摸摸春牛脚，一世不愁吃’"].map(q => (
                            <button 
                              key={q} 
                              onClick={() => { setChatQuery(q); }}
                              className="text-xs bg-white px-4 py-2 rounded-full border border-ink/10 hover:border-olive transition-colors"
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {chatHistory.map((msg, i) => (
                      <div key={i} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
                        <div className={cn(
                          "max-w-[85%] p-5 rounded-[24px] relative group",
                          msg.role === 'user' 
                            ? "bg-olive text-white rounded-tr-none" 
                            : "bg-white card-shadow border border-ink/5 rounded-tl-none"
                        )}>
                          <div className="markdown-body">
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>
                          {msg.role === 'assistant' && (
                            <div className="mt-4 pt-3 border-t border-ink/10 flex flex-wrap items-center gap-2 sm:gap-3 text-ink/55 touch-manipulation">
                              <button
                                type="button"
                                title="复制"
                                onClick={() => copyChatMessage(msg.content)}
                                className="hover:text-olive transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-ink/5"
                              >
                                <Copy size={16} />
                              </button>
                              <button
                                type="button"
                                title="重答"
                                onClick={() => regenerateAssistantReply(i)}
                                className="hover:text-olive transition-colors disabled:opacity-40 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-ink/5"
                                disabled={isChatLoading}
                              >
                                <RotateCcw size={16} />
                              </button>
                              <button
                                type="button"
                                title={speakingMsgIndex === i ? '停止朗读' : '朗读'}
                                onClick={() => speak(msg.content, i)}
                                className={cn(
                                  'transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-ink/5',
                                  speakingMsgIndex === i ? 'text-vermilion' : 'hover:text-olive',
                                )}
                              >
                                {speakingMsgIndex === i ? <Square size={16} fill="currentColor" /> : <Volume2 size={16} />}
                              </button>
                              <button
                                type="button"
                                title="赞"
                                onClick={() => setChatFeedback((prev) => ({ ...prev, [i]: 'up' }))}
                                className={cn(
                                  'transition-colors hover:text-olive min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-ink/5',
                                  chatFeedback[i] === 'up' && 'text-olive',
                                )}
                              >
                                <ThumbsUp size={16} />
                              </button>
                              <button
                                type="button"
                                title="踩"
                                onClick={() => setChatFeedback((prev) => ({ ...prev, [i]: 'down' }))}
                                className={cn(
                                  'transition-colors hover:text-olive min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-ink/5',
                                  chatFeedback[i] === 'down' && 'text-vermilion',
                                )}
                              >
                                <ThumbsDown size={16} />
                              </button>
                              <button
                                type="button"
                                title="分享"
                                onClick={() => shareChatMessage(msg.content)}
                                className="hover:text-olive transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-ink/5"
                              >
                                <Share2 size={16} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {isChatLoading && (
                      <div className="flex justify-start">
                        <div className="bg-white p-5 rounded-[24px] rounded-tl-none card-shadow border border-ink/5 flex items-center gap-3">
                          <Loader2 className="animate-spin text-olive" size={20} />
                          <span className="serif italic opacity-60">正在研读文献...</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div
                    className="mt-4 shrink-0"
                    style={{
                      transform: chatComposerLift ? `translateY(-${Math.round(chatComposerLift)}px)` : undefined,
                      transition: 'transform 0.15s ease-out',
                    }}
                  >
                    <form onSubmit={handleChat} className="relative pb-[max(0px,env(safe-area-inset-bottom))]">
                      <input
                        type="text"
                        value={chatQuery}
                        onChange={(e) => setChatQuery(e.target.value)}
                        placeholder="输入您想了解的民俗或词汇..."
                        enterKeyHint="send"
                        className="w-full bg-white p-4 sm:p-5 pr-14 sm:pr-16 text-base rounded-full card-shadow border border-ink/10 focus:outline-none focus:border-olive transition-all touch-manipulation"
                      />
                      <button
                        type="submit"
                        disabled={isChatLoading || !chatQuery.trim()}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 h-11 w-11 sm:right-3 sm:h-10 sm:w-10 bg-olive text-white rounded-full flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-50 touch-manipulation"
                        aria-label="发送"
                      >
                        <ChevronRight size={20} />
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {!isAdminRoute && activeTab === 'geo' && (
            <motion.div
              key="geo"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12 lg:gap-8"
            >
              <div className="flex w-full min-w-0 flex-col gap-3 self-start lg:col-span-3 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-8rem)] lg:pr-1">
                <div className="w-full shrink-0 space-y-1.5">
                  <label htmlFor="geo-place-search" className="sr-only">
                    按地名搜索并聚合地点
                  </label>
                  <form
                    className="w-full"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void runGeoSearch();
                    }}
                  >
                    <div className="relative rounded-2xl border border-ink/15 bg-white shadow-sm ring-1 ring-ink/5">
                      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-ink/35" aria-hidden />
                      <input
                        id="geo-place-search"
                        type="text"
                        value={geoSearchInput}
                        onChange={(e) => setGeoSearchInput(e.target.value)}
                        placeholder="地名，如 虎丘、玄妙观…"
                        enterKeyHint="search"
                        inputMode="search"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        className="w-full min-h-[48px] rounded-2xl border-0 bg-transparent py-3 pl-11 pr-11 text-base text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-olive/25 touch-manipulation"
                      />
                      {geoSearchInput.trim() ? (
                        <button
                          type="button"
                          aria-label="清空地名搜索"
                          className="absolute right-1.5 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-ink/45 hover:bg-ink/10 hover:text-ink touch-manipulation"
                          onClick={() => {
                            setGeoSearchInput('');
                            setGeoCustomFilter(null);
                            void fetchGeoPlaces(selectedMonth);
                          }}
                        >
                          <X size={18} />
                        </button>
                      ) : null}
                    </div>
                  </form>
                  <p className="min-h-[1.25rem] px-0.5 text-xs text-ink/50 sm:text-[11px]">
                    {geoSearchInput.trim()
                      ? `聚合命中 ${geoPlaces.length} 个地点`
                      : '输入地名后自动聚合；亦可点下方「聚合搜索」'}
                  </p>
                </div>
                <div className="-mx-1 flex min-h-0 gap-2 overflow-x-auto px-1 pb-1 scrollbar-hide sm:-mx-0 sm:px-0 lg:mx-0 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:overflow-x-visible lg:px-0 lg:pb-0">
                  {MONTHS.map((month) => (
                    <button
                      key={`geo-month-${month}`}
                      type="button"
                      onClick={() => setSelectedMonth(month)}
                      className={cn(
                        'shrink-0 rounded-2xl border px-5 py-3 text-left font-serif text-base transition-all sm:px-6 sm:text-lg lg:w-full',
                        selectedMonth === month
                          ? 'scale-[1.02] border-olive bg-olive text-white shadow-lg lg:scale-105'
                          : 'border-ink/10 bg-white/60 text-ink/80 hover:bg-white sm:border',
                      )}
                    >
                      {month}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => void runGeoSearch()}
                    className="shrink-0 rounded-2xl border border-ink/20 bg-white px-4 py-3 text-left text-sm text-ink/70 hover:bg-ink/5 touch-manipulation min-h-[48px] lg:w-full"
                  >
                    聚合搜索
                  </button>
                  <button
                    type="button"
                    onClick={() => fetchGeoPlaces(selectedMonth, true)}
                    className="shrink-0 rounded-2xl border border-ink/20 bg-white px-4 py-3 text-left text-sm text-ink/70 hover:bg-ink/5 touch-manipulation min-h-[48px] lg:w-full"
                  >
                    重新抽取
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setGeoSearchInput('');
                      setGeoCustomFilter(null);
                      fetchGeoPlaces(selectedMonth);
                    }}
                    className="shrink-0 rounded-2xl border border-ink/20 bg-white px-4 py-3 text-left text-sm text-ink/70 hover:bg-ink/5 touch-manipulation min-h-[48px] lg:w-full"
                  >
                    清空条件
                  </button>
                </div>
              </div>

              <div className="lg:col-span-9 space-y-6">
                <div className="text-center max-w-2xl mx-auto">
                  <h2 className="serif text-3xl sm:text-4xl font-bold text-olive mb-4">古今地理对照</h2>
                  <p className="opacity-60 italic">追踪《清嘉录》中提到的苏州地标，支持按月份动态筛选与原文引用溯源。</p>
                </div>

                {geoCustomFilter && (
                  <div className="bg-white rounded-[24px] border border-ink/10 p-4 text-xs text-olive flex flex-wrap items-center gap-2">
                    <span>当前习俗筛选：{geoCustomFilter}</span>
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        setGeoCustomFilter(null);
                        setGeoSearchInput('');
                        fetchGeoPlaces(selectedMonth);
                      }}
                    >
                      清除习俗筛选
                    </button>
                  </div>
                )}

                {geoStaleHint && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3 rounded-[18px]">
                    {geoStaleHint}
                  </div>
                )}

                {geoLoading ? (
                  <div className="h-48 flex items-center justify-center text-olive/70 gap-3">
                    <Loader2 className="animate-spin" size={22} />
                    <span className="serif italic">正在加载 {selectedMonth} 地理卡片...</span>
                  </div>
                ) : geoError ? (
                  <div className="bg-white rounded-[24px] border border-amber-200 p-8 text-center text-amber-700 space-y-3">
                    <div>{geoError}</div>
                    <button
                      type="button"
                      onClick={() => fetchGeoPlaces(selectedMonth)}
                      className="px-4 py-2 rounded-full text-sm border border-amber-300 hover:bg-amber-50"
                    >
                      重试加载
                    </button>
                  </div>
                ) : geoPlaces.length === 0 ? (
                  <div className="bg-white rounded-[24px] border border-ink/10 p-8 text-center opacity-70">
                    {selectedMonth} 暂无可展示的地理条目
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {geoPlaces.map((place, i) => {
                  const glossHits = glossaryMatchesForPlace(place, geoGlossary);
                  return (
                  <motion.div 
                    key={place.id} 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="bg-white p-6 rounded-[24px] card-shadow border border-ink/5 group hover:border-olive/30 transition-all"
                  >
                    <div className="flex justify-between items-start gap-2 mb-3">
                      <div className="min-w-0">
                        <h3 className="serif text-2xl font-bold text-olive">{place.name}</h3>
                        {glossHits.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {glossHits.map((g) => (
                              <span
                                key={g.term}
                                title={g.definition}
                                className="text-[10px] px-2 py-0.5 rounded-full bg-olive/10 text-olive border border-olive/25 max-w-full truncate"
                              >
                                {g.term}（{g.source === 'original' ? '可核原文' : '编者简注'}）
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className={cn(
                        "text-[10px] px-2 py-1 rounded-full font-bold uppercase tracking-widest shrink-0",
                        place.status === '存续' ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                      )}>{place.status}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-3">
                      <button
                        type="button"
                        onClick={() => startChatFromGeoPlace(place)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-olive text-white text-xs font-medium hover:opacity-90"
                      >
                        <MessageSquare size={14} />
                        追问解析
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyTextToClipboard(formatAllGeoCitations(place))}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-ink/20 text-xs text-ink/80 hover:bg-ink/5"
                      >
                        <Copy size={14} />
                        复制全部引用
                      </button>
                    </div>
                    <div className="space-y-3">
                      {place.ancientEvidence && (
                        <div>
                          <span className="text-[10px] font-bold text-vermilion uppercase tracking-wider block mb-1">文献可证（清代）</span>
                          <p className="text-sm opacity-90">{place.ancientEvidence}</p>
                        </div>
                      )}
                      <div>
                        <span className="text-[10px] font-bold text-vermilion uppercase tracking-wider block mb-1">清代侧综述</span>
                        <p className="text-sm opacity-80 italic">{place.ancientSummary}</p>
                      </div>
                      {place.modernFactual && (
                        <div>
                          <span className="text-[10px] font-bold text-olive uppercase tracking-wider block mb-1">现代侧（可核对）</span>
                          <p className="text-sm opacity-85">{place.modernFactual}</p>
                        </div>
                      )}
                      {place.modernInterpretation && (
                        <div>
                          <span className="text-[10px] font-bold text-ink/50 uppercase tracking-wider block mb-1">现代侧（推断/类比）</span>
                          <p className="text-sm opacity-75 italic">{place.modernInterpretation}</p>
                        </div>
                      )}
                      <div>
                        <span className="text-[10px] font-bold text-olive uppercase tracking-wider block mb-1">现代现状（总述）</span>
                        <p className="text-sm opacity-80">{place.modernSummary}</p>
                      </div>
                      <div>
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="text-[10px] font-bold text-ink/60 uppercase tracking-wider">原文依据</span>
                          {geoViewportNarrow && place.citations.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setGeoCiteExpanded((prev) => ({
                                  ...prev,
                                  [place.id]: !prev[place.id],
                                }))
                              }
                              className="text-xs text-olive underline touch-manipulation min-h-[36px] px-1"
                            >
                              {geoCiteExpanded[place.id]
                                ? '收起引文'
                                : `展开引文（${place.citations.length}）`}
                            </button>
                          )}
                        </div>
                        <div
                          className={cn(
                            'space-y-1.5',
                            geoViewportNarrow && !geoCiteExpanded[place.id] && 'hidden',
                          )}
                        >
                          {place.citations.map((citation, idx) => (
                            <div key={`${place.id}-citation-${idx}`} className="text-xs opacity-75 leading-relaxed space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-ink/10 text-ink/70">
                                  {citation.evidenceStrength === 'direct'
                                    ? '证据：直接出现'
                                    : citation.evidenceStrength === 'indirect'
                                      ? '证据：间接相关'
                                      : '证据：推断关联'}
                                </span>
                                <button
                                  type="button"
                                  className="text-[10px] text-olive underline touch-manipulation"
                                  onClick={() => openQjlSection(citation.sectionId, citation.quoteText, citation.chapterTitle)}
                                >
                                  打开原文并高亮
                                </button>
                                <button
                                  type="button"
                                  className="text-[10px] text-ink/60 underline touch-manipulation"
                                  onClick={() =>
                                    void copyTextToClipboard(formatGeoCitationLine(place, citation))
                                  }
                                >
                                  复制引用
                                </button>
                              </div>
                              <p>
                                {extractJuanFromSectionId(citation.sectionId) ? `${extractJuanFromSectionId(citation.sectionId)}，` : ''}《{citation.chapterTitle}》：{citation.quoteText}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                  );
                })}
                </div>
                )}
              </div>
            </motion.div>
          )}

          {isAdminRoute && (
            <AdminApp
              months={MONTHS}
              selectedMonth={selectedMonth}
              onSelectMonth={setSelectedMonth}
              adminUsername={admin.adminUsername}
              adminPassword={admin.adminPassword}
              adminRole={admin.adminRole}
              onAdminUsernameChange={admin.setAdminUsername}
              onAdminPasswordChange={admin.setAdminPassword}
              onLogin={admin.handleAdminLogin}
              onLogout={admin.handleAdminLogout}
              geoAdminToken={admin.geoAdminToken}
              geoAdminBusy={admin.geoAdminBusy}
              onFetchMetrics={admin.handleFetchMetrics}
              onPreviewDiff={admin.handlePreviewDiff}
              onFetchAuditLogs={admin.handleFetchAuditLogs}
              geoAdminMetricsText={admin.geoAdminMetricsText}
              geoAdminDiffText={admin.geoAdminDiffText}
              auditLogsText={admin.auditLogsText}
              authUsers={admin.authUsers}
              authUsersLoading={admin.authUsersLoading}
              onRefreshUsers={admin.loadAuthUsers}
              newUserName={admin.newUserName}
              newUserPassword={admin.newUserPassword}
              newUserPasswordConfirm={admin.newUserPasswordConfirm}
              newUserRole={admin.newUserRole}
              onNewUserNameChange={admin.setNewUserName}
              onNewUserPasswordChange={admin.setNewUserPassword}
              onNewUserPasswordConfirmChange={admin.setNewUserPasswordConfirm}
              onNewUserRoleChange={admin.setNewUserRole}
              onCreateUser={admin.handleCreateUser}
              onChangeUserRole={admin.handleChangeUserRole}
              onSetUserPassword={admin.handleSetUserPassword}
              onDeleteUser={admin.handleDeleteUser}
              geoPlaces={geoPlaces}
              geoReviews={admin.geoReviews}
              reviewFilter={admin.reviewFilter}
              onReviewFilterChange={admin.setReviewFilter}
              reviewNoteDraft={admin.reviewNoteDraft}
              onReviewNoteDraftChange={admin.onReviewNoteDraftChange}
              onRefreshReviewQueue={() => fetchGeoPlaces(selectedMonth)}
              onReviewStatus={(place, st, placeOverride) => admin.handleReviewStatus(place, st, selectedMonth, placeOverride)}
              graphAdminLog={admin.graphAdminLog}
              graphAdminBusy={admin.graphAdminBusy}
              folkloreGraphDrafts={admin.folkloreGraphDrafts}
              onRefreshFolkloreGraphDrafts={admin.refreshFolkloreGraphDrafts}
              onFolkloreGraphReload={admin.handleFolkloreGraphReload}
              onFolkloreGraphMergeDryRun={admin.handleFolkloreGraphMergeDryRun}
              onFolkloreGraphMergeApply={admin.handleFolkloreGraphMergeApply}
              onSaveFolkloreGraphDraft={admin.handleSaveFolkloreGraphDraft}
              onPublishFolkloreGraphDraft={admin.handlePublishFolkloreGraphDraft}
              onDeleteFolkloreGraphDraft={admin.handleDeleteFolkloreGraphDraft}
            />
          )}

          {!isAdminRoute && activeTab === 'graph' && (
            <motion.div
              key="graph"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4 sm:gap-6 flex-1 min-h-0 w-full lg:min-h-[760px]"
            >
              <aside className="self-start bg-white/70 rounded-2xl border border-ink/10 p-4 flex flex-col gap-3 max-h-[38dvh] overflow-y-auto overscroll-y-contain lg:max-h-none lg:min-h-[760px] lg:h-[760px] lg:overflow-y-auto">
                <div className="text-xs font-bold uppercase tracking-widest text-ink/50">图谱导航</div>
                <div className="inline-flex w-full gap-1 rounded-full bg-ink/5 p-1">
                  <button
                    type="button"
                    onClick={() => goGraphMode('explore')}
                    className={cn(
                      'flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition',
                      graphMode === 'explore' ? 'bg-olive text-white' : 'text-ink/60 hover:bg-ink/10'
                    )}
                  >
                    探索
                  </button>
                  <button
                    type="button"
                    onClick={() => goGraphMode('workbench')}
                    className={cn(
                      'flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition',
                      graphMode === 'workbench' ? 'bg-olive text-white' : 'text-ink/60 hover:bg-ink/10'
                    )}
                  >
                    工作台
                  </button>
                </div>
                <div className="text-xs font-bold uppercase tracking-widest text-ink/50 pt-1">月份</div>
                <div className="flex flex-col gap-2 overflow-y-auto pr-1 flex-1 min-h-0">
                  <button
                    type="button"
                    onClick={() => setGraphMonth(null)}
                    className={cn(
                      'w-full py-2 rounded-lg text-sm border transition text-left px-3',
                      graphMonth === null
                        ? 'bg-olive text-white border-olive'
                        : 'bg-white text-ink/70 border-ink/15 hover:border-olive/35'
                    )}
                  >
                    全部月份
                  </button>
                  {MONTHS.map((month) => (
                    <button
                      key={`graph-month-${month}`}
                      type="button"
                      onClick={() => {
                        setSelectedMonth(month);
                        setGraphMonth(month);
                      }}
                      className={cn(
                        'w-full py-2 rounded-lg text-sm border transition text-left px-3',
                        graphMonth === month
                          ? 'bg-olive text-white border-olive'
                          : 'bg-white text-ink/70 border-ink/15 hover:border-olive/35'
                      )}
                    >
                      {month}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-ink/50 leading-relaxed">
                  当前月份：{graphMonth ?? '全部月份'}。三维、地景、叙事三视图统一按该月份抽取子图。
                </p>
              </aside>

              <section className="flex h-[56dvh] max-h-[760px] flex-col min-h-0 overflow-hidden lg:h-[760px] lg:max-h-[760px]">
                {graphMode === 'explore' ? (
                  <FolkloreGraph onOpenQjlSection={openQjlSection} month={graphMonth ?? undefined} />
                ) : (
                  <ResearchWorkbench onOpenQjlSection={openQjlSection} month={graphMonth ?? undefined} />
                )}
              </section>
            </motion.div>
          )}

          {!isAdminRoute && activeTab === 'book' && (
            <motion.div
              key="book"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <PictureBookView key={bookViewKey} initialTopic={bookInitialTopic} initialCardSource={bookCardSource} />
            </motion.div>
          )}

          </AnimatePresence>

          {/* 《清嘉录》原文抽屉：全局挂载，地理/其它模块均可打开，无需切回「时令」 */}
          <AnimatePresence>
            {qjlDrawerOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[60] flex justify-end bg-ink/40"
                onClick={closeQjlDrawerAndUrl}
              >
                <motion.aside
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  transition={{ type: 'tween', duration: 0.2 }}
                  className="w-full max-w-2xl bg-paper shadow-xl h-full overflow-hidden flex flex-col border-l border-ink/10 max-h-[100dvh] pt-[env(safe-area-inset-top)]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between gap-2 p-4 border-b border-ink/10 shrink-0">
                    <div className="min-w-0">
                      <h3 className="serif text-lg font-bold text-olive truncate">
                        {qjlSectionContent ? qjlSectionContent.title : `${qjlSectionMonth || selectedMonth} · 原文目录`}
                      </h3>
                      <p className="text-[10px] text-ink/45 mt-0.5">
                        地址栏含小节 deep link 时可分享；时令/地理下切走再回会自动恢复。点遮罩关闭将清除链接。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={closeQjlDrawerAndUrl}
                      className="p-2 rounded-full hover:bg-ink/5 shrink-0"
                      aria-label="关闭"
                    >
                      <X size={20} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    {qjlSectionContent ? (
                      <>
                        <button
                          type="button"
                          className="text-sm text-olive mb-3 hover:underline"
                          onClick={() => {
                            syncQjlUrl(null, null);
                            setQjlSectionContent(null);
                            setQjlSectionId(null);
                            setQjlHighlightQuote(null);
                            setQjlTranslationCached(null);
                            setQjlTranslationVisible(false);
                            setQjlTranslationError(null);
                          }}
                        >
                          ← 返回目录
                        </button>
                        {qjlSectionLoading ? (
                          <div className="flex justify-center py-8">
                            <Loader2 className="animate-spin text-olive" size={32} />
                          </div>
                        ) : (
                          <>
                            <div className="flex flex-wrap gap-2 mb-3">
                              <button
                                type="button"
                                disabled={qjlTranslating}
                                onClick={() => {
                                  if (qjlTranslation) {
                                    setQjlTranslationVisible((v) => !v);
                                  } else {
                                    translateQjlSection();
                                  }
                                }}
                                className="text-xs bg-olive text-white px-3 py-1.5 rounded-full font-medium hover:opacity-90 disabled:opacity-50"
                              >
                                {qjlTranslating ? '翻译中…' : qjlTranslationVisible ? '收起译文' : '白话翻译'}
                              </button>
                            </div>
                            <pre
                              className="whitespace-pre-wrap font-sans text-sm leading-relaxed opacity-90 border border-ink/10 rounded-xl p-3 bg-white/80"
                              dangerouslySetInnerHTML={{ __html: highlightHtml(qjlSectionContent.content, qjlHighlightQuote) }}
                            />
                            {qjlTranslationError && (
                              <p className="text-sm text-vermilion mt-3">{qjlTranslationError}</p>
                            )}
                            {qjlTranslation && qjlTranslationVisible && (
                              <div className="mt-4 border-t border-ink/10 pt-4">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-olive mb-2">
                                  白话译文
                                  {qjlTranslationCached !== null && (
                                    <span
                                      className={cn(
                                        'ml-2 px-2 py-0.5 rounded-full text-[9px] align-middle',
                                        qjlTranslationCached
                                          ? 'bg-olive/15 text-olive'
                                          : 'bg-vermilion/10 text-vermilion'
                                      )}
                                    >
                                      {qjlTranslationCached ? '缓存命中' : '新生成'}
                                    </span>
                                  )}
                                </div>
                                <div className="markdown-body text-sm">
                                  <ReactMarkdown>{qjlTranslation}</ReactMarkdown>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    ) : (
                      <ul className="space-y-1">
                        {qjlSectionList.map((s) => (
                          <li key={s.id}>
                            <button
                              type="button"
                              className="w-full text-left px-3 py-2 rounded-xl hover:bg-olive/10 text-olive text-sm"
                              onClick={() => openQjlSection(s.id)}
                            >
                              {s.title}
                            </button>
                          </li>
                        ))}
                        {qjlSectionList.length === 0 && (
                          <p className="text-sm opacity-50 py-8 text-center">该月暂无原文小节</p>
                        )}
                      </ul>
                    )}
                  </div>
                </motion.aside>
              </motion.div>
            )}
          </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-ink/10 py-6 sm:py-8 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center opacity-40 text-xs tracking-widest uppercase font-medium">
        基于清 · 顾禄《清嘉录》 | AI 赋能民俗研究
      </footer>

    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-2.5 sm:px-4 sm:py-2 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 justify-center rounded-full transition-all text-sm font-medium touch-manipulation",
        active ? "bg-white text-olive shadow-sm" : "text-ink/60 hover:text-ink hover:bg-white/50"
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

