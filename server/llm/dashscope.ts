/**
 * 大模型 API 封装（文本 / 图像均通过配置的 URL、模型名、API Key 调用，不写死厂商）
 */

/** 解析 API 返回的 JSON 错误体，返回简短中性提示（避免透传厂商相关文案） */
function parseApiError(errText: string): string | null {
  try {
    const o = JSON.parse(errText);
    const msg = o?.message ?? o?.error ?? o?.error_message;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
    const code = o?.code ?? o?.error_code;
    if (typeof code === 'string') return `错误: ${code}`;
  } catch {
    // 非 JSON 或解析失败则返回 null，由调用方用通用文案
  }
  return null;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 官方 DashScope 文本 API 的 base 为 https://dashscope.aliyuncs.com/api/v1，此处自动补全文本生成路径；
 * 若使用 compatible-mode，则走 OpenAI /chat/completions 协议，不再补路径。 */
function resolveTextApiUrl(textApiUrl: string): { url: string; mode: 'dashscope' | 'openai' } {
  const raw = textApiUrl.trim();
  const base = raw.replace(/\/+$/, '');
  if (base.includes('compatible-mode')) {
    // OpenAI 兼容模式：用户通常配置为 https://dashscope.aliyuncs.com/compatible-mode/v1
    return { url: base + '/chat/completions', mode: 'openai' };
  }
  if (/\/api\/v1\/?$/.test(base)) {
    return {
      url: base.replace(/\/api\/v1\/?$/, '') + '/api/v1/services/aigc/text-generation/generation',
      mode: 'dashscope',
    };
  }
  return { url: raw, mode: raw.includes('compatible-mode') ? 'openai' : 'dashscope' };
}

/** 文本对话。必须传入配置的 textApiUrl 与 model，不写死默认。
 * - 当 URL 为 /api/v1 时，走 DashScope 原生 text-generation 接口
 * - 当 URL 为 /compatible-mode/v1 时，走 OpenAI /chat/completions 协议
 * 可选 responseFormat: 'json_object'，在两种模式下都尽量启用结构化 JSON 输出。 */
export async function dashscopeChat(
  apiKey: string,
  messages: ChatMessage[],
  model: string,
  textApiUrl: string,
  options?: { responseFormat?: 'json_object' }
): Promise<string> {
  const { url, mode } = resolveTextApiUrl(textApiUrl);
  const m = model.trim();
  if (!url) throw new Error('请在大模型配置中填写文本 API 的 URL');
  if (!m) throw new Error('请在大模型配置中填写文本模型名称');

  // OpenAI 兼容模式：/compatible-mode/v1/chat/completions
  if (mode === 'openai') {
    const body: Record<string, unknown> = {
      model: m,
      messages: messages.map((msg) => ({ role: msg.role, content: msg.content })),
    };
    if (options?.responseFormat === 'json_object') {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      const short = parseApiError(err);
      throw new Error(short || `文本 API 调用失败: ${res.status}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      // OpenAI 兼容下 content 也可能是富内容数组，这里仅拼接其中的 text 字段
      return content
        .map((c: unknown) => {
          const cc = c as { type?: string; text?: string };
          return cc.text ?? '';
        })
        .filter(Boolean)
        .join('');
    }
    throw new Error('文本 API 返回格式异常: ' + JSON.stringify(data));
  }

  // DashScope 原生 text-generation 接口
  const body: Record<string, unknown> = {
    model: m,
    input: { messages: messages.map((msg) => ({ role: msg.role, content: msg.content })) },
  };
  if (options?.responseFormat === 'json_object' && url.includes('text-generation')) {
    (body as Record<string, unknown>).parameters = {
      result_format: 'message',
      response_format: { type: 'json_object' },
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`文本 API 调用失败: ${res.status} ${err}`);
  }

  const data = await res.json();
  const text = data?.output?.text ?? data?.output?.choices?.[0]?.message?.content;
  if (text == null) {
    throw new Error('文本 API 返回格式异常: ' + JSON.stringify(data));
  }
  return typeof text === 'string' ? text : (text as { text?: string }[]).map((c) => c.text).filter(Boolean).join('');
}

/** 带 JSON 约束的生成（用于月份结构化数据）。借鉴 Gemini：优先使用接口的 JSON 模式，减少格式漂移与解析失败 */
export async function dashscopeChatJson<T>(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string,
  textApiUrl: string
): Promise<T> {
  const { url: resolvedUrl, mode } = resolveTextApiUrl(textApiUrl);
  const useJsonMode = resolvedUrl.includes('text-generation') || mode === 'openai';
  const content = await dashscopeChat(
    apiKey,
    [
      { role: 'system', content: systemPrompt + (useJsonMode ? '\n\n请只输出合法 JSON。' : '\n\n请只输出合法 JSON，不要包含 markdown 代码块或其它说明。') },
      { role: 'user', content: userPrompt },
    ],
    model,
    textApiUrl,
    useJsonMode ? { responseFormat: 'json_object' } : undefined
  );

  const trimmed = content.replace(/^```json?\s*|\s*```$/g, '').trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch (e) {
    throw new Error('解析大模型返回的 JSON 失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}

/**
 * 文生图：支持两种接口（由 URL 区分）
 * - 千问图像（同步）：URL 含 multimodal-generation，一次返回图片 URL
 * - 万相（异步）：URL 含 image-generation，返回 task_id 后轮询 /api/v1/tasks
 */
export async function dashscopeTextToImage(
  apiKey: string,
  prompt: string,
  options?: { size?: string; n?: number; model?: string; imageApiUrl?: string; tasksApiUrl?: string }
): Promise<string> {
  const imageApiUrl = options?.imageApiUrl?.trim();
  const model = options?.model?.trim();
  if (!imageApiUrl) throw new Error('请在大模型配置中填写图像 API 的 URL');
  if (!model) throw new Error('请在大模型配置中填写图像模型名称');

  // 若为 OpenAI 兼容模式（/compatible-mode/v1），走 /images/generations 协议
  if (imageApiUrl.includes('compatible-mode')) {
    return textToImageOpenAICompatible(apiKey, prompt, imageApiUrl, model, options?.size, options?.n);
  }

  const size = options?.size ?? '1024*1024';
  const n = options?.n ?? 1;
  const looksLikeQwenImage = /qwen-image/i.test(model);
  // 官方文档中 qwen-image 的 URL 常写为 base：https://dashscope.aliyuncs.com/api/v1，此处自动补全文生图路径
  let resolvedImageUrl = imageApiUrl;
  if (looksLikeQwenImage && !imageApiUrl.includes('multimodal-generation') && !imageApiUrl.includes('image-generation')) {
    if (imageApiUrl.includes('compatible-mode')) {
      throw new Error(
        '千问图像模型不能使用 compatible-mode（文本接口）。请将 URL 改为：https://dashscope.aliyuncs.com/api/v1 或完整地址 .../multimodal-generation/generation'
      );
    }
    const base = imageApiUrl.replace(/\/+$/, '');
    if (/\/api\/v1\/?$/.test(base) || base.endsWith('/api/v1')) {
      resolvedImageUrl = base.replace(/\/api\/v1\/?$/, '') + '/api/v1/services/aigc/multimodal-generation/generation';
    }
  }

  const isSyncApi = resolvedImageUrl.includes('multimodal-generation');
  if (isSyncApi) {
    return textToImageSync(apiKey, prompt, resolvedImageUrl, model, size, n);
  }
  return textToImageAsync(apiKey, prompt, resolvedImageUrl, model, size, n, options?.tasksApiUrl?.trim());
}

/** OpenAI 兼容模式的文生图：/compatible-mode/v1/images/generations，直接返回 base64 */
async function textToImageOpenAICompatible(
  apiKey: string,
  prompt: string,
  baseUrl: string,
  model: string,
  size?: string,
  n?: number
): Promise<string> {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '');
  const url = normalizedBase + '/images/generations';
  const body: Record<string, unknown> = {
    model,
    prompt,
    n: n ?? 1,
    size: size ?? '1024x1024',
    response_format: 'b64_json',
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    const short = parseApiError(err);
    throw new Error(short || `图像 API 调用失败: ${res.status}`);
  }

  const data = await res.json();
  const first = data?.data?.[0];
  const b64 = first?.b64_json;
  if (!b64 || typeof b64 !== 'string') {
    throw new Error('图像 API 返回格式异常，未包含 b64_json: ' + JSON.stringify(data));
  }
  return b64;
}

/** 千问图像同步接口：multimodal-generation，响应中直接返回 output.choices[0].message.content[0].image */
async function textToImageSync(
  apiKey: string,
  prompt: string,
  imageApiUrl: string,
  model: string,
  size: string,
  n: number
): Promise<string> {
  const res = await fetch(imageApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: {
        messages: [{ role: 'user', content: [{ text: prompt }] }],
      },
      parameters: { size, n },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    const short = parseApiError(err);
    throw new Error(short || `图像 API 调用失败: ${res.status}`);
  }

  const data = await res.json();
  const code = data?.code;
  if (code) {
    const msg = data?.message ?? code;
    throw new Error(typeof msg === 'string' ? msg : `图像 API 返回错误: ${code}`);
  }

  const content = data?.output?.choices?.[0]?.message?.content;
  const firstImage = Array.isArray(content) ? content.find((c: { image?: string }) => c?.image) : content?.[0];
  const imageUrl = firstImage?.image;
  if (!imageUrl || typeof imageUrl !== 'string') {
    throw new Error('图像 API 返回格式异常，未包含图片: ' + JSON.stringify(data));
  }

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error('拉取图片失败');
  const buf = await imgRes.arrayBuffer();
  return Buffer.from(buf).toString('base64');
}

/** 万相异步接口：image-generation，返回 task_id 后轮询 /api/v1/tasks */
async function textToImageAsync(
  apiKey: string,
  prompt: string,
  imageApiUrl: string,
  model: string,
  size: string,
  n: number,
  tasksApiUrl?: string
): Promise<string> {
  let tasksBase = tasksApiUrl?.trim();
  if (!tasksBase) {
    try {
      const u = new URL(imageApiUrl);
      tasksBase = `${u.origin}/api/v1/tasks`;
    } catch {
      throw new Error('图像 API URL 格式无效');
    }
  }

  const res = await fetch(imageApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model,
      input: {
        messages: [{ role: 'user', content: [{ text: prompt }] }],
      },
      parameters: {
        n,
        size,
        enable_interleave: true,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    const short = parseApiError(err);
    throw new Error(short || `图像 API 调用失败: ${res.status}`);
  }

  const data = await res.json();
  const taskId = data?.output?.task_id ?? data?.task_id;
  if (!taskId) {
    throw new Error('未返回 task_id: ' + JSON.stringify(data));
  }

  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const taskRes = await fetch(`${tasksBase}/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!taskRes.ok) throw new Error(`查询任务失败: ${taskRes.status}`);
    const taskData = await taskRes.json();
    const rawStatus = taskData?.output?.task_status ?? taskData?.task_status ?? taskData?.status ?? '';
    const status = String(rawStatus).toUpperCase();
    if (i === 0) {
      console.log('[image] 轮询 task_id=', taskId, 'status=', rawStatus);
    }
    if (status === 'SUCCEEDED' || status === 'SUCCESS') {
      const out = taskData?.output ?? taskData;
      const resList = out?.results ?? taskData?.results ?? [];
      const first = Array.isArray(resList) ? resList.find((r: { url?: string; b64_image?: string }) => r?.url || r?.b64_image) : resList[0];
      if (first?.url) {
        const imgRes = await fetch(first.url);
        if (!imgRes.ok) throw new Error('拉取图片失败');
        const buf = await imgRes.arrayBuffer();
        return Buffer.from(buf).toString('base64');
      }
      if (first?.b64_image) return first.b64_image;
      if (resList[0]?.url) {
        const imgRes = await fetch(resList[0].url);
        if (!imgRes.ok) throw new Error('拉取图片失败');
        const buf = await imgRes.arrayBuffer();
        return Buffer.from(buf).toString('base64');
      }
      if (resList[0]?.b64_image) return resList[0].b64_image;
      throw new Error('任务成功但无图片数据: ' + JSON.stringify(taskData));
    }
    if (status === 'FAILED' || status === 'ERROR') {
      const msg = taskData?.output?.message ?? taskData?.message ?? taskData?.output?.code ?? JSON.stringify(taskData);
      throw new Error('图像任务失败: ' + msg);
    }
  }
  throw new Error('图像任务超时');
}
