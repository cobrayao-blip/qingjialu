import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BookOpen,
  Loader2,
  Save,
  Download,
  ChevronLeft,
  ChevronRight,
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
  deletePictureBook,
  regeneratePictureBookPageImage,
  updatePictureBookPages,
  verifyPictureBookTopicGrounded,
  type PictureBook,
  type PictureBookPage,
  type PictureBookGenerateSource,
} from '../services/api';
import { useMediaQuery } from '../hooks/useMediaQuery';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 翻页动画时长（毫秒） */
const FLIP_DURATION_MS = 800;
/** 翻页结束到开始朗读的额外缓冲时间（毫秒），让画面完全稳定 */
const FLIP_READ_BUFFER_MS = 400;
const FLIP_SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/2047/2047-preview.mp3';

export interface PictureBookViewProps {
  /** 从习俗卡片「生成绘本」带入的主题（一句话） */
  initialTopic?: string;
  /** 从习俗卡片进入时附带月份与习俗名，用于后端锚定《清嘉录》原文小节 */
  initialCardSource?: PictureBookGenerateSource;
}

export default function PictureBookView(props?: PictureBookViewProps) {
  const { initialTopic, initialCardSource } = props ?? {};
  const [topic, setTopic] = useState('');
  /** 与 initialCardSource 同步；用户修改灵感文案与卡片预设不一致时清空，改走灵感聚合路径 */
  const [cardSource, setCardSource] = useState<PictureBookGenerateSource | null>(null);
  const anchorTopicRef = useRef('');
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
  /** 小屏：「我的绘本」改为全屏底部抽屉，避免挤压主内容 */
  const bookshelfAsOverlay = useMediaQuery('(max-width: 767px)');
  /** 小屏 / 减少动效：翻页用淡入淡出，避免 3D rotateY 引起整页闪动 */
  const simplePageFlip = useMediaQuery('(max-width: 767px), (prefers-reduced-motion: reduce)');
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

  // 习俗卡片传入的主题：同步到输入框
  useEffect(() => {
    if (initialTopic != null && String(initialTopic).trim()) {
      setTopic(String(initialTopic).trim());
    }
  }, [initialTopic]);

  useEffect(() => {
    setCardSource(initialCardSource ?? null);
  }, [initialCardSource]);

  useEffect(() => {
    anchorTopicRef.current =
      initialTopic != null && String(initialTopic).trim() ? String(initialTopic).trim() : '';
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
    setStatus('正在对照《清嘉录》原文…');
    const ground = await verifyPictureBookTopicGrounded(t);
    if (ground.grounded === false) {
      setStatus('');
      setError(ground.message);
      return;
    }
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
      const book = await apiGenerate(t, true, cardSource ?? undefined);
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

  useEffect(() => {
    if (!showMyBooks || !bookshelfAsOverlay) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [showMyBooks, bookshelfAsOverlay]);

  const bookshelfList = (
    <>
      <div className="flex items-center justify-between mb-3 shrink-0 border-b border-ink/10 pb-3">
        <h3 className="serif text-lg font-bold text-olive">我的绘本</h3>
        <button
          type="button"
          onClick={() => setShowMyBooks(false)}
          className="p-2.5 rounded-full hover:bg-ink/5 text-ink/60 touch-manipulation min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="关闭"
        >
          {bookshelfAsOverlay ? <X size={22} /> : <ChevronLeft size={20} />}
        </button>
      </div>
      {savedList.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-8 min-h-[12rem]">
          <p className="text-ink/50 text-sm">绘本空空如也，快去创作吧</p>
        </div>
      ) : (
        <ul className="space-y-1 overflow-y-auto flex-1 min-h-0 overscroll-contain -mx-1 px-1">
          {savedList.map((item) => (
            <li key={item.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  setViewingId(item.id ?? null);
                  if (bookshelfAsOverlay) setShowMyBooks(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setViewingId(item.id ?? null);
                    if (bookshelfAsOverlay) setShowMyBooks(false);
                  }
                }}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-3 py-3 rounded-lg text-left transition-colors touch-manipulation min-h-[48px]',
                  viewingId === item.id ? 'bg-olive/10 text-olive' : 'hover:bg-ink/5 active:bg-ink/10',
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
                    } catch (err) {
                      alert(err instanceof Error ? err.message : '删除失败');
                    }
                  }}
                  className="p-2 rounded-full hover:bg-ink/10 text-ink/40 hover:text-vermilion/80 touch-manipulation shrink-0"
                  aria-label="删除绘本"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <div className="flex flex-col sm:flex-row gap-6 min-h-0">
      <audio ref={audioRef} className="hidden" />
      {/* 左侧 / 小屏全屏：我的绘本 */}
      <AnimatePresence>
        {showMyBooks && bookshelfAsOverlay && (
          <motion.div
            key="bookshelf-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] flex flex-col justify-end"
            role="presentation"
          >
            <button
              type="button"
              className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]"
              aria-label="关闭我的绘本"
              onClick={() => setShowMyBooks(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 360 }}
              className="relative z-[1] mx-auto w-full max-w-lg max-h-[min(88dvh,800px)] flex flex-col rounded-t-[24px] border border-ink/10 bg-paper px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink/15 shrink-0" aria-hidden />
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{bookshelfList}</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showMyBooks && !bookshelfAsOverlay && (
          <motion.aside
            key="bookshelf-inline"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'min(280px, calc(100vw - 1.5rem))', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'tween', duration: 0.2 }}
            className="shrink-0 overflow-hidden border-r border-ink/10 bg-white/50 rounded-2xl card-shadow max-w-[min(280px,calc(100vw-1.5rem))]"
          >
            <div className="flex h-full min-h-[min(400px,55dvh)] w-full min-w-0 flex-col p-4">{bookshelfList}</div>
          </motion.aside>
        )}
      </AnimatePresence>

      <div className="flex-1 min-w-0 space-y-6">
        {/* 小屏纵向堆叠（标题 → 我的绘本），避免三列 grid 下中间 auto 与左右列重叠；sm+ 仍为左键 | 中标题 | 右留白 */}
        <div className="flex w-full flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-start sm:gap-4">
          <div className="min-w-0 w-full text-center sm:col-start-2 sm:row-start-1 sm:mx-auto sm:w-max sm:max-w-[min(100vw-8rem,42rem)] sm:justify-self-center">
            <h2 className="serif text-2xl sm:text-4xl md:text-5xl font-bold tracking-tight text-olive mb-2 sm:mb-3 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
              <BookOpen className="shrink-0" size={28} />
              <span className="break-words">苏州民俗绘本</span>
            </h2>
            <p className="serif text-sm sm:text-lg text-ink/60 italic px-1">
              一句话，绘出姑苏繁华梦
            </p>
          </div>
          <div className="flex w-full shrink-0 justify-start sm:col-start-1 sm:row-start-1 sm:w-auto sm:min-w-0">
            <button
              type="button"
              onClick={() => setShowMyBooks((v) => !v)}
              className="flex max-w-full items-center gap-1.5 sm:gap-2 text-olive text-sm sm:text-base font-medium hover:opacity-80 touch-manipulation min-h-[44px] rounded-lg px-1"
            >
              <RotateCcw className="shrink-0" size={18} />
              <span className="truncate">
                我的绘本 (<span className="tabular-nums">{savedList.length}</span>)
              </span>
            </button>
          </div>
          <div className="hidden min-w-0 sm:col-start-3 sm:row-start-1 sm:block" aria-hidden="true" />
        </div>

        {/* 生成区 */}
        <div className="mx-auto w-full max-w-2xl rounded-[24px] border border-ink/5 bg-white p-4 card-shadow sm:rounded-[32px] sm:p-6">
          <label htmlFor="topic-input" className="mb-2 ml-0.5 block text-sm font-semibold uppercase tracking-widest text-olive/80">
            输入您的灵感
          </label>
          <div className="relative flex flex-col gap-3 sm:block">
            <div className="rounded-2xl border border-ink/10 bg-paper/50 ring-1 ring-ink/5 focus-within:border-olive focus-within:ring-olive/20 sm:pr-[9.5rem]">
              <textarea
                id="topic-input"
                value={topic}
                onChange={(e) => {
                  const v = e.target.value;
                  setTopic(v);
                  // 已带 sectionId 时保留卡片来源：剧本仍锚定该条原文，允许用户改灵感文案
                  if (
                    cardSource &&
                    !cardSource.sectionId &&
                    v.trim() !== anchorTopicRef.current.trim()
                  ) {
                    setCardSource(null);
                  }
                }}
                placeholder="一句话描述想看的民俗场景，如端午竞渡、轧神仙…"
                rows={3}
                enterKeyHint="go"
                autoComplete="off"
                spellCheck={false}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    if (!generating && topic.trim()) void handleGenerate();
                  }
                }}
                className="max-h-[40dvh] min-h-[6.75rem] w-full resize-y rounded-2xl border-0 bg-transparent px-4 py-3.5 text-base leading-relaxed text-ink placeholder:text-ink/35 focus:outline-none touch-manipulation sm:min-h-[3.5rem] sm:max-h-52 sm:resize-none sm:py-3"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generating || !topic.trim()}
              className={cn(
                'inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-olive px-5 font-medium text-white touch-manipulation disabled:cursor-not-allowed disabled:opacity-50 sm:absolute sm:right-2 sm:top-1/2 sm:mt-0 sm:min-h-[2.75rem] sm:w-auto sm:-translate-y-1/2 sm:px-4',
                generating ? 'bg-ink/20 text-ink/60' : 'hover:bg-olive/90',
              )}
            >
              {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles size={18} />}
              <span>生成绘本</span>
            </button>
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

              <div className="p-4 sm:p-6 border-b border-ink/5 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
                <h3 className="serif text-xl sm:text-2xl font-bold text-olive min-w-0 break-words">{currentBook.title}</h3>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {currentBook && (
                    <button
                      type="button"
                      onClick={handleExportMp4}
                      disabled={exportingMp4 || generating}
                      className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2 rounded-full border border-ink/10 bg-white hover:bg-paper disabled:opacity-50 text-xs sm:text-sm touch-manipulation min-h-[40px]"
                      title="导出为可发布的 MP4 视频"
                    >
                      {exportingMp4 ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
                      导出MP4
                    </button>
                  )}
                  {generated && (
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving}
                      className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-2 rounded-full bg-olive text-white hover:opacity-90 disabled:opacity-50 text-xs sm:text-sm touch-manipulation min-h-[40px]"
                    >
                      {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                      保存
                    </button>
                  )}
                  {viewingId != null && (
                    <button
                      type="button"
                      onClick={() => { setViewingId(null); setViewingBook(null); }}
                      className="p-2.5 rounded-full hover:bg-ink/5 touch-manipulation min-h-[40px] min-w-[40px] flex items-center justify-center"
                      aria-label="关闭绘本"
                    >
                      <X size={20} />
                    </button>
                  )}
                </div>
              </div>

              {totalPages > 0 && (
                <>
                  <div className="min-h-[min(440px,58dvh)] flex items-center justify-center bg-paper/50 p-4 sm:p-6 md:p-8">
                    <div className="max-w-4xl w-full mx-auto">
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                          key={pageIndex}
                          initial={simplePageFlip ? { opacity: 0 } : { opacity: 0, rotateY: 90, transformOrigin: 'left' }}
                          animate={simplePageFlip ? { opacity: 1 } : { opacity: 1, rotateY: 0 }}
                          exit={simplePageFlip ? { opacity: 0 } : { opacity: 0, rotateY: -90 }}
                          transition={{
                            duration: simplePageFlip ? 0.2 : FLIP_DURATION_MS / 1000,
                            ease: 'easeInOut',
                          }}
                          className="flex flex-col md:flex-row gap-8 md:gap-12 items-center"
                          style={simplePageFlip ? undefined : { perspective: '1000px' }}
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
                  <div className="bg-paper/50 border-t border-ink/5 py-3 px-3 sm:py-4 sm:px-4 flex items-center justify-between gap-2 sm:gap-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    <button
                      type="button"
                      onClick={() => flipToPage(pageIndex, Math.max(0, pageIndex - 1), { userInitiated: true })}
                      disabled={pageIndex === 0}
                      className="flex items-center gap-1 sm:gap-2 text-olive text-sm sm:text-base font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-80 transition-opacity touch-manipulation min-h-[44px] min-w-[44px] sm:min-w-0 px-1 rounded-lg"
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
                      type="button"
                      onClick={() => flipToPage(pageIndex, Math.min(totalPages - 1, pageIndex + 1), { userInitiated: true })}
                      disabled={pageIndex >= totalPages - 1}
                      className="flex items-center gap-1 sm:gap-2 text-olive text-sm sm:text-base font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-80 transition-opacity touch-manipulation min-h-[44px] min-w-[44px] sm:min-w-0 px-1 rounded-lg"
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
