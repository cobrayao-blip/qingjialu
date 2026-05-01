import { requireDashScope, requireDashScopeImage, requireDashScopeTts } from './llmConfig';
import { getLlmConfig } from './db';
import { dashscopeChatJson, dashscopeTextToImage } from './llm/dashscope';
import type { PictureBookPage } from './types';
import { generatePictureBookSpeech } from './tts';

const SCRIPT_PROMPT_BASE = `你是一位精通古代苏州民俗的专业儿童绘本作家。根据用户的一句话输入，创作一部关于古代苏州民间风俗的儿童绘本故事。

总体风格要求：
1. 故事氛围要温柔、诗意，适合亲子共读，带一点古典书卷气。
2. 场景围绕古代苏州（姑苏城）、河巷街巷、节令习俗、服饰器物等元素展开，注意体现苏州“白墙黛瓦、小桥流水”的独特风貌。
3. 插图风格需统一，偏“传统中国水墨画或工笔画风格”，古色古香，但色彩柔和不压抑。
4. 请整体遵循“起、承、转、合”的叙事节奏，三页之间要有连续的情节起伏，而不是三张互不关联的民俗明信片。

文字构思与内容细节（非常重要）：
1. 故事请默认以“一个苏州本地孩子”的第一人称或紧贴孩子视角来叙述（例如“我”和家人、伙伴的所见所感），三页共用同一个主角，增强代入感。
2. 每一页的 "description" 是 1～2 句完整的中文句子（总字数大约 40～120 字），需要适合朗读，有节奏感。
3. 三页之间要形成“起、承、转、合”的简单叙事弧线，例如：第一页引出节日或民俗背景与主角期待；第二页写主角参与的具体活动、高潮或小冲突；第三页收束在温馨的结尾、家人间的互动或对传统的理解与传承。
4. 每一页的文字中，至少要出现一种“声音”或“气味”的描写，用来增强感官体验，例如：钟声、评弹、爆竹声、桂花糕的甜香、雨后青石板的泥土气等，也可以加入少量触觉描写（如绸缎的光滑、石板的冰凉）。
5. 句子中请自然包含：时间（季节或时辰）＋地点（苏州相关场景）＋环境景物＋人物身份或年龄（如“深闺女儿们”“孩童”“船夫”等）＋人物动作（如“陈设瓜果”“争相摸春牛”等）＋情绪或期待。
6. 语体以现代白话为主，点缀少量古意词汇和四字短语，不要使用生僻艰深的文言，不要写成学术说明或知识讲解。特别注意：不要让每一句话都以相同结构的四字短语开头（如连续多句以“四字词＋的＋名词”起句），要让句子开头形式多样，自然流畅。
7. 避免在不同页面中反复使用同一组意象或套话，比如“粉墙黛瓦”“暮色四合”等，要为每一页设计新鲜的画面；如需描写苏州城墙与民居，请优先使用“白墙黛瓦”等更贴近苏州的表达。
8. 不要直接解释习俗知识或典故来源，而是通过具体场景和细节，让读者从画面和人物体验中自然而然体会民俗气氛。
9. 尽量让句子在朗读时有起伏和收束，例如用逗号分节，最后一句收在一个带画面感的意象上。

（不再给出具体示范句，请根据上述要求自行创作，不要模仿固定模板。）

输出格式与结构要求：
1. 只输出一个 JSON 数组，不要任何 markdown、注释或额外文字。
2. 数组长度必须为 3（固定三页故事，不多不少），三页需要组成一个完整的短篇故事，而不是三段互不关联的描写。
3. 数组中的每个元素为一个对象，字段如下：
   - "title": "该页标题，简短有力，富有古意。"
   - "description": "1～2 句优美、富有诗意的中文，遵循上述“文字构思与内容细节”的要求，注意角色视角与三页情节连贯。"
   - "imagePrompt": "用于生成插图的英文提示词，建议是较长的一句英文，详细描述画面内容、环境、人物、光影与构图，突出 ancient Suzhou scenery 和 traditional Chinese painting style，同时在英文中提示季节和光影变化（如 early spring soft light, winter solstice warm sunlight），注意与 description 形成互补关系：适当留白，不要把所有细节都写进文字里。"

JSON 示例（注意实际生成时不要输出注释）：
[
  {
    "title": "迎春摸春牛",
    "description": "正月里，苏州城的郡守带着乡民出娄门迎春，孩童们争相摸春牛，盼来一岁平安丰收。",
    "imagePrompt": "children touching a clay spring ox outside the Suzhou city gate in early spring, ancient Suzhou scenery, traditional Chinese hanfu clothing, gentle warm morning light, river and city walls in the background, traditional Chinese painting style, delicate brushwork, soft colors, elegant atmosphere"
  }
]`;

