import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BookOpen,
  Loader2,
  Save,
  Download,
  ChevronLeft,
  ChevronRight,
  Library,
  Sparkles,
  X,
  Volume2,
  Square,
  RotateCcw,
  Trash2,
  ImageOff,
  Wand2,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  generatePictureBook as apiGenerate,
  listPictureBooks,
  getPictureBook,
  savePictureBook,
  getPictureBookTts,
  exportPictureBookMp4 as apiExportMp4,
  getStructuredMonthData,
  deletePictureBook,
  regeneratePictureBookPageImage,
  updatePictureBookPages,
  type PictureBook,
  type PictureBookPage,
  type MonthData,
} from '../services/api';
import { MONTHS, INITIAL_HIGHLIGHTS } from '../constants';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SUGGESTED_TOPICS = ['行春与摸春牛', '闹元宵', '轧神仙', '端午竞渡', '荷花生日', '中秋赏月'];

/** 翻页动画时长（毫秒） */
const FLIP_DURATION_MS = 800;
/** 翻页结束到开始朗读的额外缓冲时间（毫秒），让画面完全稳定 */
const FLIP_READ_BUFFER_MS = 400;
const FLIP_SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/2047/2047-preview.mp3';

/** 将月份民俗数据格式化为给大模型的参考文案 */
function formatFolkloreContext(data: MonthData): string {
  const lines: string[] = [`【${data.month}】${data.summary}`];
  data.customs?.forEach((c) => {
    lines.push(`习俗：${c.name} — ${c.description}`);
  });
  return lines.join('\n');
}

export interface PictureBookViewProps {
  /** 从时令页「一键带入」的参考月份 */
  initialReferenceMonth?: string;
  /** 从习俗卡片「生成绘本」带入的主题（一句话） */
  initialTopic?: string;
}

