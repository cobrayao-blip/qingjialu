import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Loader2,
  Save,
  CheckCircle,
  XCircle,
  Eye,
  EyeOff,
  X,
  Type,
  Image as ImageIcon,
  Volume2,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  getLlmConfig,
  saveLlmConfig,
  testLlmConnection,
  testLlmConnectionImage,
  testLlmConnectionTts,
  type LlmConfigForDisplay,
} from '../services/api';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const PROVIDERS = [
  { id: 'dashscope', name: '阿里千问 / 万相' },
  { id: 'baidu', name: '百度文心' },
  { id: 'doubao', name: '豆包' },
] as const;

const DEFAULT_URLS: Record<string, { text: string; image: string; tts: string }> = {
  dashscope: {
    text: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
    // 图像模型默认使用官方 base，后端会根据模型名自动补全文生图路径
    image: 'https://dashscope.aliyuncs.com/api/v1',
    tts: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  },
  baidu: {
    text: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions',
    image: '',
    tts: '',
  },
  doubao: {
    text: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    image: '',
    tts: '',
  },
};

interface LLMConfigModalProps {
  open: boolean;
  onClose: () => void;
  /** 管理员 JWT */
  adminToken: string;
}

type TabId = 'text' | 'image' | 'tts';

export function LLMConfigModal({ open, onClose, adminToken }: LLMConfigModalProps) {
  const tok = adminToken.trim();
  const [config, setConfig] = useState<LlmConfigForDisplay | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>('text');

  const [providerText, setProviderText] = useState('dashscope');
  const [modelText, setModelText] = useState('');
  const [urlText, setUrlText] = useState('');
  const [apiKeyText, setApiKeyText] = useState('');
  const [showApiKeyText, setShowApiKeyText] = useState(false);

  const [providerImage, setProviderImage] = useState('dashscope');
  const [modelImage, setModelImage] = useState('');
  const [urlImage, setUrlImage] = useState('');
  const [apiKeyImage, setApiKeyImage] = useState('');
  const [showApiKeyImage, setShowApiKeyImage] = useState(false);

  const [providerTts, setProviderTts] = useState('dashscope');
  const [modelTts, setModelTts] = useState('');
  const [urlTts, setUrlTts] = useState('');
  const [voiceTts, setVoiceTts] = useState('');
  const [apiKeyTts, setApiKeyTts] = useState('');
  const [showApiKeyTts, setShowApiKeyTts] = useState(false);

  const [savingText, setSavingText] = useState(false);
  const [savingImage, setSavingImage] = useState(false);
  const [testingText, setTestingText] = useState(false);
  const [testingImage, setTestingImage] = useState(false);
  const [testResultText, setTestResultText] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testResultImage, setTestResultImage] = useState<{ ok: boolean; error?: string } | null>(null);
  const [saveMessageText, setSaveMessageText] = useState<string | null>(null);
  const [saveMessageImage, setSaveMessageImage] = useState<string | null>(null);
  const [savingTts, setSavingTts] = useState(false);
  const [testingTts, setTestingTts] = useState(false);
  const [testResultTts, setTestResultTts] = useState<{ ok: boolean; error?: string } | null>(null);
  const [saveMessageTts, setSaveMessageTts] = useState<string | null>(null);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const c = await getLlmConfig(tok);
      setConfig(c);
      setProviderText(c.text.provider || 'dashscope');
      setModelText(c.text.model || '');
      setUrlText(c.text.url || '');
      // 不清空 apiKey 输入状态，由下方 value 用 config.text.apiKeyMasked 脱敏显示
      setApiKeyText('');
      setProviderImage(c.image.provider || 'dashscope');
      setModelImage(c.image.model || '');
      setUrlImage(c.image.url || '');
      setApiKeyImage('');
      setProviderTts(c.tts?.provider ?? 'dashscope');
      setModelTts(c.tts?.model ?? '');
      setUrlTts(c.tts?.url ?? '');
      setVoiceTts(c.tts?.voice ?? '');
      setApiKeyTts('');
    } catch {
      setConfig(null);
    } finally {
      setLoading(false);
    }
  };

  // 文本模型 API Key 显示值：用户正在输入时用输入内容，否则用配置中的脱敏值
  const apiKeyTextDisplay = apiKeyText.trim()
    ? apiKeyText
    : (config?.text?.apiKeyMasked && config.text.apiKeyMasked !== '未配置' ? config.text.apiKeyMasked : '');
  const apiKeyImageDisplay = apiKeyImage.trim()
    ? apiKeyImage
    : (config?.image?.apiKeyMasked && config.image.apiKeyMasked !== '未配置' ? config.image.apiKeyMasked : '');
  const apiKeyTtsDisplay = apiKeyTts.trim()
    ? apiKeyTts
    : (config?.tts?.apiKeyMasked && config.tts.apiKeyMasked !== '未配置' ? config.tts.apiKeyMasked : '');

  useEffect(() => {
    if (open && tok) loadConfig();
  }, [open, tok]);

  const needKeyText = !apiKeyText.trim() && (!config?.text?.apiKeyMasked || config.text.apiKeyMasked === '未配置');
  const needKeyImage = !apiKeyImage.trim() && (!config?.image?.apiKeyMasked || config.image.apiKeyMasked === '未配置');
  const needKeyTts = !apiKeyTts.trim() && (!config?.tts?.apiKeyMasked || config.tts.apiKeyMasked === '未配置');

  const handleSaveText = async () => {
    setSavingText(true);
    setSaveMessageText(null);
    setTestResultText(null);
    try {
      const newKeyText = apiKeyText.trim();
      const isNewKey = newKeyText && newKeyText !== config?.text?.apiKeyMasked;
      await saveLlmConfig(tok, {
        text: {
          provider: providerText,
          model: modelText.trim() || undefined,
          url: urlText.trim() || undefined,
          apiKey: isNewKey ? newKeyText : undefined,
        },
      });
      setSaveMessageText('文本模型配置已保存');
      setApiKeyText('');
      await loadConfig();
      setTimeout(() => setSaveMessageText(null), 2000);
    } catch (e) {
      setSaveMessageText(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSavingText(false);
    }
  };

  const handleSaveImage = async () => {
    setSavingImage(true);
    setSaveMessageImage(null);
    setTestResultImage(null);
    try {
      const newKeyImage = apiKeyImage.trim();
      const isNewKeyImage = newKeyImage && newKeyImage !== config?.image?.apiKeyMasked;
      await saveLlmConfig(tok, {
        image: {
          provider: providerImage,
          model: modelImage.trim() || undefined,
          url: urlImage.trim() || undefined,
          apiKey: isNewKeyImage ? newKeyImage : undefined,
        },
      });
      setSaveMessageImage('图像模型配置已保存');
      setApiKeyImage('');
      await loadConfig();
      setTimeout(() => setSaveMessageImage(null), 2000);
    } catch (e) {
      setSaveMessageImage(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSavingImage(false);
    }
  };

  const handleTestText = async () => {
    if (needKeyText) {
      setTestResultText({ ok: false, error: '请先填写或保存 API Key' });
      return;
    }
    setTestingText(true);
    setTestResultText(null);
    try {
      const result = await testLlmConnection(
        tok,
        apiKeyText.trim() || undefined,
        modelText.trim() || undefined,
        urlText.trim() || undefined
      );
      setTestResultText(result);
    } catch (e) {
      setTestResultText({ ok: false, error: e instanceof Error ? e.message : '请求失败' });
    } finally {
      setTestingText(false);
    }
  };

  const handleTestImage = async () => {
    if (needKeyImage) {
      setTestResultImage({ ok: false, error: '请先填写或保存 API Key' });
      return;
    }
    setTestingImage(true);
    setTestResultImage(null);
    try {
      const result = await testLlmConnectionImage(
        tok,
        apiKeyImage.trim() || undefined,
        modelImage.trim() || undefined,
        urlImage.trim() || undefined
      );
      setTestResultImage(result);
    } catch (e) {
      setTestResultImage({ ok: false, error: e instanceof Error ? e.message : '请求失败' });
    } finally {
      setTestingImage(false);
    }
  };

  const handleSaveTts = async () => {
    setSavingTts(true);
    setSaveMessageTts(null);
    setTestResultTts(null);
    try {
      const newKeyTts = apiKeyTts.trim();
      const isNewKey = newKeyTts && newKeyTts !== config?.tts?.apiKeyMasked;
      await saveLlmConfig(tok, {
        tts: {
          provider: providerTts,
          model: modelTts.trim() || undefined,
          url: urlTts.trim() || undefined,
          voice: voiceTts.trim() || undefined,
          apiKey: isNewKey ? newKeyTts : undefined,
        },
      });
      setSaveMessageTts('语音模型配置已保存');
      setApiKeyTts('');
      await loadConfig();
      setTimeout(() => setSaveMessageTts(null), 2000);
    } catch (e) {
      setSaveMessageTts(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSavingTts(false);
    }
  };

  const handleTestTts = async () => {
    if (needKeyTts) {
      setTestResultTts({ ok: false, error: '请先填写或保存 API Key' });
      return;
    }
    setTestingTts(true);
    setTestResultTts(null);
    try {
      const result = await testLlmConnectionTts(
        tok,
        apiKeyTts.trim() || undefined,
        modelTts.trim() || undefined,
        urlTts.trim() || undefined,
        voiceTts.trim() || undefined
      );
      setTestResultTts(result);
    } catch (e) {
      setTestResultTts({ ok: false, error: e instanceof Error ? e.message : '请求失败' });
    } finally {
      setTestingTts(false);
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          className="relative w-full max-w-2xl max-h-[90dvh] overflow-y-auto overscroll-contain bg-white rounded-[32px] card-shadow border border-ink/10"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 bg-white border-b border-ink/10 rounded-t-[32px] z-10">
            <div className="px-6 py-4 flex items-center justify-between">
              <h2 className="serif text-2xl font-bold text-olive">大模型配置</h2>
              <button type="button" onClick={onClose} className="p-2 rounded-full hover:bg-ink/5" aria-label="关闭">
                <X size={24} />
              </button>
            </div>
            <nav className="flex border-t border-ink/5">
              <button
                type="button"
                onClick={() => setTab('text')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors',
                  tab === 'text' ? 'bg-olive/10 text-olive border-b-2 border-olive' : 'text-ink/60 hover:text-ink'
                )}
              >
                <Type size={18} />
                文本模型
              </button>
              <button
                type="button"
                onClick={() => setTab('image')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors',
                  tab === 'image' ? 'bg-vermilion/10 text-vermilion border-b-2 border-vermilion' : 'text-ink/60 hover:text-ink'
                )}
              >
                <ImageIcon size={18} />
                图像模型
              </button>
              <button
                type="button"
                onClick={() => setTab('tts')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors',
                  tab === 'tts' ? 'bg-sky-500/10 text-sky-600 border-b-2 border-sky-500' : 'text-ink/60 hover:text-ink'
                )}
              >
                <Volume2 size={18} />
                语音模型
              </button>
            </nav>
          </div>

          <div className="p-6">
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="animate-spin text-olive" size={32} />
              </div>
            ) : (
              <>
                <p className="text-sm text-ink/60 mb-4">配置与测试结果分别保存，数据持久化在本地数据库中。</p>

                <AnimatePresence mode="wait">
                  {tab === 'text' && (
                    <motion.div
                      key="text"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 8 }}
                      className="p-5 rounded-2xl border-2 border-olive/20 bg-paper/30 space-y-4"
                    >
                      <div className="flex items-center gap-2 text-olive font-bold">
                        <Type size={20} />
                        文本模型
                      </div>
                      <p className="text-xs text-ink/60">用于：解析、时令数据、绘本剧本等。</p>
                      <div>
                        <label className="block text-xs font-medium text-olive/80 mb-1">厂商选择</label>
                        <select
                          value={providerText}
                          onChange={(e) => {
                            setProviderText(e.target.value);
                            const def = DEFAULT_URLS[e.target.value as keyof typeof DEFAULT_URLS];
                            if (def?.text) setUrlText(def.text);
                          }}
                          className="w-full px-4 py-2.5 rounded-xl border border-ink/10 focus:outline-none focus:border-olive text-sm"
                        >
                          {PROVIDERS.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-olive/80 mb-1">模型名称</label>
                        <input
                          type="text"
                          value={modelText}
                          onChange={(e) => setModelText(e.target.value)}
                          placeholder="如 qwen-plus、qwen-turbo 等"
                          className="w-full px-4 py-2.5 rounded-xl border border-ink/10 focus:outline-none focus:border-olive text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-olive/80 mb-1">URL（可默认）</label>
                        <input
                          type="url"
                          value={urlText}
                          onChange={(e) => setUrlText(e.target.value)}
                          placeholder="输入文本 API 的完整 URL"
                          className="w-full px-4 py-2.5 rounded-xl border border-ink/10 focus:outline-none focus:border-olive text-sm"
                        />
                        <p className="text-xs text-ink/50 mt-1">
                          默认使用 <code className="bg-ink/5 px-1 rounded">https://dashscope.aliyuncs.com/compatible-mode/v1</code>
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-olive/80 mb-1">API Key（脱敏显示）</label>
                        <div className="relative">
                          <input
                            type={apiKeyText.trim() ? (showApiKeyText ? 'text' : 'password') : 'text'}
                            value={apiKeyTextDisplay}
                            onChange={(e) => setApiKeyText(e.target.value)}
                            onFocus={(e) => {
                              const v = e.target.value;
                              if (config?.text?.apiKeyMasked && v === config.text.apiKeyMasked) setApiKeyText('');
                            }}
                            placeholder={apiKeyTextDisplay ? '' : '输入 API Key'}
                            className="w-full px-4 py-2.5 pr-10 rounded-xl border border-ink/10 focus:outline-none focus:border-olive text-sm"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKeyText((v) => !v)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-ink/50 hover:text-ink"
                          >
                            {showApiKeyText ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleTestText}
                          disabled={testingText || needKeyText}
                          className={cn(
                            'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-olive text-olive',
                            (testingText || needKeyText) && 'opacity-60'
                          )}
                        >
                          {testingText ? <Loader2 className="animate-spin" size={16} /> : null}
                          连接测试
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveText}
                          disabled={savingText}
                          className={cn(
                            'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-olive text-white',
                            savingText && 'opacity-60'
                          )}
                        >
                          {savingText ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                          保存
                        </button>
                      </div>
                      {testResultText && (
                        <div className={cn(
                          'flex items-center gap-2 p-3 rounded-xl text-sm',
                          testResultText.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
                        )}>
                          {testResultText.ok ? <CheckCircle size={18} /> : <XCircle size={18} />}
                          {testResultText.ok ? '连接成功' : testResultText.error}
                        </div>
                      )}
                      {saveMessageText && (
                        <div className="flex items-center gap-2 p-3 rounded-xl text-sm bg-olive/10 text-olive">
                          <CheckCircle size={18} />
                          {saveMessageText}
                        </div>
                      )}
                    </motion.div>
                  )}

                  {tab === 'image' && (
                    <motion.div
                      key="image"
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      className="p-5 rounded-2xl border-2 border-vermilion/20 bg-paper/30 space-y-4"
                    >
                      <div className="flex items-center gap-2 text-vermilion font-bold">
                        <ImageIcon size={20} />
                        图像模型
                      </div>
                      <p className="text-xs text-ink/60">用于：绘本插图生成。</p>
                      <div>
                        <label className="block text-xs font-medium text-vermilion/80 mb-1">厂商选择</label>
                        <select
                          value={providerImage}
                          onChange={(e) => {
                            setProviderImage(e.target.value);
                            const def = DEFAULT_URLS[e.target.value as keyof typeof DEFAULT_URLS];
                            if (def?.image) setUrlImage(def.image);
                          }}
                          className="w-full px-4 py-2.5 rounded-xl border border-ink/10 focus:outline-none focus:border-vermilion text-sm"
                        >
                          {PROVIDERS.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-vermilion/80 mb-1">模型名称</label>
                        <input
                          type="text"
                          value={modelImage}
                          onChange={(e) => setModelImage(e.target.value)}
                          placeholder="万相如 wan2.6-image；千问图像如 qwen-image-2.0、qwen-image-2.0-pro"
                          className="w-full px-4 py-2.5 rounded-xl border border-ink/10 focus:outline-none focus:border-vermilion text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-vermilion/80 mb-1">URL（必填完整地址）</label>
                        <input
                          type="url"
                          value={urlImage}
                          onChange={(e) => setUrlImage(e.target.value)}
                          placeholder="输入图像 API 的完整 URL"
                          className="w-full px-4 py-2.5 rounded-xl border border-ink/10 focus:outline-none focus:border-vermilion text-sm"
                        />
                        <p className="text-xs text-ink/50 mt-1">
                          默认 URL：<code className="bg-ink/5 px-1 rounded">https://dashscope.aliyuncs.com/api/v1</code>
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-vermilion/80 mb-1">API Key（脱敏显示）</label>
                        <div className="relative">
                          <input
                            type={apiKeyImage.trim() ? (showApiKeyImage ? 'text' : 'password') : 'text'}
                            value={apiKeyImageDisplay}
                            onChange={(e) => setApiKeyImage(e.target.value)}
                            onFocus={(e) => {
                              const v = e.target.value;
                              if (config?.image?.apiKeyMasked && v === config.image.apiKeyMasked) setApiKeyImage('');
                            }}
                            placeholder={apiKeyImageDisplay ? '' : '输入 API Key'}
                            className="w-full px-4 py-2.5 pr-10 rounded-xl border border-ink/10 focus:outline-none focus:border-vermilion text-sm"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKeyImage((v) => !v)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-ink/50 hover:text-ink"
                          >
                            {showApiKeyImage ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleTestImage}
                          disabled={testingImage || needKeyImage}
                          className={cn(
                            'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-vermilion text-vermilion',
                            (testingImage || needKeyImage) && 'opacity-60'
                          )}
                        >
                          {testingImage ? <Loader2 className="animate-spin" size={16} /> : null}
                          连接测试
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveImage}
                          disabled={savingImage}
                          className={cn(
                            'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-vermilion text-white',
                            savingImage && 'opacity-60'
                          )}
                        >
                          {savingImage ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                          保存
                        </button>
                      </div>
                      {testResultImage && (
                        <div className={cn(
                          'flex items-center gap-2 p-3 rounded-xl text-sm',
                          testResultImage.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
                        )}>
                          {testResultImage.ok ? <CheckCircle size={18} /> : <XCircle size={18} />}
                          {testResultImage.ok ? '连接成功' : testResultImage.error}
                        </div>
                      )}
                      {saveMessageImage && (
                        <div className="flex items-center gap-2 p-3 rounded-xl text-sm bg-olive/10 text-olive">
                          <CheckCircle size={18} />
                          {saveMessageImage}
                        </div>
                      )}
                    </motion.div>
                  )}

                  {tab === 'tts' && (
                    <motion.div
                      key="tts"
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      className="p-5 rounded-2xl border-2 border-sky-500/20 bg-paper/30 space-y-4"
                    >
                      <div className="flex items-center gap-2 text-sky-600 font-bold">
                        <Volume2 size={20} />
                        语音模型（TTS）
                      </div>
                      <p className="text-xs text-ink/60">用于：绘本页语音朗读。推荐阿里千问 TTS（qwen3-tts-flash）。</p>
                      <div>
                        <label className="block text-xs font-medium text-sky-600/80 mb-1">厂商选择</label>
                        <select
                          value={providerTts}
                          onChange={(e) => {
                            setProviderTts(e.target.value);
                            const def = DEFAULT_URLS[e.target.value as keyof typeof DEFAULT_URLS];
                            if (def?.tts) setUrlTts(def.tts);
                          }}
                          className="w-full px-4 py-2.5 rounded-xl border border-ink/10 focus:outline-none focus:border-sky-500 text-sm"
                        >
                          {PROVIDERS.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-sky-600/80 mb-1">模型名称</label>
                        <input
                          type="text"
                          value={modelTts}
                          onChange={(e) => setModelTts(e.target.value)}
                          placeholder="如 qwen3-tts-flash"
                          className="w-full px-4 py-2.5 rounded-xl border border-ink/10 focus:outline-none focus:border-sky-500 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-sky-600/80 mb-1">朗读风格提示（prompt，可选）</label>
                        <input
                          type="text"
                          value={voiceTts}
                          onChange={(e) => setVoiceTts(e.target.value)}
                          placeholder="例如：请用温柔、富有感情的语调朗读，语速适中，适合给儿童讲绘本。"
                          className="w-full px-4 py-2.5 rounded-xl border border-ink/10 focus:outline-none focus:border-sky-500 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-sky-600/80 mb-1">URL（可默认）</label>
                        <input
                          type="url"
                          value={urlTts}
                          onChange={(e) => setUrlTts(e.target.value)}
                          placeholder="语音合成 API 的完整 URL"
                          className="w-full px-4 py-2.5 rounded-xl border border-ink/10 focus:outline-none focus:border-sky-500 text-sm"
                        />
                        <p className="text-xs text-ink/50 mt-1">
                          默认 URL：<code className="bg-ink/5 px-1 rounded">https://dashscope.aliyuncs.com/api/v1</code>
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-sky-600/80 mb-1">API Key（脱敏显示）</label>
                        <div className="relative">
                          <input
                            type={apiKeyTts.trim() ? (showApiKeyTts ? 'text' : 'password') : 'text'}
                            value={apiKeyTtsDisplay}
                            onChange={(e) => setApiKeyTts(e.target.value)}
                            onFocus={(e) => {
                              const v = e.target.value;
                              if (config?.tts?.apiKeyMasked && v === config.tts.apiKeyMasked) setApiKeyTts('');
                            }}
                            placeholder={apiKeyTtsDisplay ? '' : '输入 API Key'}
                            className="w-full px-4 py-2.5 pr-10 rounded-xl border border-ink/10 focus:outline-none focus:border-sky-500 text-sm"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKeyTts((v) => !v)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-ink/50 hover:text-ink"
                          >
                            {showApiKeyTts ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleTestTts}
                          disabled={testingTts || needKeyTts}
                          className={cn(
                            'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-sky-500 text-sky-600',
                            (testingTts || needKeyTts) && 'opacity-60'
                          )}
                        >
                          {testingTts ? <Loader2 className="animate-spin" size={16} /> : null}
                          连接测试
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveTts}
                          disabled={savingTts}
                          className={cn(
                            'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-sky-500 text-white',
                            savingTts && 'opacity-60'
                          )}
                        >
                          {savingTts ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                          保存
                        </button>
                      </div>
                      {testResultTts && (
                        <div className={cn(
                          'flex items-center gap-2 p-3 rounded-xl text-sm',
                          testResultTts.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
                        )}>
                          {testResultTts.ok ? <CheckCircle size={18} /> : <XCircle size={18} />}
                          {testResultTts.ok ? '连接成功' : testResultTts.error}
                        </div>
                      )}
                      {saveMessageTts && (
                        <div className="flex items-center gap-2 p-3 rounded-xl text-sm bg-olive/10 text-olive">
                          <CheckCircle size={18} />
                          {saveMessageTts}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {config?.updatedAt && (
                  <p className="text-xs text-ink/50 mt-4">上次更新：{config.updatedAt}</p>
                )}
              </>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