function buildScriptPrompt(topic: string, folkloreContext?: string): string {
  let prompt = SCRIPT_PROMPT_BASE;
  if (folkloreContext && folkloreContext.trim()) {
    prompt += `\n\n【以下为《清嘉录》民俗参考，请结合其内容创作】\n${folkloreContext.trim()}\n\n`;
  }
  prompt += `\n用户的一句话（主题）：${topic}\n请根据以上主题创作：`;
  return prompt;
}

// 统一的图像风格前缀，融合中英文描述，借鉴 szmshb 的增强 prompt
const IMAGE_STYLE =
  '中国传统水墨画或工笔画风格，中国风绘本插画，柔和色彩，适合儿童，古典苏州民俗场景，无文字。' +
  '苏州民居请画成白墙黛瓦、小桥流水的江南风格，不要画成粉色或彩色外墙。' +
  '\n' +
  'Traditional Chinese painting style, ancient Suzhou scenery, white walls and dark grey tiles (Jiangnan water town style), small bridges and flowing water, delicate brushwork, soft colors, elegant atmosphere, high quality, masterpiece. Do NOT paint pink walls or brightly colored facades.';

export interface GeneratePictureBookParams {
  topic: string;
  generateImage?: boolean;
  /** 民俗参考文案（如月份概要+习俗），用于丰富剧本依据 */
  folkloreContext?: string;
}

interface ScriptPage {
  title: string;
  description: string;
  imagePrompt: string;
}

export async function generatePictureBookScript(topic: string, folkloreContext?: string): Promise<ScriptPage[]> {
  const apiKey = requireDashScope();
  const llm = getLlmConfig();
  const modelText = llm?.model_text?.trim() ?? '';
  const rawUrlText = llm?.url_text?.trim() ?? '';
  // 与其他接口保持一致：URL 为空时默认走 DashScope OpenAI 兼容模式
  const urlText = rawUrlText || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  if (!urlText || !modelText) {
    throw new Error('请先在「大模型配置」→ 文本模型中填写模型名称与 API Key（文本模型用于生成绘本剧本）。');
  }
  const script = await dashscopeChatJson<ScriptPage[]>(
    apiKey,
    '你只输出合法 JSON 数组，数组元素必须包含 title、description、imagePrompt 三个字段，所有字段为字符串，不要 markdown 或其它文字。',
    buildScriptPrompt(topic, folkloreContext),
    modelText,
    urlText
  );
  if (!Array.isArray(script) || script.length === 0) {
    throw new Error('剧本格式错误，请重试');
  }
  const normalized: ScriptPage[] = script.slice(0, 3).map((s) => {
    const raw = s || ({} as ScriptPage);
    const description =
      typeof raw.description === 'string'
        ? raw.description
        : typeof (raw as any).text === 'string'
        ? (raw as any).text
        : '';
    const page: ScriptPage = {
      title: typeof raw.title === 'string' ? raw.title : '',
      description: description,
      imagePrompt: typeof raw.imagePrompt === 'string' ? raw.imagePrompt : '',
    };
    return page;
  }).filter((p) => p.description && p.description.trim().length > 0);

  if (normalized.length !== 3) {
    throw new Error('剧本格式错误，请重试（需要正好 3 页内容）');
  }
  return normalized;
}