export default function PictureBookView(props?: PictureBookViewProps) {
  const { initialReferenceMonth, initialTopic } = props ?? {};
  const [topic, setTopic] = useState('');
  const [referenceMonth, setReferenceMonth] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState('');
  const [generated, setGenerated] = useState<PictureBook | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedList, setSavedList] = useState<Omit<PictureBook, 'pages'>[]>([]);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [viewingBook, setViewingBook] = useState<PictureBook | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [loadingVoice, setLoadingVoice] = useState(false);
  /** 当前绘本每页的 TTS 音频 data URL，按页索引缓存 */
  const [pageAudioUrls, setPageAudioUrls] = useState<string[]>([]);
  const [showMyBooks, setShowMyBooks] = useState(false);
  const [isAutoReading, setIsAutoReading] = useState(false);
  const [exportingMp4, setExportingMp4] = useState(false);
  /** 正在重新生成插图的页索引，null 表示空闲 */
  const [regeneratingImagePage, setRegeneratingImagePage] = useState<number | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoReadingRef = useRef(false);
  const internalPageChangeRef = useRef(false);
  const pageAudioUrlsRef = useRef<string[]>([]);
  pageAudioUrlsRef.current = pageAudioUrls;

  const playFlipSound = () => {
    try {
      const flipAudio = new Audio(FLIP_SOUND_URL);
      flipAudio.volume = 0.4;
      flipAudio.play().catch(() => {
        // 部分浏览器可能拦截自动播放，静默忽略
      });
    } catch {
      // 创建 audio 失败时静默忽略
    }
  };

  const loadList = async () => {
    try {
      const list = await listPictureBooks();
      setSavedList(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载列表失败');
    }
  };

  useEffect(() => {
    loadList();
  }, []);

  // 时令页传入的月份：同步到「参考民俗」下拉框
  useEffect(() => {
    if (initialReferenceMonth && MONTHS.includes(initialReferenceMonth as (typeof MONTHS)[number])) {
      setReferenceMonth(initialReferenceMonth);
    }
  }, [initialReferenceMonth]);

  // 习俗卡片传入的主题：同步到输入框
  useEffect(() => {
    if (initialTopic != null && String(initialTopic).trim()) {
      setTopic(String(initialTopic).trim());
    }
  }, [initialTopic]);

  useEffect(() => {
    if (viewingId == null) {
      setViewingBook(null);
      setPageIndex(0);
      return;
    }
    getPictureBook(viewingId).then(setViewingBook).catch(() => setViewingBook(null));
    setPageIndex(0);
  }, [viewingId]);

  const handleGenerate = async () => {
    const t = topic.trim();
    if (!t) {
      setError('请用一句话描述你想看的民俗');
      return;
    }
    setError(null);
    setGenerating(true);
    setStatus('正在构思绘本故事…');
    if (statusTimerRef.current != null) {
      window.clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    statusTimerRef.current = window.setTimeout(() => {
      setStatus('故事已构思完成，正在为您绘制插图…');
    }, 2000);
    setGenerated(null);
    try {
      let folkloreContext: string | undefined;
      if (referenceMonth) {
        // 与时令页一致：优先按原文抽取的 MonthData，失败再用静态兜底
        let data: MonthData | null = await getStructuredMonthData(referenceMonth);
        if (!data && INITIAL_HIGHLIGHTS[referenceMonth as keyof typeof INITIAL_HIGHLIGHTS]) {
          data = INITIAL_HIGHLIGHTS[referenceMonth as keyof typeof INITIAL_HIGHLIGHTS] as MonthData;
        }
        if (data) folkloreContext = formatFolkloreContext(data);
      }
      const book = await apiGenerate(t, true, folkloreContext);
      setGenerated(book);
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败，请稍后再试');
    } finally {
      if (statusTimerRef.current != null) {
        window.clearTimeout(statusTimerRef.current);
        statusTimerRef.current = null;
      }
      setGenerating(false);
      setStatus('');
    }
  };

  const handleSave = async () => {
    if (!generated) return;
    setSaving(true);
    setError(null);
    try {
      const { id } = await savePictureBook({
        title: generated.title,
        topic: generated.topic,
        pages: generated.pages,
      });
      const saved = { ...generated, id, createdAt: new Date().toISOString() };
      setSavedList((prev) => [saved, ...prev]);
      setGenerated(null);
      setTopic('');
      setViewingId(id);
      setViewingBook(saved);
      setShowMyBooks(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const currentBook = viewingBook ?? generated;
  const currentPage = currentBook?.pages?.[pageIndex];
  const totalPages = currentBook?.pages?.length ?? 0;

  // 当前绘本变化时，重置每页 TTS 缓存（避免不同绘本之间复用旧音频）
  useEffect(() => {
    const n = currentBook?.pages?.length ?? 0;
    setPageAudioUrls(new Array(n).fill(''));
  }, [viewingId, generated?.topic, currentBook?.pages?.length]);

  const stopAudio = () => {
    autoReadingRef.current = false;
    setIsAutoReading(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    setIsSpeaking(false);
  };

  /** 播放一段 data URL 音频，播完或出错时 resolve；返回是否正常播完 */
  const playAudioAndWait = (dataUrl: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!audioRef.current) {
        resolve(false);
        return;
      }
      const audio = audioRef.current;
      audio.pause();
      audio.src = dataUrl;
      const onEnd = () => {
        audio.onended = null;
        audio.onerror = null;
        resolve(true);
      };
      const onErr = () => {
        audio.onended = null;
        audio.onerror = null;
        resolve(false);
      };
      audio.onended = onEnd;
      audio.onerror = onErr;
      audio.play().then(() => setIsSpeaking(true)).catch(onErr);
    });
  };

  const playAudioDataUrl = (dataUrl: string) => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.src = dataUrl;
    audioRef.current.onended = () => setIsSpeaking(false);
    audioRef.current.onerror = () => setIsSpeaking(false);
    audioRef.current.play().then(() => setIsSpeaking(true)).catch(() => setIsSpeaking(false));
  };

  /** 翻页动画：从 fromIndex 翻到 toIndex，翻页完成后 resolve
   *  options.userInitiated 为 true 时表示用户手动操作（上一页 / 下一页），需要打断自动朗读
   *  效果参考 szmshb：通过 framer-motion 的 rotateY 实现翻页，代码层只需等待固定时长
   */
  const flipToPage = (
    fromIndex: number,
    toIndex: number,
    options?: { userInitiated?: boolean }
  ): Promise<void> => {
    if (fromIndex === toIndex) return Promise.resolve();
    if (options?.userInitiated) {
      // 用户主动翻页：立即停止自动朗读与自动翻页
      stopAudio();
      internalPageChangeRef.current = false;
    } else {
      // 自动浏览内部翻页：标记为内部变更，避免触发 stopAudio 的副作用
      internalPageChangeRef.current = true;
    }
    playFlipSound();
    setPageIndex(toIndex);
    // 与 szmshb 一致：直接依赖 framer-motion 的 rotateY 动画，这里等待动画 + 额外缓冲
    return new Promise((resolve) => {
      window.setTimeout(() => {
        resolve();
      }, FLIP_DURATION_MS + FLIP_READ_BUFFER_MS);
    });
  };

  const startAutoRead = async (startIndex: number) => {
    const book = currentBook;
    const pages = book?.pages;
    if (!pages?.length) return;
    autoReadingRef.current = true;
    setIsAutoReading(true);
    let currentIdx = startIndex;
    for (let i = startIndex; i < pages.length && autoReadingRef.current; i++) {
      if (i > startIndex) {
        await flipToPage(currentIdx, i);
        if (!autoReadingRef.current) break;
        currentIdx = i;
      }
      const page = pages[i];
      let url: string | null = null;
      if (page.audioBase64?.trim()) {
        url = `data:audio/wav;base64,${page.audioBase64.trim()}`;
      } else {
        url = pageAudioUrlsRef.current[i] || null;
      }
      if (!url && page.text?.trim()) {
        setLoadingVoice(true);
        try {
          const dataUrl = await getPictureBookTts(page.text);
          if (dataUrl) {
            url = dataUrl;
            setPageAudioUrls((prev) => {
              const next = [...prev];
              if (next[i] === '') next[i] = dataUrl;
              return next;
            });
          }
        } finally {
          setLoadingVoice(false);
        }
      }
      if (!url) continue;
      const ok = await playAudioAndWait(url);
      if (!ok || !autoReadingRef.current) break;
      currentIdx = i;
    }
    autoReadingRef.current = false;
    setIsAutoReading(false);
    setIsSpeaking(false);
  };

  const handleVoicePlay = async () => {
    if (isSpeaking || isAutoReading) {
      stopAudio();
      return;
    }
    if (!currentBook?.pages?.length) return;
    await startAutoRead(pageIndex);
  };

  const applyPagesToCurrentBook = (newPages: PictureBookPage[]) => {
    if (viewingId != null && viewingBook) {
      setViewingBook({ ...viewingBook, pages: newPages });
    } else if (generated) {
      setGenerated({ ...generated, pages: newPages });
    }
  };

  const handleRegeneratePageImage = async () => {
    const book = currentBook;
    const page = book?.pages?.[pageIndex];
    if (!book || !page?.text?.trim() || regeneratingImagePage != null) return;
    setError(null);
    setRegeneratingImagePage(pageIndex);
    try {
      const imageBase64 = await regeneratePictureBookPageImage({
        topic: book.topic,
        text: page.text.trim(),
        imagePrompt: page.imagePrompt,
      });
      const newPages = book.pages.map((p, i) =>
        i === pageIndex ? { ...p, imageBase64 } : p
      );
      applyPagesToCurrentBook(newPages);
      if (viewingId != null) {
        await updatePictureBookPages(viewingId, newPages);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '插图生成失败，请稍后再试');
    } finally {
      setRegeneratingImagePage(null);
    }
  };

  const handleExportMp4 = async () => {
    if (!currentBook?.pages?.length || exportingMp4) return;
    setError(null);
    setExportingMp4(true);
    try {
      const { blob, filename } = await apiExportMp4({
        title: currentBook.title,
        pages: currentBook.pages,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出 MP4 失败');
    } finally {
      setExportingMp4(false);
    }
  };

  useEffect(() => {
    if (internalPageChangeRef.current) {
      internalPageChangeRef.current = false;
      return;
    }
    stopAudio();
  }, [pageIndex, viewingId, generated?.topic]);

  // 后台预生成当前绘本各页语音（参考 szmshb）
  useEffect(() => {
    if (!currentBook?.pages?.length || generating) return;
    const pages = currentBook.pages;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < pages.length && !cancelled; i++) {
        const text = pages[i]?.text?.trim();
        if (!text) continue;
        try {
          const dataUrl = await getPictureBookTts(text);
          if (cancelled || !dataUrl) continue;
          setPageAudioUrls((prev) => {
            const next = [...prev];
            if (prev.length === pages.length && next[i] === '') next[i] = dataUrl;
            return next;
          });
        } catch {
          // 单页失败不影响其余页
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentBook?.pages, generating, currentBook?.topic]);

  return (
    <div className="flex flex-col sm:flex-row gap-6 min-h-0">
      <audio ref={audioRef} className="hidden" />
      {/* 左侧：我的绘本（参考「我的画廊」） */}
      <AnimatePresence>
        {showMyBooks && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'tween', duration: 0.2 }}
            className="shrink-0 overflow-hidden border-r border-ink/10 bg-white/50 rounded-2xl card-shadow"
          >
            <div className="w-[280px] h-full min-h-[400px] flex flex-col p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="serif text-lg font-bold text-olive">我的绘本</h3>
                <button
                  type="button"
                  onClick={() => setShowMyBooks(false)}
                  className="p-2 rounded-full hover:bg-ink/5 text-ink/60"
                  aria-label="收起"
                >
                  <ChevronLeft size={20} />
                </button>
              </div>
              {savedList.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-8">
                  <p className="text-ink/50 text-sm">绘本空空如也，快去创作吧</p>
                </div>
              ) : (
                <ul className="space-y-1 overflow-y-auto flex-1">
                  {savedList.map((item) => (
                    <li key={item.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setViewingId(item.id ?? null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setViewingId(item.id ?? null);
                          }
                        }}
                        className={cn(
                          "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left transition-colors",
                          viewingId === item.id
                            ? "bg-olive/10 text-olive"
                            : "hover:bg-ink/5"
                        )}
                      >
                        <div className="min-w-0">
                          <div className="font-medium truncate">{item.title}</div>
                          <div className="text-xs opacity-60 mt-0.5">{item.createdAt?.slice(0, 10)}</div>
                        </div>
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!item.id) return;
                            if (!window.confirm('确定要删除这本绘本吗？')) return;
                            try {
                              await deletePictureBook(item.id);
                              setSavedList((prev) => prev.filter((b) => b.id !== item.id));
                              if (viewingId === item.id) {
                                setViewingId(null);
                                setViewingBook(null);
                                setPageIndex(0);
                              }
                            } catch (e) {
                              alert(e instanceof Error ? e.message : '删除失败');
                            }
                          }}
                          className="p-1.5 rounded-full hover:bg-ink/10 text-ink/40 hover:text-vermilion/80"
                          aria-label="删除绘本"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <div className="flex-1 min-w-0 space-y-6">
        {/* 右上：我的绘本 入口 + 标题区 */}
        <div className="flex items-start justify-between gap-4">
          <button
            type="button"
            onClick={() => setShowMyBooks((v) => !v)}
            className="flex items-center gap-2 text-olive font-medium hover:opacity-80 shrink-0"
          >
            <RotateCcw size={18} />
            我的绘本 ({savedList.length})
          </button>
          <div className="text-center flex-1 min-w-0">
            <h2 className="serif text-4xl md:text-5xl font-bold tracking-tight text-olive mb-3 flex items-center justify-center gap-3">
              <BookOpen size={32} />
              苏州民俗绘本
            </h2>
            <p className="serif text-lg text-ink/60 italic">
              一句话，绘出姑苏繁华梦
            </p>
          </div>
          <div className="w-[120px] shrink-0" />
        </div>

        {/* 生成区：参考 szmshb，卡片收窄、单行输入+内嵌按钮 */}
        <div className="w-full max-w-2xl mx-auto bg-white p-6 rounded-[32px] card-shadow border border-ink/5">
          <label htmlFor="topic-input" className="block text-sm font-semibold uppercase tracking-widest text-olive/80 mb-2 ml-1">
            输入您的灵感
          </label>
          <div className="relative">
            <input
              id="topic-input"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例如：端午节伍子胥祭祀、七夕乞巧、冬至大如年..."
              className="w-full bg-paper/50 border border-ink/10 rounded-2xl pl-4 pr-28 py-3 text-base placeholder:text-ink/30 focus:outline-none focus:ring-2 focus:ring-olive/20 transition-all"
              onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
            />
            <button
              onClick={handleGenerate}
              disabled={generating || !topic.trim()}
              className={cn(
                "absolute right-2 top-2 bottom-2 bg-olive text-white px-5 rounded-xl font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all",
                generating ? "bg-ink/20 text-ink/60" : "hover:bg-olive/90"
              )}
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles size={18} />}
              <span>生成</span>
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs opacity-60">参考民俗（可选）：</span>
            <select
              value={referenceMonth}
              onChange={(e) => setReferenceMonth(e.target.value)}
              className="text-sm px-3 py-1.5 rounded-xl border border-ink/10 bg-white"
            >
              <option value="">不参考</option>
              {MONTHS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {SUGGESTED_TOPICS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTopic(t)}
                className="text-xs px-3 py-1.5 rounded-full border border-ink/10 hover:border-olive hover:text-olive transition-colors"
              >
                {t}
              </button>
            ))}
          </div>
          {error && (
            <p className="mt-3 text-sm text-vermilion">{error}</p>
          )}
        </div>

        {/* 生成中状态：移到输入框外，参考 szmshb 在下方单独显示 */}
        <AnimatePresence mode="wait">
          {generating && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-16 gap-4"
            >
              <div className="relative">
                <Loader2 className="w-12 h-12 text-olive animate-spin" />
              </div>
              <p className="text-olive font-medium animate-pulse">
                {status || '正在为您绘制姑苏画卷…'}
              </p>
            </motion.div>
          )}

        {/* 当前绘本阅读器（生成结果 或 已保存详情） */}
          {currentBook && !generating && (
            <motion.div
              key={viewingId ?? 'generated'}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white rounded-[32px] card-shadow border border-ink/5 overflow-hidden"
            >
              {/* 顶部进度条 */}
              {totalPages > 0 && (
                <div className="h-1 w-full bg-ink/5 flex">
                  {currentBook.pages.map((_, i) => (
                    <div
                      // eslint-disable-next-line react/no-array-index-key
                      key={i}
                      className={cn(
                        "h-full transition-all duration-500",
                        i <= pageIndex ? "bg-olive" : "bg-transparent"
                      )}
                      style={{ width: `${100 / totalPages}%` }}
                    />
                  ))}
                </div>
              )}

              <div className="p-6 border-b border-ink/5 flex justify-between items-center">
                <h3 className="serif text-2xl font-bold text-olive">{currentBook.title}</h3>
                <div className="flex items-center gap-2">
                  {currentBook && (
                    <button
                      onClick={handleExportMp4}
                      disabled={exportingMp4 || generating}
                      className="flex items-center gap-2 px-5 py-2 rounded-full border border-ink/10 bg-white hover:bg-paper disabled:opacity-50"
                      title="导出为可发布的 MP4 视频"
                    >
                      {exportingMp4 ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
                      导出MP4
                    </button>
                  )}
                  {generated && (
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex items-center gap-2 px-5 py-2 rounded-full bg-olive text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                      保存
                    </button>
                  )}
                  {viewingId != null && (
                    <button
                      onClick={() => { setViewingId(null); setViewingBook(null); }}
                      className="p-2 rounded-full hover:bg-ink/5"
                    >
                      <X size={20} />
                    </button>
                  )}
                </div>
              </div>

              {totalPages > 0 && (
                <>
                  <div className="min-h-[440px] flex items-center justify-center bg-paper/50 p-6 md:p-8">
                    <div className="max-w-4xl w-full mx-auto">
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                          key={pageIndex}
                          initial={{ opacity: 0, rotateY: 90, transformOrigin: 'left' }}
                          animate={{ opacity: 1, rotateY: 0 }}
                          exit={{ opacity: 0, rotateY: -90 }}
                          transition={{ duration: FLIP_DURATION_MS / 1000, ease: 'easeInOut' }}
                          className="flex flex-col md:flex-row gap-8 md:gap-12 items-center"
                          style={{ perspective: '1000px' }}
                        >
                          {/* 图片区域：左图 */}
                          <div className="w-full md:w-1/2 relative">
                            <div className="aspect-[4/3] w-full overflow-hidden rounded-[24px] border-4 border-paper shadow-lg bg-white">
                              {currentPage?.imageBase64 ? (
                                <img
                                  src={`data:image/png;base64,${currentPage.imageBase64}`}
                                  alt={currentPage.title || ''}
                                  className="w-full h-full object-cover"
                                />
                              ) : generating ? (
                                <div className="w-full h-full min-h-[200px] flex items-center justify-center bg-paper">
                                  <Loader2 className="w-8 h-8 text-olive/40 animate-spin" />
                                </div>
                              ) : (
                                <div className="w-full h-full min-h-[200px] flex flex-col items-center justify-center gap-4 bg-paper px-6 py-8 text-center">
                                  <ImageOff className="w-12 h-12 text-ink/25" aria-hidden />
                                  <p className="text-sm text-ink/55 leading-relaxed max-w-xs">
                                    本页插图未生成（图像接口偶发失败或限流时会出现）。可点击下方按钮重试，不影响文字与朗读。
                                  </p>
                                  <button
                                    type="button"
                                    onClick={handleRegeneratePageImage}
                                    disabled={regeneratingImagePage === pageIndex}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-olive/40 text-olive text-sm font-medium hover:bg-olive/10 disabled:opacity-50"
                                  >
                                    {regeneratingImagePage === pageIndex ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <Wand2 className="w-4 h-4" />
                                    )}
                                    重新生成插图
                                  </button>
                                </div>
                              )}
                            </div>
                            <div className="absolute -top-3 -left-3 w-9 h-9 rounded-full bg-olive text-white flex items-center justify-center text-sm font-bold shadow-md">
                              {pageIndex + 1}
                            </div>
                          </div>

                          {/* 文本区域：右文 */}
                          <div className="w-full md:w-1/2 text-left space-y-2">
                            <div className="space-y-1 mb-3">
                              <span className="text-olive/60 text-xs font-bold uppercase tracking-[0.2em]">
                                姑苏风华录 · 其{['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][pageIndex] || '一'}
                              </span>
                              {currentPage?.title && (
                                <h3 className="serif text-2xl md:text-3xl font-bold text-olive leading-tight">
                                  {currentPage.title}
                                </h3>
                              )}
                            </div>
                            <div className="h-px w-10 bg-ink/10 mb-4" />
                            <p className="serif text-lg md:text-xl text-ink/80 leading-relaxed italic min-h-[120px]">
                              {currentPage?.text}
                            </p>
                            {currentPage?.text && (
                              <button
                                type="button"
                                onClick={handleVoicePlay}
                                disabled={loadingVoice}
                                className={cn(
                                  'mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-full border transition-all text-sm font-medium relative',
                                  isSpeaking || isAutoReading
                                    ? 'bg-vermilion text-white border-vermilion'
                                    : 'bg-white border-ink/10 hover:border-olive text-olive',
                                  loadingVoice && 'opacity-70'
                                )}
                                title={
                                  isSpeaking || isAutoReading
                                    ? '停止朗读'
                                    : pageAudioUrls[pageIndex]
                                    ? '语音朗读（从本页起自动翻页朗读）'
                                    : '生成并朗读'
                                }
                              >
                                {loadingVoice ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : isSpeaking || isAutoReading ? (
                                  <Square size={14} fill="currentColor" />
                                ) : (
                                  <Volume2 size={14} />
                                )}
                                <span>
                                  {loadingVoice
                                    ? '正在生成…'
                                    : isSpeaking || isAutoReading
                                    ? '停止朗读'
                                    : '语音朗读'}
                                </span>
                                {pageAudioUrls[pageIndex] && !isSpeaking && !isAutoReading && !loadingVoice && (
                                  <span
                                    className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full"
                                    title="语音已就绪"
                                  />
                                )}
                              </button>
                            )}
                          </div>
                        </motion.div>
                      </AnimatePresence>
                    </div>
                  </div>
                  {/* 底部导航：上一页 / 页码与圆点 / 下一页（与 szmshb 一致，避免侧栏打开时按钮被挡或压住文字） */}
                  <div className="bg-paper/50 border-t border-ink/5 py-4 px-4 flex items-center justify-between gap-4">
                    <button
                      onClick={() => flipToPage(pageIndex, Math.max(0, pageIndex - 1), { userInitiated: true })}
                      disabled={pageIndex === 0}
                      className="flex items-center gap-2 text-olive font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-80 transition-opacity"
                    >
                      <ChevronLeft size={20} />
                      <span>上一页</span>
                    </button>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-ink/70">
                        {pageIndex + 1} / {totalPages}
                      </span>
                      <div className="flex gap-1.5">
                        {currentBook.pages.map((_, i) => (
                          <span
                            key={i}
                            className={cn(
                              "w-2 h-2 rounded-full transition-all",
                              i === pageIndex ? "bg-olive scale-110" : "bg-olive/30"
                            )}
                          />
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => flipToPage(pageIndex, Math.min(totalPages - 1, pageIndex + 1), { userInitiated: true })}
                      disabled={pageIndex >= totalPages - 1}
                      className="flex items-center gap-2 text-olive font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-80 transition-opacity"
                    >
                      <span>下一页</span>
                      <ChevronRight size={20} />
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* 结尾引用语——借鉴 szmshb */}
        {currentBook && totalPages > 0 && (
          <div className="text-center pt-4 pb-2">
            <p className="serif text-base sm:text-lg text-ink/40 italic">
              “君到姑苏见，人家尽枕河。”
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
