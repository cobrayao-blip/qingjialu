/**
 * 大模型 API Key：文本与图像可分别配置，优先用数据库，否则环境变量
 */

import { getLlmConfig } from './db';
import { env } from './env';

function keyFromEnv(): string {
  return env.DASHSCOPE_API_KEY || '';
}

export function getDashScopeApiKeyText(): string {
  const row = getLlmConfig();
  if (row?.api_key_text?.trim()) return row.api_key_text.trim();
  if (row?.api_key?.trim()) return row.api_key.trim();
  return keyFromEnv();
}

export function getDashScopeApiKeyImage(): string {
  const row = getLlmConfig();
  if (row?.api_key_image?.trim()) return row.api_key_image.trim();
  if (row?.api_key?.trim()) return row.api_key.trim();
  return keyFromEnv();
}

export function getDashScopeApiKeyTts(): string {
  const row = getLlmConfig();
  if (row?.api_key_tts?.trim()) return row.api_key_tts.trim();
  if (row?.api_key?.trim()) return row.api_key.trim();
  return keyFromEnv();
}

export function getDashScopeApiKey(): string {
  return getDashScopeApiKeyText();
}

export function requireDashScope(): string {
  const key = getDashScopeApiKeyText();
  if (!key) {
    throw new Error('请先在「大模型配置」→ 文本模型中填写 API Key');
  }
  return key;
}

export function requireDashScopeImage(): string {
  const key = getDashScopeApiKeyImage();
  if (!key) {
    throw new Error('请先在「大模型配置」→ 图像模型中填写 API Key');
  }
  return key;
}

export function requireDashScopeTts(): string {
  const key = getDashScopeApiKeyTts();
  if (!key) {
    throw new Error('请先在「大模型配置」→ 语音模型中填写 API Key');
  }
  return key;
}
