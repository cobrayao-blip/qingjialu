/**
 * 绘本 TTS：基于配置的语音合成（如阿里 DashScope 千问 TTS）。
 * 不再使用微软 Edge-TTS。
 */

export interface TtsConfig {
  url: string;
  model: string;
  apiKey: string;
  /** 朗读风格提示，将作为 instructions 传给 qwen3-tts-instruct-flash */
  instructions?: string;
}

// 默认使用 DashScope 官方 base，实际调用时会自动补全为 TTS 接口路径
const DEFAULT_TTS_URL = 'https://dashscope.aliyuncs.com/api/v1';
// 使用支持 instructions 的模型，方便通过 prompt 控制朗读风格
const DEFAULT_MODEL = 'qwen3-tts-instruct-flash';
const MAX_TEXT_LENGTH = 2000;

/**
 * 调用配置的 TTS 服务合成语音，返回 base64 编码的音频（通常为 WAV）。
 * 若文本为空、超长或合成失败，返回 null。
 */
export async function generatePictureBookSpeech(
  text: string,
  config: TtsConfig
): Promise<{ audioBase64: string; mimeType: string } | null> {
  const trimmed = (text || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  const toSpeak = trimmed.slice(0, MAX_TEXT_LENGTH);
  const base = (config.url || DEFAULT_TTS_URL).trim();
  // 若仅配置为 https://dashscope.aliyuncs.com/api/v1，则自动补全文生语音接口路径
  const url = /\/api\/v1\/?$/.test(base)
    ? base.replace(/\/api\/v1\/?$/, '') + '/api/v1/services/aigc/multimodal-generation/generation'
    : base;
  const apiKey = (config.apiKey || '').trim();
  if (!url || !apiKey) return null;

  const model = (config.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const instructions = (config.instructions || '').trim();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: {
          text: toSpeak,
          language_type: 'Chinese',
        },
        ...(instructions
          ? {
              instructions,
              optimize_instructions: true,
            }
          : {}),
      }),
    });
    const data = (await res.json()) as {
      output?: { audio?: { url?: string; data?: string } };
      code?: string;
      message?: string;
    };
    if (!res.ok) {
      console.error('[TTS] API error:', res.status, data?.message ?? data?.code);
      return null;
    }
    const audioUrl = data?.output?.audio?.url;
    const audioDataBase64 = data?.output?.audio?.data;
    if (audioDataBase64 && typeof audioDataBase64 === 'string') {
      return { audioBase64: audioDataBase64, mimeType: 'audio/wav' };
    }
    if (audioUrl && typeof audioUrl === 'string') {
      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) {
        console.error('[TTS] Failed to fetch audio URL:', audioRes.status);
        return null;
      }
      const buf = await audioRes.arrayBuffer();
      const base64 = Buffer.from(buf).toString('base64');
      const contentType = audioRes.headers.get('content-type') || 'audio/wav';
      const mimeType = contentType.includes('mp3') ? 'audio/mpeg' : 'audio/wav';
      return { audioBase64: base64, mimeType };
    }
    console.warn('[TTS] No audio url or data in response');
    return null;
  } catch (e) {
    console.error('[TTS] generatePictureBookSpeech error:', e);
    return null;
  }
}