export async function generatePictureBook(params: GeneratePictureBookParams): Promise<{
  title: string;
  topic: string;
  pages: PictureBookPage[];
}> {
  const llm = getLlmConfig();
  const modelText = llm?.model_text?.trim() ?? '';
  const rawUrlText = llm?.url_text?.trim() ?? '';
  const urlText = rawUrlText || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const modelImage = llm?.model_image?.trim() ?? '';
  const imageApiUrl = llm?.url_image?.trim() ?? '';

  if (!urlText || !modelText) {
    throw new Error('生成绘本需要先配置「文本模型」（用于写剧本）。请打开「大模型配置」→ 文本模型，填写 URL 与模型名称。');
  }
  if (params.generateImage !== false && (!modelImage || !imageApiUrl)) {
    throw new Error('生成绘本需要先配置「图像模型」（用于插图）。请打开「大模型配置」→ 图像模型，填写 URL 与模型名称。');
  }

  const imageApiKey =
    params.generateImage !== false && modelImage && imageApiUrl ? requireDashScopeImage() : '';
  const ttsApiKey = requireDashScopeTts();
  const script = await generatePictureBookScript(params.topic, params.folkloreContext);
  const pages: PictureBookPage[] = [];

  for (let i = 0; i < script.length; i++) {
    const page = script[i];
    const text = (page?.description ?? '').trim();
    let imageBase64: string | undefined;
    let audioBase64: string | undefined;
    const title = (page?.title ?? '').trim();

    if (params.generateImage !== false && modelImage && imageApiUrl && imageApiKey) {
      try {
        const basePrompt =
          (page?.imagePrompt && page.imagePrompt.trim()) ||
          `${params.topic} ${text.slice(0, 40)}`;
        const prompt = `${IMAGE_STYLE}\n图像提示（可为英文）：${basePrompt}`;
        imageBase64 = await dashscopeTextToImage(imageApiKey, prompt, {
          size: '1024*1024',
          n: 1,
          model: modelImage,
          imageApiUrl,
        });
      } catch (e) {
        console.warn('该页插图生成失败，将仅保留文字:', e);
      }
    }

    // 语音合成（按页生成并入库），失败不影响文字和图片
    try {
      const modelTts = llm?.model_tts?.trim() ?? '';
      const urlTts = llm?.url_tts?.trim() ?? '';
      const voiceTts = llm?.voice_tts?.trim() ?? '';
      if (urlTts && ttsApiKey) {
        const defaultInstructions =
          '请使用一种温润、细腻、亲切的女性嗓音进行朗读，语速稍慢，吐字清晰，停顿自然。整体气质要带有江南水乡的典雅与柔和，情感饱满但克制，不夸张、不煽情，仿佛一位温柔的大姐姐在枕畔给孩子轻声讲故事。';
        const result = await generatePictureBookSpeech(text, {
          url: urlTts,
          model: modelTts || 'qwen3-tts-instruct-flash',
          apiKey: ttsApiKey,
          instructions: voiceTts || defaultInstructions,
        });
        if (result?.audioBase64) {
          audioBase64 = result.audioBase64;
        }
      }
    } catch (e) {
      console.warn('该页语音合成失败，将仅保留文字与图片:', e);
    }
    pages.push({
      text,
      imageBase64,
      title,
      imagePrompt: page.imagePrompt,
      audioBase64,
    });
  }

  const title = `《清嘉录》· ${params.topic}`;
  return { title, topic: params.topic, pages };
}

/** 为单页重新生成插图（提示词拼装与整本生成循环内逻辑一致） */
export async function generatePictureBookPageImage(params: {
  topic: string;
  text: string;
  imagePrompt?: string;
}): Promise<string> {
  const llm = getLlmConfig();
  const modelImage = llm?.model_image?.trim() ?? '';
  const imageApiUrl = llm?.url_image?.trim() ?? '';
  if (!modelImage || !imageApiUrl) {
    throw new Error('请先在「大模型配置」→ 图像模型中填写 URL 与模型名称。');
  }
  const imageApiKey = requireDashScopeImage();
  const text = params.text.trim();
  const basePrompt =
    (params.imagePrompt && params.imagePrompt.trim()) ||
    `${params.topic} ${text.slice(0, 40)}`;
  const prompt = `${IMAGE_STYLE}\n图像提示（可为英文）：${basePrompt}`;
  return dashscopeTextToImage(imageApiKey, prompt, {
    size: '1024*1024',
    n: 1,
    model: modelImage,
    imageApiUrl,
  });
}
